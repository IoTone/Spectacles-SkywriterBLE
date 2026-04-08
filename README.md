# Overview

The first Spatial typerwriter for Snap Spectacles and the very first BLE Keyboard (not Bluetooth Classic, BLE HID) for Specs!

This combines an M5Stack Cardputer ADV with 

to provide a working BLE HID Keyboard for Spectacles

Project created with `Public Lens Studio v5.10.1.25061003`

## Hardware Requirements

## Software Requirements

This project connects a BLE HID keyboard (M5Cardputer running [Bluetooth-Keyboard-Mouse-Emulator](https://github.com/thefriendlyhedgehog/Bluetooth-Keyboard-Mouse-Emulator)) to Snap Spectacles via Lens Studio. Keypresses are displayed in a chat window on the Spectacles display.

## Features

- Skywriter lets you type and see how to integrate BLE Keyboard input into your own application
- BLE scan and connect to HID keyboard by device name
- Standard HID keyboard report parsing (modifiers, shift, 6-key rollover)
- Real-time keypress display with backspace, enter, and shift support
- Auto-reconnect on disconnect

## Requirements
- Snap Spectacles
- Lens Studio with Experimental API enabled (for Bluetooth)
- M5Cardputer flashed with Bluetooth-Keyboard-Mouse-Emulator firmware
  - **Important:** The firmware must have bonding disabled (`ESP_LE_AUTH_NO_BOND` in `bluetooth.cpp`)

## Project Setup
1. Open the project in Lens Studio
2. In the `BleKeyboard` component inspector, set `keyboardName` to `M5-Keyboard-Mouse` (or your device's BLE name)
3. Ensure `Experimental API` is enabled in Project Settings

## Sending the Lens

1. Connect Spectacles to your phone
2. Connect Spectacles to Lens Studio
3. Send the Lens to your Spectacles
4. Power on the M5Cardputer — it should connect automatically

## Scripts

- **`BleKeyboard.ts`** — BLE scanner, GATT connection, HID service discovery, keyboard report parsing
- **`BleKeyboardAdapter.ts`** — UI adapter that displays keypresses in a chat window
- **`Event.ts`** — Generic typed event system

## Notes

- To use Bluetooth API you need to have `Experimental API on` in your project settings

## Future Plans

- More keyboards, more ergnomic keyboards
- More sample applications
- Persistence of writing
- More full featured text editing
- More fun features for distraction free note taking

## Known Issues

- Lens may freeze on startup if the BLE keyboard was previously connected without a power cycle on the M5Cardputer. Power cycle the M5 before launching the lens.
- Writing is not persisted — all text is lost when the lens closes or the keyboard disconnects.
- Battery level reads as empty (0 bytes). The M5Cardputer firmware does not populate the BLE Battery Service characteristic. Requires a firmware change to call `hid->setBatteryLevel()`.
- Lens Studio's `BluetoothCentralModule` does not support `createBond()`. The M5 firmware must have bonding disabled (`ESP_LE_AUTH_NO_BOND`) or `registerNotifications` on HID Report characteristics will hang indefinitely.
- Classic Bluetooth HID keyboards (e.g., Apple Magic Keyboard A1644) are not supported — only BLE HID (HOGP) devices work.
- No text selection or cursor movement — the editor is append-only with backspace. Arrow keys are not handled.
- SIK's `ContainerFrame` and `ScrollView` are deprecated in favor of SpectaclesUIKit's `Frame` and `ScrollWindow`, but remain functional.

## Attributions

- Doublepoint Touch SDK : inspired this design
- BLE Sample : also very inspiring
- Audio: https://freesound.org/people/BryanSaraiva/sounds/820352/
