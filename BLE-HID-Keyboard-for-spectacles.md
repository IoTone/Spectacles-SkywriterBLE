# BLE HID Keyboard for Spectacles — Implementation Plan

## Context

We are connecting a **M5Cardputer BLE HID keyboard** (from [Bluetooth-Keyboard-Mouse-Emulator](https://github.com/thefriendlyhedgehog/Bluetooth-Keyboard-Mouse-Emulator)) to a Lens Studio project running on Snap Spectacles. The M5Cardputer advertises as `"M5-Keyboard-Mouse"` over BLE and implements standard HID over GATT (HOGP). This replaces the previous Apple Magic Keyboard approach, which failed because that keyboard uses Classic Bluetooth HID (not BLE).

## M5 Keyboard BLE Profile Summary

| Item | Value |
|---|---|
| Advertised name | `M5-Keyboard-Mouse` |
| HID Service UUID | `0x1812` |
| Battery Service UUID | `0x180F` |
| Device Info Service UUID | `0x180A` |
| Keyboard Input Report | Report ID 2 via characteristic `0x2A4D` (8 bytes) |
| Mouse Input Report | Report ID 1 via characteristic `0x2A4D` (5 bytes) |
| Appearance | `0x03C2` (HID Mouse — set by firmware) |
| Pairing | "Just Works" bonding (`ESP_LE_AUTH_BOND`, `ESP_IO_CAP_NONE`) |
| Manufacturer | `M5Stack` |

### Keyboard Report Format (8 bytes, Report ID 2)

```
Byte 0: Modifier keys (bitfield)
        bit 0 = Left Ctrl     bit 4 = Right Ctrl
        bit 1 = Left Shift    bit 5 = Right Shift
        bit 2 = Left Alt      bit 6 = Right Alt
        bit 3 = Left GUI      bit 7 = Right GUI
Byte 1: Reserved (0x00)
Bytes 2-7: Up to 6 simultaneous HID key codes (Usage Page 0x07)
```

Key-up is signaled by an all-zero 8-byte report.

### Mouse Report Format (5 bytes, Report ID 1)

```
Byte 0: Buttons (3 bits) + 5 padding
Byte 1: X movement (int8)
Byte 2: Y movement (int8)
Byte 3: Scroll wheel (int8)
Byte 4: Horizontal pan (int8)
```

---

## Current Code State

The project has three script files:

- **`TouchSdk.ts`** — Scanner + device connection + notification probing. Currently in "probe all services" debug mode (subscribes to every characteristic on every service and logs raw hex). Has HID key maps and a `tryParseNotification` that attempts HID parsing on any notification.
- **`TouchSdkAdapter.ts`** — UI adapter that displays keypresses in a chat window text component. Already handles BACKSPACE, Enter, ESC, and regular characters.
- **`Event.ts`** — Generic typed event system. No changes needed.

---

## Changes Required

### Step 1: Simplify scanner to match `M5-Keyboard-Mouse` by name

**File:** `TouchSdk.ts` — `KeyboardScanner` class

The M5 device advertises with a clear BLE name. No address matching or empty-name fallback needed.

- **Default `keyboardName`** to `"M5-Keyboard-Mouse"` instead of empty string
- **Remove address-based matching** — simplifies the scanner significantly
- **Keep `keyboardAddress` as optional override** for flexibility
- **Name matching**: exact match if configured, otherwise match `"M5-Keyboard-Mouse"` or `"Keyboard"`
- **Remove all debug `SCAN:` logging per-device** — just log when a match is found

### Step 2: Replace `probeAllServices()` with targeted HID service discovery

**File:** `TouchSdk.ts` — `KeyboardDevice` class

Now that we know the exact service/characteristic UUIDs, replace the brute-force probe with targeted discovery:

1. **Find HID service** (`0x1812`) — fail if not present (unlike the Magic Keyboard, the M5 will expose this since it's a proper BLE HID device)
2. **Find HID Report characteristics** (`0x2A4D`) — there will be multiple (keyboard Report ID 2, mouse Report ID 1)
3. **Subscribe to notifications** on all `0x2A4D` characteristics
4. **Differentiate keyboard vs mouse reports** by length:
   - 8 bytes → keyboard report (Report ID 2)
   - 5 bytes → mouse report (Report ID 1) — ignore for now
5. **Handle bonding**: attempt `gatt.createBond()` before service discovery, since the M5 requires "Just Works" bonding. Gracefully continue if the API isn't available (Lens Studio may handle bonding transparently).

Match UUIDs in both short form (`0x1812`) and long form (`00001812-0000-1000-8000-00805f9b34fb`) since Lens Studio's format varies.

### Step 3: Clean up HID report parsing

**File:** `TouchSdk.ts` — `KeyboardDevice` class

Replace `tryParseNotification()` with a dedicated `parseKeyboardReport()`:

- Only called for 8-byte notifications (keyboard reports)
- Parse modifier byte (byte 0) for Shift detection (bits 1 and 5)
- Extract key codes from bytes 2-7, ignoring 0x00 and 0x01 (ErrorRollOver)
- Detect newly pressed keys by diffing against `previousKeys`
- Emit `keypress` events with `KeypressData`
- The existing `HID_KEY_MAP` and `HID_KEY_MAP_SHIFTED` tables are correct and complete for the M5 keyboard's key range (0x04–0x38)

### Step 4: Remove debug/probe infrastructure

**File:** `TouchSdk.ts`

Remove:
- `probeAllServices()` method
- `bytesToHex()` helper (only used for debug logging)
- Excessive `print()` statements throughout connection flow
- Keep minimal logging: scan start, device found, connected, disconnected, errors

### Step 5: Verify TouchSdkAdapter.ts compatibility

**File:** `TouchSdkAdapter.ts`

The adapter is already compatible — it listens for `onKeypress` events and displays characters in a chat window. No functional changes needed. Minor verification:

- `onKeypress` handler correctly handles `BACKSPACE`, `ESC`, newline, tab, and regular characters
- Chat window text wrapping and scrolling work correctly
- Connection state UI toggle (scanning vs connected) works

### Step 6: Update component defaults

**File:** `TouchSdk.ts` — `TouchSdk` component

- Change `keyboardName` default from `""` to `"M5-Keyboard-Mouse"`
- Update `@hint` annotations to reference the M5 device
- Remove or simplify `keyboardAddress` (keep as optional override)

---

## File Change Summary

| File | Action | Scope |
|---|---|---|
| `TouchSdk.ts` | Major rewrite | Replace probe-all with targeted HID discovery; simplify scanner; clean up debug code |
| `TouchSdkAdapter.ts` | No changes | Already compatible |
| `Event.ts` | No changes | Already compatible |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Lens Studio returns short UUIDs (`0x1812`) vs long form | High (seen in previous testing) | Match both forms |
| Bonding required but `gatt.createBond()` unavailable | Medium | Try bonding, continue without on failure — Lens Studio may handle it transparently |
| Multiple `0x2A4D` characteristics (keyboard + mouse) | Certain | Subscribe to all, differentiate by report length (8 = keyboard, 5 = mouse) |
| HID service hidden behind encryption (like Magic Keyboard) | Low | M5 uses "Just Works" pairing with `ESP_IO_CAP_NONE` — should expose HID service immediately or after simple bonding |
| Lens Studio doesn't support HID Report Reference descriptors | Low | We don't need to read descriptors — report length differentiates keyboard vs mouse |

---

## Testing Plan

1. Flash M5Cardputer with the Bluetooth-Keyboard-Mouse-Emulator firmware
2. Power on M5 — verify it advertises as `M5-Keyboard-Mouse` (confirm with nRF Connect)
3. Deploy lens to Spectacles
4. Verify scan finds `M5-Keyboard-Mouse` by name
5. Verify GATT connection succeeds
6. Verify HID service (0x1812) is discovered
7. Verify notification subscription on 0x2A4D characteristics
8. Press keys on M5 — verify keypress events fire and characters appear in chat window
9. Test special keys: Shift, Backspace, Enter, Space
10. Test disconnect/reconnect cycle
