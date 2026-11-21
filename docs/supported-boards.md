# Supported boards

Registry: [`shared/boards.json`](../shared/boards.json) (used by both cloud and desktop). Call the `get_supported_boards`
MCP tool for the live version.

| Family | Boards | Tool | Programmer | Status |
|---|---|---|---|---|
| ESP32 / S2 / S3 / C3 | `esp32-wroom-32`, `esp32-wrover`, `esp32-generic`, `esp32-s2-saola-1`, `esp32-s3-devkitc-1`, `esp32-c3-devkitm-1`, `esp32-c3-supermini` | esptool (built in) | USB-UART bridge or native USB | **`esp32-wroom-32` flashed and verified on real hardware (Windows).** Others implemented, not yet run on hardware. |
| ESP8266 | `esp8266-nodemcu`, `esp8266-wemos-d1-mini`, `esp8266-generic` | esptool (built in) | USB-UART | Implemented. **Not yet run on real hardware.** |
| AVR | `arduino-uno`, `arduino-nano`, `arduino-nano-old-bootloader`, `arduino-mega2560` | avrdude (**not bundled**, one-click download in the Tools page) | Serial bootloader | Implemented; hardened after a real-world failure report (explicit config, baud fallback, probe diagnostics). **Not yet confirmed on hardware.** The desktop app auto-detects the exact board (115200 → 57600 → Mega). |
| STM32 | `stm32-bluepill-f103c8`, `stm32-blackpill-f411ce`, `stm32-nucleo-f103rb`, `stm32-nucleo-l476rg` | STM32CubeProgrammer CLI or OpenOCD (**not bundled**) | **ST-Link required** | Command construction unit-tested only. |
| CH32V003 | `ch32v003f4p6` | `wlink` (**not bundled**) | **WCH-LinkE required** (RISC-V mode) | Command construction unit-tested only. |

## Manifest rules (enforced in the cloud *and* again on the PC)

* ESP: `flash_size`, `flash_config.mode`, `flash_config.frequency` are **required** (never guessed); addresses 4 KiB-aligned,
  inside the flash, non-overlapping; `.bin` files. Typical ESP32 layout: bootloader `0x1000`, partitions `0x8000`, app `0x10000`
  (S3/C3: bootloader `0x0`) — take the real values from your build output.
* AVR: exactly one file at `0x0`, Intel HEX (`.hex`) or raw `.bin`; the HEX extent must fit the board's usable flash.
* STM32: addresses within `0x08000000 + flash_bytes`; Intel HEX must declare `0x08000000`.
* CH32V003: single `.bin` at `0x08000000`, ≤ 16 KiB.
* Limits: 16 MiB per file, 32 MiB per package, 8 files; filenames `[A-Za-z0-9._-]{1,64}`; SHA-256 per file.
* Cross-checks on the PC: image-header chip id vs target family (ESP32 family), detected chip vs manifest family,
  detected flash size ≥ manifest flash size.

## Unsupported / limits

STM32 and CH32V003 **cannot** be programmed through a plain USB-UART adapter by this app. STM32 USB-DFU, SWD via CMSIS-DAP,
ESP32-C6/H2/P4, RP2040, nRF are not supported yet. Add a family by implementing `Flasher` and adding it to
`shared/boards.json` + `flashers/__init__.py`.
