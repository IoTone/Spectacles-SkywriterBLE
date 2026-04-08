# Changelog

All notable changes to the project will be noted here.


## [2.0.0] - 2026-04-08

### Changed

- IoTone project setup

### Added
- BLE HID keyboard scanning and connection (M5Cardputer / M5-Keyboard-Mouse)
- HID service (0x1812) discovery and report characteristic subscription
- Standard HID keyboard report parsing (8-byte reports, modifier keys, 6-key rollover)
- Chat window display for typed keypresses with word wrap and scrolling
- Backspace, Enter, Shift, Tab, and special key handling
- Auto-reconnect on disconnect

### Dependencies
- Lens Studio v5.10.1.25061003
- M5Cardputer with Bluetooth-Keyboard-Mouse-Emulator firmware (bonding disabled)
- Experimental API enabled in project settings

