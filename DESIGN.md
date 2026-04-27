# SkywriterBLE Design Specification

## Overview

SkywriterBLE is a Snap Spectacles lens that connects to a BLE HID keyboard and lets the wearer type into an AR editor. **v1 is a single continuous journal buffer** — every lens session inserts a new org-mode heading, and user-typed text follows. The buffer persists across sessions on the device. Future versions split this into multi-entry, cloud-synced, exportable journals (see "Future Plans" at the bottom).

The system has three main subsystems: the **BLE HID keyboard driver**, the **AR text editor widget**, and the **journal persistence layer**.

---

## 1. BLE HID Keyboard Driver

### Purpose

Scan for, connect to, and receive keypresses from a Bluetooth Low Energy Human Interface Device (HID) keyboard. The reference hardware is an M5Cardputer running the [Bluetooth-Keyboard-Mouse-Emulator](https://github.com/thefriendlyhedgehog/Bluetooth-Keyboard-Mouse-Emulator) firmware.

### Architecture

```
┌──────────────────┐     BLE Scan      ┌───────────────────┐
│  KeyboardScanner │ ───────────────>  │  M5-Keyboard-Mouse │
│                  │  <─ found ──────  │  (BLE HID Device)  │
└──────┬───────────┘                   └───────────────────┘
       │                                        │
       │ connectGatt                             │
       v                                        │
┌──────────────────┐     GATT + HID             │
│  KeyboardDevice  │ <── notifications ─────────┘
│                  │
│  parseKeyboard   │──> KeypressData
│  Report()        │        │
└──────────────────┘        │
                            v
┌──────────────────┐   onKeypress event
│   BleKeyboard    │ ──────────────────> Consumers
│   (component)    │   onDeviceConnected   (Adapter, Editor)
└──────────────────┘
```

### Components

#### `BleKeyboard` (component) — `BleKeyboard.ts`

The top-level Lens Studio script component. Orchestrates scanning and connection.

**Inputs:**
| Field | Type | Default | Description |
|---|---|---|---|
| `bluetoothCentralModule` | `Bluetooth.BluetoothCentralModule` | — | Lens Studio Bluetooth module |
| `keyboardName` | `string` | `"M5-Keyboard-Mouse"` | BLE advertised device name to match |
| `keyboardAddress` | `string` | `""` | Optional BLE address override |

**Events:**
| Event | Payload | Fires when |
|---|---|---|
| `onDeviceConnected` | `string` (device name) | GATT connected and HID service ready |
| `onKeypress` | `KeypressData` | A new key is pressed |

**Lifecycle:**
1. `onAwake` → start scanning
2. Scanner matches device by name (or address if configured)
3. `connectGatt` → request MTU → attempt bond → discover HID service
4. Subscribe to HID Report characteristic notifications
5. On disconnect → auto-rescan

#### `KeyboardScanner` (internal class)

Wraps `Bluetooth.BluetoothCentralModule.startScan()`. Matches devices by exact name or BLE address. Stops scanning on first match. Skips devices with empty names.

#### `KeyboardDevice` (internal class)

Manages a single GATT connection. Handles:
- MTU negotiation (best-effort, continues on failure)
- Bond request (best-effort, continues if `createBond` unavailable)
- HID service discovery (`0x1812`)
- Protocol Mode write (`0x2A4E` → `0x01` Report Protocol)
- HID Report characteristic subscription (`0x2A4D`)
- Keyboard report parsing and event emission

### BLE Protocol Details

#### Device Profile

| Property | Value |
|---|---|
| Device name | `M5-Keyboard-Mouse` |
| HID Service UUID | `0x1812` |
| HID Report Characteristic UUID | `0x2A4D` (x2: keyboard + mouse) |
| HID Protocol Mode UUID | `0x2A4E` |
| Battery Service UUID | `0x180F` |
| Device Info Service UUID | `0x180A` |
| Bonding | "Just Works" (`ESP_LE_AUTH_NO_BOND` required for Spectacles) |
| Appearance | `0x03C2` (HID Mouse) |

#### UUID Matching

Lens Studio returns UUIDs in inconsistent formats (short `0x1812` vs. long `00001812-0000-1000-8000-00805f9b34fb`). All UUID comparisons are case-insensitive and match both forms.

#### Keyboard HID Report Format (8 bytes)

```
Byte 0: Modifier keys (bitfield)
        bit 0 = Left Ctrl     bit 4 = Right Ctrl
        bit 1 = Left Shift    bit 5 = Right Shift
        bit 2 = Left Alt      bit 6 = Right Alt
        bit 3 = Left GUI      bit 7 = Right GUI
Byte 1: Reserved (0x00)
Bytes 2-7: Up to 6 simultaneous HID Usage key codes
```

- Key-down is detected by comparing current report keys against previous report
- Key-up is an all-zero report
- Mouse reports (5 bytes) are ignored based on length

#### Key Code Mapping

USB HID Usage Page 0x07 codes are mapped to characters:
- `0x04`-`0x1D` → a-z / A-Z (shifted)
- `0x1E`-`0x27` → 1-0 / !-) (shifted)
- `0x28` → Enter (`\n`)
- `0x29` → ESC (ignored)
- `0x2A` → Backspace
- `0x2C` → Space
- `0x2D`-`0x38` → punctuation / symbols

Shift state is determined by modifier bits 1 (Left Shift) and 5 (Right Shift).

### Firmware Requirement

The M5Cardputer firmware must have bonding disabled. In `bluetooth.cpp`:
```cpp
pSecurity->setAuthenticationMode(ESP_LE_AUTH_NO_BOND);  // not ESP_LE_AUTH_BOND
```
Lens Studio's `BluetoothCentralModule` does not support `createBond()`, so HID Report notifications will hang indefinitely if the device requires bonding.

---

## 2. Status Dashboard — `BleKeyboardAdapter`

### Purpose

Displays connection status and typing statistics using existing scene UI elements (text boxes from the original scene layout).

### Component — `BleKeyboardAdapter.ts`

**Inputs:**
| Field | Type | Description |
|---|---|---|
| `bleKeyboard` | `BleKeyboard` | Reference to the BLE keyboard component |
| `connectedBluetoothObj` | `SceneObject` | Shown when connected |
| `scanningBluetoothObj` | `SceneObject` | Shown while scanning |
| `keyboardNameText` | `Text` | Displays connected device name |
| `chatWindowText` | `Text` | Displays typed text (legacy, fixed-size) |
| `keypressCountText` | `Text` | Total keypress count |
| `wpmText` | `Text` | Words per minute (live) |
| `wordCountText` | `Text` | Total word count |

**Behavior:**
- Toggles scanning/connected UI on connection
- Accumulates typed characters into a text buffer
- Handles Backspace (delete last char), Enter (newline), ESC (ignore), unknown codes (ignore)
- Word count: splits on whitespace (`/\s+/`)
- WPM: `wordCount / elapsedMinutes` since first keypress
- Chat window: word-wraps at 40 chars, scrolls to show last 20 lines, appends `_` cursor

---

## 3. Scrollable Text Editor Widget — `ScrollableTextEditor`

### Purpose

A full text editor experience in AR using SIK's ContainerFrame and ScrollView. Text grows downward endlessly as you type, with automatic scrolling to keep the cursor visible — like typing in a desktop text editor.

### Component — `ScrollableTextEditor.ts`

**Inputs:**
| Field | Type | Default | Description |
|---|---|---|---|
| `bleKeyboard` | `BleKeyboard` | — | Reference to BLE keyboard component |
| `editorText` | `Text` | — | Text component that renders typed content |
| `scrollView` | `any` | — | SIK ScrollView component for scrolling |
| `scrollContentTransform` | `ScreenTransform` | — | ScreenTransform of the scroll content wrapper |
| `lineHeight` | `number` | `1.5` | Height per line in local units |
| `maxLineWidth` | `number` | `45` | Characters per line before wrapping |

### Scene Hierarchy

Design-time:

```
TextEditorFrame                    [ContainerFrame component]
  └─ ScrollViewObj                 [ScrollView component + ScreenTransform, Bounds ≈ ±innerSize/2]
      └─ ScrollContent             [ScreenTransform Bounds ±1 — single child of ScrollView]
          └─ EditorText            [Text component + ScreenTransform Bounds ±1]
```

Runtime (after ContainerFrame's `onAwake` re-parents children — see "ContainerFrame Layout Gotcha" below):

```
TextEditorFrame                    [ContainerFrame component]
  ├─ frame                         (auto-created visual frame prefab, with close/follow buttons)
  └─ ContainerInner                (auto-created at runtime; regular Transform, scale 1)
      └─ ScrollViewObj             [your design-time children land here]
          └─ ScrollContent
              └─ EditorText
```

**ContainerFrame** provides:
- Bordered AR window with close/follow buttons
- Draggable and resizable by the user
- Billboarding (faces the camera)
- Content masking within frame bounds

**ScrollView** provides:
- Vertical scrolling with inertia
- Drag-to-scroll interaction
- Elastic bounce-back at edges
- Programmatic scroll via `scrollBy()` and `snapToEdges()`

### Behavior

1. **Text input** — Listens to `bleKeyboard.onKeypress`, appends characters to content buffer. Handles Backspace, Enter, ESC, and unknown codes.

2. **Rendering** — Updates `editorText.text` with content + blinking cursor (`|` toggling every 500ms via `DelayedCallbackEvent`).

3. **Scroll content sizing** — After each keypress, calculates total wrapped line count and expands `scrollContentTransform.anchors` to fit all lines. Calls `scrollView.recomputeBoundaries()` so ScrollView knows the new content bounds.

4. **Auto-scroll** — After each keypress, scrolls to bottom via `scrollView.snapToEdges({ bottom: true })` with fallback to `scrollView.scrollBy()`.

5. **Connection reset** — On `onDeviceConnected`, clears content and resets scroll position.

### ContainerFrame Configuration

| Property | Recommended Value |
|---|---|
| `innerSize` | `{32, 32}` |
| `border` | `4` |
| `autoShowHide` | `false` |
| `allowScaling` | `true` |
| `allowTranslation` | `true` |
| `useBillboarding` | `true` |
| `isContentInteractable` | `true` (required — ScrollView drag input goes through ContainerFrame) |
| `showCloseButton` | `true` |
| `cutOut` | `true` |

### ScrollView Configuration

| Property | Recommended Value |
|---|---|
| `enableVerticalScroll` | `true` |
| `enableHorizontalScroll` | `false` |
| `enableScrollInertia` | `true` |
| `enableScrollLimit` | `true` |
| `scrollLimit` | `0.3` |

### Empty-Buffer Cursor Hint

When the buffer is short (typically just a fresh session heading), the cursor `█` blinking at the end can be hard to spot on a mostly-blank screen. The editor renders a **visible-only hint** before the cursor while content length is at or below `emptyHintMaxLen` (default 250 chars — covers the heading; disappears once user has typed substantively).

The hint sits between content and the cursor (`content + hint + cursor`) so the cursor is always the rightmost glyph and the arrow in the hint points toward it as the typing target. The hint is **not part of `this.content`** and is never persisted — purely a visual cue. Default text is `"  start typing → "`. Set `emptyHint = ""` to disable.

```
* Session :skywriterble:
  [2026-04-26 Sun 14:32 +0900]
  :PROPERTIES:
  :TZ: +0900
  :DEVICE: spectacles
  :END:

  start typing → █     ← hint + cursor, both visible; cursor is the typing target
```

After the user types past the threshold, only the cursor remains:

```
...
  :END:

I started writing in the morning and█
```

### Text Component Configuration

| Property | Recommended Value |
|---|---|
| Font size | `36`-`48` |
| Horizontal alignment | Left |
| Vertical alignment | Top |
| Vertical overflow | Overflow |
| Horizontal overflow | Wrap |
| Color | White |
| Depth Test | off (so Text renders on top of the ContainerFrame backdrop regardless of Z) |
| Layout Rect | tuned so width matches the wrap target — for `innerSize: {32, 32}` with `border: 4`, around `-14, 14, -14, 14` |

### Frame Layout Gotcha — coordinate system

**Applies to both SIK `ContainerFrame` and SpectaclesUIKit `Frame`.** The coordinate system is non-obvious and silently breaks ScreenTransform-based children (like ScrollView / ScrollWindow) if children are sized with the usual `Bounds = -1, 1, -1, 1` "fill parent" idiom. The cause is two layers of indirection that aren't visible in the Inspector:

1. **Runtime SceneObject re-parenting.** On `onAwake`, the frame creates a child SceneObject (named `ContainerInner` in SIK, `content` in UIKit) and moves all the frame's existing children into it. The new content SceneObject has a regular `Transform` — *not* a `ScreenTransform`.

2. **The visible panel size is decoupled from the inner Transform's scale.** The frame draws its visible panel at `innerSize` (e.g., 32×32) by writing shader uniforms / a separate render mesh. It does **not** scale the content SceneObject. The content's local scale stays at `(1, 1, 1)`. `Auto Scale Content` only matters when `innerSize` later changes from its initial value (e.g., user drags to resize); at startup, `factor = innerSize / originalInnerSize = 1` so the scale call is a no-op.

Therefore, a child of ContainerFrame with `Bounds = -1, 1, -1, 1` fills **2×2 world units**, not the visible 32×32 panel area — about 1/16th the size. SIK ScrollView's `MaskingComponent` then clips content to that tiny region, producing the symptom of "the entire editor renders as a single character."

**Sizing rule:** for ScreenTransform children of a ContainerFrame/Frame, set `Bounds` to approximately `±innerSize/2`, then tighten for the frame border. With `innerSize: {32, 32}` and `border: 4`, start with `Bounds = -14, 14, -14, 14` (or `-12, 12, -12, 12`) and tune visually.

**Same gotcha applies to UIKit ScrollWindow's internal Scroller.** ScrollWindow re-parents its own children into an internal `Scroller` SceneObject (Transform-only, never scaled to `scrollDimensions`). So the `Text` rendered inside ScrollWindow needs its ScreenTransform `Bounds` set to absolute world units (e.g., `±16` to match `windowSize: 32`), *not* `±1`. ScrollWindow auto-sets *its own* ScreenTransform to `±windowSize/2`, but does not propagate that sizing into the Scroller. The general principle: **any ScreenTransform child of a Transform-only ancestor must use absolute Bounds, not `±1` "fill parent" semantics**, because there's no parent ScreenTransform for `±1` to normalize against.

**Z-position note:** ContainerInner is positioned at `z = scaleZ + 0.5` (= 1.5) forward of the frame mesh, so children render in front of the frame's backdrop. But the frame's translucent material can still darken Text drawn in screen-space at the same Z. Two mitigations:
- On the `Text` component, **disable Depth Test** so Text renders on top regardless of depth-buffer state.
- If still darkened, push the Text's local Z forward (`+1` to `+5` units) on the SceneObject's underlying Transform (Advanced tab of ScreenTransform).

---

## 4. Journal Persistence (v1 — single buffer)

### Purpose

A continuous, device-local journal buffer that persists across lens sessions, with each new session marked by an org-mode style heading. v1 is intentionally simple: one buffer, no entry list, no cloud. The org structure makes the data forward-compatible with the v2 multi-entry model (split on `^\* ` headings).

### Components

#### `JournalController.ts`

`@component` script that wires `BleKeyboard.onKeypress` to a buffer and an editor view.

**Inputs:**
| Field | Type | Default | Description |
|---|---|---|---|
| `bleKeyboard` | `BleKeyboard` | — | Reference to the BLE keyboard component |
| `editor` | `ScrollableTextEditor` | — | View component that displays the buffer |
| `autosaveDelay` | `number` | `1.5` | Seconds of keyboard idle before autosave fires |
| `sessionHeading` | `string` | `"Session"` | Org headline text inserted on lens start |
| `sessionTags` | `string` | `"skywriterble"` | Colon-list of org tags (no surrounding colons) |
| `timezone` | `string` | `""` | Override for the timestamp's TZ value. If empty, the device's UTC offset (`+HHMM`) is computed from `Date.getTimezoneOffset()` |
| `includeLocation` | `boolean` | `false` | If on, queries `LocationService.getCurrentPosition()` and writes a `:LATLNG:` property into the heading |
| `locationTimeoutSec` | `number` | `3.0` | How long to wait for GPS before giving up and writing `unavailable` (the heading itself is written immediately with a placeholder token; the token gets replaced when location resolves) |

**Lifecycle:**
1. `onAwake` — instantiates `LocalJournalStore`, registers autosave + flush-on-destroy.
2. `onStart` (deferred 0.05s) — loads buffer from store, appends a fresh session heading, hands buffer to editor.
3. Each keypress — appends to buffer (or backspaces), pushes to editor, schedules autosave.
4. `onDestroy` — flushes any dirty state.

**Public API:**
| Method / Event | Purpose |
|---|---|
| `clearBuffer()` | Wipe persisted buffer; insert a fresh session heading. No undo. |
| `getBuffer()` | Returns the current in-memory buffer text. |
| `onBufferChanged` | Event fired when the buffer is replaced (clear, session-heading insert). Not fired per keystroke — autosave is the keystroke notification. |

#### `LocalJournalStore.ts`

Simple wrapper around `global.persistentStorageSystem.store`. Single key:

| Key | Value |
|---|---|
| `journal:buffer` | The full buffer text |

Implements `JournalStore` interface from `JournalTypes.ts`. v2 will introduce a `CloudJournalStore` against the same interface.

#### `JournalTypes.ts`

The `JournalStore` interface — `load(): string`, `save(text: string): void`, `clear(): void`. No entry types in v1; v2 will add an `Entry` shape.

### Session Heading Format

Inserted at the end of the existing buffer on every lens open. With auto-timezone and `includeLocation: true`:

```
* Session :skywriterble:
  [2026-04-26 Sun 14:32 +0900]
  :PROPERTIES:
  :TZ: +0900
  :DEVICE: spectacles
  :LATLNG: 33.589123,130.420456
  :END:

```

Lines after the blank line are free-text content typed by the user.

**Timezone:** if the `timezone` Inspector field is set, it's used verbatim (e.g., `JST`, `America/Los_Angeles`). Otherwise, the device's UTC offset is computed via `Date.getTimezoneOffset()` and rendered as `+HHMM` / `-HHMM`.

**Location:** opt-in via `includeLocation`. The heading is written immediately with a placeholder token (`<<latlng-…>>`) so the editor doesn't have to wait on GPS. `LocationService.getCurrentPosition()` is fired in parallel; when it resolves (or times out / errors), the token is replaced with either `lat,lng` (six decimal places) or the literal string `unavailable`. The replacement triggers an autosave so the resolved value persists.

> **Status: tabled for v1.** Calling `LocationService` directly from a lens script raises `Permission Denied (GPS_RAW)` on Spectacles even with the project's permission flag enabled — Snap's location stack on Spectacles requires a separate package/kit (likely the Spectacles location helper from Snap's developer asset library) that we haven't integrated yet. The code path is in place and the placeholder/replace flow works; the GPS call will start succeeding as soon as the right kit is added. Until then, leave `includeLocation: false` and the heading just won't include a `:LATLNG:` line.

Spectacles location prerequisites once the kit is integrated (per Snap docs): user logged in to Snapchat, paired, location permission enabled, internet connection. If any of these are missing, the token resolves to `unavailable` once the timeout fires.

If the buffer is empty when the lens opens, the heading is the first content. Otherwise, the heading is appended with a separating blank line so the org structure stays clean.

### Why org-mode

Three reasons:

1. **Forward-compatible.** Splitting the buffer on `^\* ` recovers individual entries when v2 introduces multi-entry mode.
2. **Self-describing.** The properties drawer (`:TZ:`, `:DEVICE:`, future `:WHERE:` etc.) lets us add structured metadata without a schema migration — just add new property keys.
3. **Export target.** v2 plans to export to org-mode anyway; using it natively in the buffer means export becomes a copy-out, not a transformation.

---

## 5. Data Flow

```
M5Cardputer (BLE HID)
       │
       │  BLE notification (8-byte HID report)
       v
  BleKeyboard.ts
  ├─ parseKeyboardReport() → KeypressData
  ├─ onKeypress event ──────┬─────────────────────┬─────────────────────┐
  │                         │                     │                     │
  v                         v                     v                     v
BleKeyboardAdapter    JournalController     ScrollableTextEditor   (future consumers)
  ├─ chatWindowText     ├─ buffer            ├─ editorText
  ├─ keypressCountText  ├─ autosave (1.5s)   ├─ scrollWindow / scrollView (via adapter)
  ├─ wpmText            └─ session heading   └─ auto-scroll
  └─ wordCountText           on lens open

                       LocalJournalStore
                       └─ PersistentStorageSystem ('journal:buffer')
```

`BleKeyboardAdapter`, `JournalController`, and `ScrollableTextEditor` independently subscribe to `BleKeyboard.onKeypress`. The controller is the source of truth for the journal buffer; the editor is a pure view; the adapter is independent stats.

---

## 6. File Inventory

| File | Purpose |
|---|---|
| `Assets/Scripts/BleKeyboard.ts` | BLE scanner, GATT connection, HID report parsing, keypress events |
| `Assets/Scripts/BleKeyboardAdapter.ts` | Status dashboard: connection UI, chat window, stats (keypress count, WPM, word count) |
| `Assets/Scripts/ScrollableTextEditor.ts` | AR text editor view (SIK ScrollView or UIKit ScrollWindow via `ScrollAdapter`) |
| `Assets/Scripts/ScrollAdapter.ts` | Abstraction over the scroll backend (SIK / UIKit / no-scroll); selected by Inspector wiring |
| `Assets/Scripts/JournalController.ts` | v1 single-buffer journal: keypress → buffer → store + editor; org-mode session heading on lens open |
| `Assets/Scripts/LocalJournalStore.ts` | `JournalStore` impl over `PersistentStorageSystem` |
| `Assets/Scripts/JournalTypes.ts` | `JournalStore` interface |
| `Assets/Scripts/Event.ts` | Generic typed event system (pub/sub) |
| `Assets/Textures/iotone_logo.png` | IoTone branding |
| `DESIGN-SCROLLWINDOW.md` | Migration plan: SIK ScrollView → UIKit ScrollWindow |
| `LICENSE.md` | MIT License, Copyright (c) 2026 IoTone, Inc. |

---

## 7. Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| Lens Studio | v5.10.1+ | IDE and runtime |
| SpectaclesInteractionKit (SIK) | Bundled | `ContainerFrame`, `ScrollView` (legacy path) |
| SpectaclesUIKit | Bundled | `Frame`, `ScrollWindow` (preferred path) |
| Bluetooth Experimental API | — | `BluetoothCentralModule` for BLE |
| M5Cardputer firmware | Bluetooth-Keyboard-Mouse-Emulator | BLE HID keyboard (bonding disabled) |

---

## 8. Known Limitations

- **No bonding support** — Lens Studio's BLE API does not expose `createBond()`. The BLE HID device firmware must disable bonding (`ESP_LE_AUTH_NO_BOND`).
- **No Classic Bluetooth** — Only BLE (Bluetooth Low Energy) is supported. Classic Bluetooth HID keyboards (e.g., Apple Magic Keyboard A1644) will not work.
- **Single keyboard** — Only one keyboard connection at a time. Reconnects automatically on disconnect.
- **No text selection or cursor movement** — The editor is append-only (with backspace). No arrow key navigation or selection.
- **Single buffer** — v1 has one continuous buffer, no entry list or switching. Multi-entry support is planned for v2 (see Future Plans).
- **Device-local persistence only** — buffer lives on the Spectacles in `PersistentStorageSystem`. No sync, no export, no off-device backup. v2 plan is Snap Cloud Supabase mirror.
- **Buffer growth** — `PersistentStorageSystem` has size limits (low-MB range). Long-running journals may eventually need pruning or rotation; not handled in v1.
- **Geolocation requires a separate Spectacles kit** — even with the project's location permission flag set, calling `LocationService.getCurrentPosition()` directly raises `Permission Denied (GPS_RAW)` on Spectacles. The platform's location stack expects access via a dedicated kit / helper package that's not bundled here. Tabled for v1; `includeLocation` defaults to `false`. Re-enable after the kit is added (see Future Plans).
- **No org parser** — the buffer is org-formatted text but the lens does not parse it (no folding, no agenda, no structured display). It's plain text styled to be machine-readable later.
- **ScrollView deprecation** — SIK's `ContainerFrame` and `ScrollView` are deprecated in favor of SpectaclesUIKit's `Frame` and `ScrollWindow`. The `ScrollAdapter` lets either be used; UIKit is the preferred path.

---

## 9. Future Plans (v2 and beyond)

The v1 single-buffer model is intentionally minimal so the persistence shape can grow without breaking changes. The following are planned, ordered by likely sequence:

### Multi-entry journal

Replace the single buffer with a list of entries. The org-mode session-heading model means existing v1 buffers can be migrated by splitting on `^\* ` headings — no data loss, just structure recovery. A new `JournalStore` shape with per-entry keys (already prototyped in the v0 implementation history) plus an entry index. The current `clearBuffer()` becomes `deleteEntry(id)`.

Likely UI additions:
- Entry picker dropdown (collapsible side panel listing prior entries).
- New / Delete icon buttons in a header strip.
- Stats panel toggle (the existing dashboard becomes opt-in chrome).

### Cloud sync via Snap Cloud Supabase

Add a `CloudJournalStore` implementing the same `JournalStore` interface. Local-first with write-through to Supabase via the Snap Remote Service Module. Eventual-consistency conflict resolution: latest-write-wins per entry id; entry IDs are millisecond timestamps so collisions are unlikely. Sync state persisted in `prefs:syncState`.

Trade-offs to settle when we ship:
- Auth model — Snapchat user identity vs. anonymous device id.
- Conflict UI — silent overwrite vs. visible "conflict; pick one" prompt.
- Offline behavior — pending-writes queue when network drops.

### Org-mode export

An "Export" action that copies the buffer (or selected entries in v2) to a destination — clipboard-equivalent in lens, or a webhook to a user-controlled endpoint, or direct write to a Supabase row marked as "export ready." Since the buffer is already org-formatted, export is a copy-out, not a transformation.

### Editor modes

Insert / command / agenda modes inspired by Emacs org-mode. Speculative. Would benefit from arrow-key support (`KeypressData` already plumbs raw key codes; mapping arrow keys is straightforward but the UX of cursor movement in append-only mode needs design).

### GPS / location (re-enable)

The plumbing is already in `JournalController` (`includeLocation`, `locationTimeoutSec` inputs; placeholder-token + replace flow). What's missing is the Spectacles location kit that satisfies the platform-level permission. Concretely:

1. Find the Snap-provided Spectacles location helper package (likely from the Snap asset library or Lens Studio templates).
2. Drop it into `Packages/`.
3. Wire its initialization into the scene per the kit's docs.
4. Toggle `includeLocation: true` on `JournalController`.
5. The `:LATLNG:` resolution flow lights up automatically — no additional code changes.

Until then, the code path falls back gracefully (writes `unavailable` after the timeout) and the rest of the journal works fine.

### Other speculative ideas

- **`:WHERE:` reverse-geocoding** — translate lat/lng to a human-readable place name once GPS is working.
- **Voice-to-text capture** — append voice-transcribed text under the current session heading.
- **Tag autocomplete** — when typing `:tag:` in the editor, suggest tags seen in prior headings.
- **Search across buffer** — quick-filter to find prior session headings or text.
