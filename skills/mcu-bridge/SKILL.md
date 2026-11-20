---
name: mcu-bridge
description: Flash and debug physical microcontrollers (ESP32/ESP8266, Arduino Uno/Nano/Mega, STM32, CH32V003) attached to the user's Windows PC through the MCU Bridge MCP server. Use when the user asks to write, build, flash, reset, verify or read serial output from a real board. You compile in your own environment; the PC never compiles.
---

# MCU Bridge — flashing real hardware

The user's PC runs the MCU Bridge desktop app. You talk to it through the `mcu-bridge` MCP server.
**You build the firmware here; the PC only flashes it.** Never ask the user to open an IDE, COM-port
tool or flasher.

## Hard rules
1. **Never say firmware is flashed until `get_flash_job` returns `status: "completed"` with `flash_confirmed: true`.** Any other status means it is not flashed. Report the exact `error.code` and message.
2. Never guess flash addresses, flash size, mode or frequency. Take them from your build output (ESP-IDF: `build/flasher_args.json`; PlatformIO: the board/partition settings; Arduino CLI: the build's `.bin`/`.hex` plus board config).
3. Do not unplug/reset advice during `flashing`/`verifying`. Do not start a second job on a busy device.
4. Use a **new unique `job_id`** for every different firmware package (8–64 chars `[A-Za-z0-9_-]`). Re-sending the identical manifest with the same id is safe (idempotent).
5. The tools cannot run commands or touch files on the PC. Don't try; there is no such tool.

## No code sandbox? (plain chat) — use the cloud compiler
If you cannot run a compiler yourself, do NOT ask the user to compile anything. Call **`build_and_flash`** with the Arduino sketch
source and the board id (`arduino-uno`, `arduino-nano`, `arduino-nano-old-bootloader`, `arduino-mega2560`, `esp32-wroom-32`,
`esp32-wrover`, `esp32-generic`). It checks the connected device, compiles in the cloud, creates the job and streams the firmware to
the PC in one call. Then poll `get_flash_job` (wait_seconds 20) until `is_terminal`; only `completed` + `flash_confirmed=true` is success.
`compile_firmware` compiles without flashing (returns Intel HEX for AVR) and is useful to check code first.
- Compile errors come back in `error.details.stderr` — fix the sketch and call again. `COMPILER_UNAVAILABLE` → retry in a minute.
- Only Arduino built-in libraries (Servo, Wire, SPI, EEPROM, SoftwareSerial…) exist; third-party libraries cannot be installed. Extra files go in `extra_files`.
- Pick the board from `identify_mcu`/`list_devices`; for an FTDI/CH340 Nano that fails at 115200 use `arduino-nano-old-bootloader` (the desktop also retries at 57600 automatically).
- ESP32 builds are application-only (flashed at 0x10000): the chip needs the Arduino-ESP32 bootloader/partition table already (true if it ever ran an Arduino sketch).
- The source is compiled by a public cloud build service (Wokwi); tell the user if the code is sensitive.

## Workflow (with your own toolchain)
1. **`list_devices`** — read `situation`:
   - `no_agent` → tell the user to start MCU Bridge on their PC (tray icon says Connected).
   - `no_device` → ask them to plug the board in via USB; then `detect_new_devices` with `since_version` = the `registry_version` you got and `wait_seconds: 25`.
   - `multiple_devices` → show the candidates and pass `device_id` to every later call (or ask which).
   - `single_device` → `device_id` may be omitted.
2. If `family`/`chip` is null or uncertain (USB-UART bridges like CP210x/CH340), call **`identify_mcu`** (briefly resets the board). Use the reported family/chip/flash_size to choose the build target. Check `remote_flashing_allowed` — if false, ask the user to enable "Allow remote flashing" for that device in the app.
3. **`get_supported_boards`** (optional) for allowed boards, baud rates, flash modes/frequencies/sizes.
4. **Write and compile** the firmware in your environment.
5. **Build the manifest.** Easiest: `curl -sO https://<worker>/tools/manifest.py` then
   `python3 manifest.py --family esp32 --board esp32-wroom-32 --flash-size 4MB --mode dio --freq 40m 0x1000=bootloader.bin 0x8000=partitions.bin 0x10000=app.bin`
   (AVR: `--family avr --board arduino-uno 0x0=firmware.hex`). It computes sizes and SHA-256. Or write the JSON yourself (see below).
6. **`flash_firmware`** with `{manifest, device_id?, verify?: true, boot_log_seconds?: 4}`. It validates everything and returns `upload.files[]` each with a ready `curl` command. It does **not** flash by itself.
7. **Upload every file** with those curl commands (replace `<path-to>` with the real path). Upload sequentially in listed order, or in parallel. Each `PUT` returns only after the desktop received the whole file; HTTP 422 `HASH_MISMATCH` or 400 `SIZE_MISMATCH` means the file differs from the manifest — rebuild the manifest from the actual file.
8. **Poll `get_flash_job`** with `wait_seconds: 20` until `is_terminal` is true. Progress: `awaiting_upload → transferring → flashing → verifying → completed`.
9. **Check it actually runs:** `capture_boot_log` (resets, captures, analyses) or `read_serial`. Look at `analysis.flags`: `panic`, `brownout`, `watchdog_reset`, `boot_loop`, `waiting_for_download`. A completed flash with a panicking boot log is a firmware bug — fix, rebuild, re-flash with a new `job_id`.
10. Iterate: edit → build → new job. Tell the user briefly what you flashed and what the board printed.

## Manifest format
```json
{
  "job_id": "job_blink_0001",
  "target": {"family": "esp32", "board": "esp32-wroom-32", "flash_size": "4MB"},
  "flash_config": {"mode": "dio", "frequency": "40m", "baud_rate": 460800},
  "files": [
    {"address": "0x1000",  "filename": "bootloader.bin", "size": 26000,  "sha256": "<hex>"},
    {"address": "0x8000",  "filename": "partitions.bin", "size": 3072,   "sha256": "<hex>"},
    {"address": "0x10000", "filename": "firmware.bin",   "size": 900000, "sha256": "<hex>"}
  ]
}
```
- Families: `esp32 esp32s2 esp32s3 esp32c3 esp8266 avr stm32 ch32v003`. `board` must belong to the family.
- ESP: `flash_size`, `mode`, `frequency` are **required**; addresses 4 KiB-aligned, inside flash, non-overlapping. Typical ESP32: bootloader `0x1000`, partitions `0x8000`, app `0x10000`; ESP32-S3/C3: bootloader `0x0`. ESP8266: usually one image at `0x0`.
- AVR: exactly one file at `0x0`, `.hex` (Intel HEX) or `.bin`. Use `arduino-nano-old-bootloader` (57600) for older Nano clones.
- STM32: files at `0x08000000+` (needs an ST-Link). CH32V003: one `.bin` at `0x08000000` ≤ 16 KiB (needs WCH-LinkE).
- Limits: 16 MiB/file, 32 MiB/package, ≤ 8 files, filenames plain `[A-Za-z0-9._-]`. Unknown keys are rejected.

## Error codes → what to do
| code | meaning / action |
|---|---|
| `NO_AGENT_CONNECTED` | Desktop app offline. Ask user to start it. |
| `NO_DEVICE` | Nothing plugged in. Ask for USB, then `detect_new_devices`. |
| `MULTIPLE_DEVICES` | Pass `device_id` (list in `error.details`). |
| `DEVICE_NOT_FOUND` / `DEVICE_DISCONNECTED` | Re-run `list_devices`; ask user to re-plug. |
| `UNSUPPORTED_MCU` | Not a supported programmable target (see `notes`). |
| `TARGET_MISMATCH` | Firmware family/chip/flash size ≠ connected chip. Rebuild for the right target (`identify_mcu`). |
| `DEVICE_NOT_ALLOWED` | User must enable "Allow remote flashing" for this device in the app. |
| `FLASH_IN_PROGRESS` | Wait for/cancel the active job (`error.details.job_id`). |
| `MANIFEST_INVALID` | Fix every item in `error.details` (path + code). |
| `TOOLCHAIN_MISSING` / `PROGRAMMER_MISSING` | A tool (avrdude, STM32CubeProgrammer/OpenOCD, wlink) or programmer (ST-Link/WCH-LinkE) is missing on the PC. Tell the user exactly which. |
| `TRANSFER_FAILED` / `TRANSFER_TIMEOUT` / `HASH_MISMATCH` | Upload problem. Check file vs manifest, create a **new job**, re-upload. |
| `COMPILE_FAILED` / `COMPILER_UNAVAILABLE` | Sketch errors (see `details.stderr`) / build service down — fix code or retry. |
| `FLASH_FAILED` | Often can't enter bootloader: ask user to hold BOOT while connecting / check cable & port / close other serial programs (`SERIAL_ERROR`). |
| `VERIFICATION_FAILED` | Written but readback differs: re-flash; check power/wiring/flash settings. |
| `CANCELLED`, `JOB_EXPIRED`, `TIMEOUT`, `AGENT_DISCONNECTED` | Job did not complete; device may hold a partial image. Re-flash with a new `job_id`. |
| `RATE_LIMITED` | Slow down (120 calls/min). |

## Other tools
- `get_device_status` — idle / flashing / verifying / disconnected, plus last job.
- `verify_flash` — check the board matches a firmware package without writing (re-upload the files; nothing is stored).
- `reset_device` (optionally `capture_seconds`) — restart the firmware.
- `cancel_flash_job` — stop a job; a cancel during writing can leave a partial image.
- `get_flash_history` — past jobs with outcome.

## Network note
Uploads go straight to the Worker with `curl`, so the sandbox must be allowed to reach the Worker host (add it to the environment's allowed hosts). If curl fails with a connection/403 error, tell the user to allow that host.
