# SkywriterBLE Design Specification

## Overview

SkywriterBLE is a Snap Spectacles lens that connects to a BLE HID keyboard and displays typed text in an AR text editor. The system has two main subsystems: the **BLE HID keyboard driver** and the **AR text editor widget**.

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

## 4. Data Flow

```
M5Cardputer (BLE HID)
       │
       │  BLE notification (8-byte HID report)
       v
  BleKeyboard.ts
  ├─ parseKeyboardReport() → KeypressData
  ├─ onKeypress event ──────┬─────────────────────┐
  │                         │                     │
  v                         v                     v
BleKeyboardAdapter    ScrollableTextEditor    (future consumers)
  ├─ chatWindowText     ├─ editorText
  ├─ keypressCountText  ├─ scrollView
  ├─ wpmText            └─ auto-scroll
  └─ wordCountText
```

Both `BleKeyboardAdapter` and `ScrollableTextEditor` can run simultaneously. They independently subscribe to the same `onKeypress` event from `BleKeyboard`.

---

## 5. File Inventory

| File | Purpose |
|---|---|
| `Assets/Scripts/BleKeyboard.ts` | BLE scanner, GATT connection, HID report parsing, keypress events |
| `Assets/Scripts/BleKeyboardAdapter.ts` | Status dashboard: connection UI, chat window, stats (keypress count, WPM, word count) |
| `Assets/Scripts/ScrollableTextEditor.ts` | AR text editor widget with SIK ContainerFrame + ScrollView |
| `Assets/Scripts/Event.ts` | Generic typed event system (pub/sub) |
| `Assets/Textures/iotone_logo.png` | IoTone branding |
| `LICENSE.md` | MIT License, Copyright (c) 2026 IoTone, Inc. |

---

## 6. Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| Lens Studio | v5.10.1+ | IDE and runtime |
| SpectaclesInteractionKit (SIK) | Bundled | ContainerFrame, ScrollView |
| Bluetooth Experimental API | — | `BluetoothCentralModule` for BLE |
| M5Cardputer firmware | Bluetooth-Keyboard-Mouse-Emulator | BLE HID keyboard (bonding disabled) |

---

## 7. Known Limitations

- **No bonding support** — Lens Studio's BLE API does not expose `createBond()`. The BLE HID device firmware must disable bonding (`ESP_LE_AUTH_NO_BOND`).
- **No Classic Bluetooth** — Only BLE (Bluetooth Low Energy) is supported. Classic Bluetooth HID keyboards (e.g., Apple Magic Keyboard A1644) will not work.
- **Single keyboard** — Only one keyboard connection at a time. Reconnects automatically on disconnect.
- **No text selection or cursor movement** — The editor is append-only (with backspace). No arrow key navigation or selection.
- **ScrollView deprecation** — SIK's `ContainerFrame` and `ScrollView` are deprecated in favor of SpectaclesUIKit's `Frame` and `ScrollWindow`. Functionally equivalent for now.
