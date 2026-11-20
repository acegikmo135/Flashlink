# MCU Bridge

Cloud-to-desktop firmware flashing for AI coding agents. **Claude builds firmware in its own cloud environment; your Windows PC
never compiles.** The PC only detects boards, receives a firmware package straight from the cloud, validates it, flashes,
resets, captures serial output and reports back.

```
Claude Code Cloud ──MCP──▶ Cloudflare Worker (Durable Objects + D1) ◀──outbound WSS── MCU Bridge.exe (Windows tray app)
        └────────── firmware streamed through an in-memory relay (never stored) ──────────▶ USB → MCU
```

* **Cloud:** Cloudflare Workers + Durable Objects + D1 (metadata only). No R2, KV, Firebase or Supabase. Firmware exists only
  in a bounded in-memory window while it streams, and is deleted from the PC after the job.
* **Desktop:** Python + PySide6 (no Electron/WebEngine/Node/WSL/Docker), per-user Inno Setup installer, tool downloader with pinned SHA-256s. Outbound WebSocket only: no localhost server, no port forwarding.
* **Web:** React + Tailwind + shadcn/ui single-page app served by the Worker (Workers Static Assets): sign-in, dashboard, access tokens, connected apps, pairing approval and the OAuth consent screen.
* **MCP:** Streamable HTTP at `/mcp`, 14 tools with strict schemas and structured output.
* **Auth:** MCP supports OAuth 2.1 (add the URL as a claude.ai custom connector) or static Bearer tokens. Wrangler OAuth is for *you, the deployer*; a separate application-level pairing flow (link + QR + code) for the desktop.

## Quick start

```powershell
.\scripts\setup.ps1            # deploy the cloud (logs in with Wrangler, creates D1, deploys, prints invite code)
.\scripts\build-desktop.ps1    # build MCUBridge.exe + MCUBridge-Setup.exe (Python 3.12, Inno Setup 6)
```

Then sign up at `<worker>/signup`, create an MCP token on the dashboard, run `MCUBridge.exe`, approve the pairing link, and
`claude mcp add --transport http mcu-bridge <worker>/mcp --header "Authorization: Bearer <token>"`.
Full steps: [docs/setup.md](docs/setup.md). Design: [docs/architecture.md](docs/architecture.md) ·
[docs/security.md](docs/security.md) · [docs/supported-boards.md](docs/supported-boards.md).

## MCP tools

`list_devices` `get_device_info` `identify_mcu` `get_device_status` `detect_new_devices` ·
`flash_firmware` `get_flash_job` `cancel_flash_job` `verify_flash` `reset_device` ·
`read_serial` `capture_boot_log` `get_flash_history` `get_supported_boards`

Claude can tell apart: no desktop app (`NO_AGENT_CONNECTED`), no device (`NO_DEVICE`), several devices (`MULTIPLE_DEVICES`),
unsupported MCU, wrong firmware target (`TARGET_MISMATCH`), device unplugged, flashing in progress, completed, failed and
verification failed. Success = `status: "completed"` with `flash_confirmed: true`, set only by the desktop agent.

## Status — read this

| Area | State |
|---|---|
| Cloud Worker, MCP, pairing, transfer relay, job lifecycle | Implemented, deployed, and covered by automated tests (below). |
| Desktop agent core, transfer, manifest validation, reconnection | Implemented and tested end-to-end against a real (local) Worker. |
| **Real hardware flashing (esptool / avrdude / STM32 / wlink)** | **Implemented but never run against a physical board.** esptool is built in and was exercised only for CLI/failure paths; the other tools' command lines are unit-tested. |
| Windows-specific code (DPAPI, WM_DEVICECHANGE, PnP programmer scan, HKCU autostart, tray) | Written but **not executed on Windows** (development was on Linux). |
| Windows `.exe` | Build script + CI job provided; a Linux PyInstaller build was verified to start. No Windows build was produced here. |

See "Remaining limitations" in the project notes for the full list.

## Tests

```bash
cd cloud && npx vitest run                         # 34 unit tests (manifest vectors, framing, crypto, device selection)
cd desktop && QT_QPA_PLATFORM=offscreen pytest tests   # 48 unit tests + UI render smoke test
QT_QPA_PLATFORM=offscreen pytest tests                 # 20 end-to-end tests: local Worker + real agent core + SIMULATED boards
node --test scripts/setup.test.mjs                 # setup-script helpers
```

The end-to-end suite pairs a real agent through the real web flow, then drives the real MCP endpoint: happy-path flash with
streamed upload, SHA-256 tampering, size mismatch, idempotency/conflict, busy device, cancel during transfer and flash,
verification failure, programmer failure, verify-only, reconnect, revoke, allow-list, serial/boot-log. The "boards" are
`SimFlasher` virtual devices (`--simulate`), so **these tests prove the protocol and job logic, not physical flashing.**
