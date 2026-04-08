# Overview

The first Spatial XR typerwriter for Snap Spectacles that works directly with a BLE HID keyboard (DIY).  It first BLE Keyboard (not Bluetooth Classic, BLE HID) for Specs!  It works without servers or websockets, making a it a realistic choice to carry in your pocket.

This combines an M5Stack Cardputer ADV with 

to provide a working BLE HID Keyboard for Spectacles

Project created with `Public Lens Studio v5.10.1.25061003`

![Image](https://github.com/user-attachments/assets/08d2d823-a4ec-4e43-837e-da22ed97d9fd)

<img width="600" height="800" alt="Image" src="https://github.com/user-attachments/assets/405f3129-629d-4dd0-8002-220987bf3977" />

## Hardware Requirements

- An M5 Cardputer ADV https://shop.m5stack.com/products/m5stack-cardputer-adv-version-esp32-s3?variant=46698741203201
- Alternative is some BLE HID Keyboard that doesn't require bonding to work (rare ... you will have to make it probably)

## Software Requirements

This project connects a BLE HID keyboard (M5Cardputer running [Bluetooth-Keyboard-Mouse-Emulator](https://github.com/IoTone/Bluetooth-Keyboard-Mouse-Emulator), a fork of [the original project](https://github.com/thefriendlyhedgehog/Bluetooth-Keyboard-Mouse-Emulator)) to Snap Spectacles via Lens Studio. Keypresses are displayed in a chat window on the Spectacles display.

### Flashing the M5Cardputer

The M5Cardputer needs to be flashed with the Bluetooth-Keyboard-Mouse-Emulator firmware. **Important:** The firmware must have bonding disabled (`ESP_LE_AUTH_NO_BOND` in `bluetooth.cpp`) or Spectacles will not be able to subscribe to HID notifications.

There are three ways to flash, from easiest to most advanced:

#### Option A: M5Burner (Easiest — no build tools required)

1. Download and install [M5Burner](https://docs.m5stack.com/en/download) from M5Stack
2. Connect the M5Cardputer via USB
3. Open M5Burner, select **CARDPUTER** from the device list
4. Search for **"Keyboard Mouse Emulator"** in the firmware catalog
5. Click **Burn** to flash

> **Note:** The M5Burner catalog version may still have bonding enabled. If Spectacles fails to connect, you will need to build from source (Option C) with the bonding fix applied.

#### Option B: M5Launcher (Load from SD card)

If your M5Cardputer is running [M5Launcher](https://github.com/bmorcelli/Launcher), you can load the keyboard firmware as an app:

1. Download the `.bin` file from the [Bluetooth-Keyboard-Mouse-Emulator releases](https://github.com/IoTone/Bluetooth-Keyboard-Mouse-Emulator/releases)
2. Copy the `.bin` to your M5Cardputer's SD card
3. Boot into M5Launcher and select the firmware from the SD card menu
4. The keyboard app will launch and advertise as `M5-Keyboard-Mouse`

> **Note:** Switching back to the launcher requires rebooting the M5Cardputer.

#### Option C: PlatformIO (Build from source — recommended)

This is the recommended method because it lets you apply the bonding fix and any other customizations.

1. Install [PlatformIO](https://platformio.org/install) (VS Code extension or CLI)
2. Clone the firmware repo:
   ```
   git clone https://github.com/IoTone/Bluetooth-Keyboard-Mouse-Emulator.git
   cd Bluetooth-Keyboard-Mouse-Emulator
   ```
3. **Apply the bonding fix** — edit `src/bluetooth.cpp`, find this line:
   ```cpp
   pSecurity->setAuthenticationMode(ESP_LE_AUTH_BOND);
   ```
   Change it to:
   ```cpp
   pSecurity->setAuthenticationMode(ESP_LE_AUTH_NO_BOND);
   ```
4. Connect the M5Cardputer via USB
5. Build and flash:
   ```
   pio run -t upload
   ```
6. The device will reboot and begin advertising as `M5-Keyboard-Mouse`

### Verifying the Firmware

After flashing, you can verify the M5Cardputer is advertising correctly:

1. Open **nRF Connect** on your phone
2. Scan for BLE devices
3. You should see `M5-Keyboard-Mouse` in the device list
4. If you connect, you should see the HID Service (`0x1812`) in the service list

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
