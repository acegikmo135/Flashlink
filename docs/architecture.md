# Architecture

```
 Claude Code Cloud ──MCP (Streamable HTTP, Bearer)──▶  Cloudflare Worker  ◀──WSS (outbound only)── MCU Bridge (Windows)
   │  compiles firmware                                  │  UserHub DO (per account)                │  detects USB/COM
   │                                                      │  TransferRelay DO (per job)              │  validates + flashes
   └──── PUT firmware (HTTPS stream) ───────────────────▶│  D1: users/agents/tokens/jobs metadata   │  returns logs + result
                                                          └──── GET firmware (HTTPS stream) ───────▶│
```

Nothing connects *into* the PC: the agent opens one WSS connection and HTTPS requests. No localhost server,
no port forwarding, no tunnel.

## Cloud (`cloud/`)

| Piece | Role |
|---|---|
| `src/index.ts` | Router: web pages, pairing API, agent WebSocket, transfer endpoints, `/mcp`. |
| `durable-objects/user-hub.ts` | One per account. Hibernatable WebSockets for agents, device registry, job state machine, command routing (`read_serial`, `reset`, `identify`, …), alarm-based expiry/stale detection. |
| `durable-objects/transfer-relay.ts` | One per job. **In-memory** sliding window (16 × 64 KiB per file) between the uploader and the agent. Never touches storage. |
| `mcp/server.ts` | 14 MCP tools (SDK `McpServer`, stateless Streamable HTTP, strict zod input schemas, structured output). |
| `auth/web.ts`, `auth/account.ts`, `auth/agent-account.ts` | JSON API for the web app (`/api/web/*`) and for the desktop app's Account page (`/api/agent/account…`, device credential). Shared account logic. |
| `web/` (repo root) | React + Tailwind + shadcn/ui SPA built by Vite into `web/dist`, served through the Worker's `ASSETS` binding (`run_worker_first`), with CSP and SPA fallback. |
| `auth/` | Account sign-up/login (PBKDF2-SHA256, session cookie), device pairing, token auth. |
| `jobs/manifest.ts` | Strict manifest validation (mirrored in Python, tested against shared vectors). |
| D1 | `users`, `web_sessions`, `pairings`, `agents`, `mcp_tokens`, `jobs`, `rate_limits` — metadata only. |

### Firmware transfer (no R2/KV/D1/DO storage)

1. `flash_firmware` validates the manifest, selects/validates the device and creates the job in the UserHub DO.
   The agent is told over the WebSocket (`job.new`) and receives a job-scoped, HMAC-signed *download* token.
   Claude receives a job-scoped *upload* token and ready-made `curl` commands.
2. The agent starts `GET /api/transfers/{job}/{i}?from=N` (long-poll: `204` until the upload starts).
3. Claude runs `PUT /api/uploads/{job}/{i}` (streamed with `curl -T`).
4. The relay cuts the upload body into 64 KiB chunks, hashes the stream (`DigestStream`, SHA-256 vs manifest — it refuses
   the final chunk on mismatch), and applies back-pressure when 16 chunks are un-acknowledged.
5. The download stream is framed: `seq | len | crc32 | flags | payload`. The agent writes each chunk to a temp file and
   acknowledges cumulatively (`POST …/ack {seq}`) every 4 chunks; the relay frees acknowledged chunks.
6. If the connection drops, the agent re-requests `?from=<next chunk>`; unacknowledged chunks are still in the window,
   so transfers resume with bounded memory. Stalls (>90 s without progress) fail the job.
7. The PUT response returns only after every chunk is acknowledged, so "upload finished" means "delivered".
8. The agent verifies size + SHA-256 of the whole file, checks image headers (e.g. ESP image chip-id vs target), flashes,
   then **deletes the job directory** (always, in `finally`).

### Job states

`awaiting_upload → transferring → flashing → verifying → completed | failed | verification_failed | cancelled | expired`.
`completed` is accepted by the cloud **only** if the agent sent `confirmed_by_agent: true` (and `verified: true` when
verification was requested). Idempotency: same `job_id` + same manifest returns the existing job; a different manifest is
`JOB_CONFLICT`. The agent ignores replayed `job.new` messages.

### Error vocabulary Claude can act on

`NO_AGENT_CONNECTED`, `NO_DEVICE`, `MULTIPLE_DEVICES`, `DEVICE_NOT_FOUND`, `UNSUPPORTED_MCU`, `TARGET_MISMATCH`,
`DEVICE_DISCONNECTED`, `DEVICE_NOT_ALLOWED`, `FLASH_IN_PROGRESS`, `MANIFEST_INVALID`, `TOOLCHAIN_MISSING`,
`PROGRAMMER_MISSING`, `TRANSFER_FAILED`, `TRANSFER_TIMEOUT`, `HASH_MISMATCH`, `FLASH_FAILED`, `VERIFICATION_FAILED`,
`JOB_*`, `CANCELLED`, `TIMEOUT`, `AGENT_DISCONNECTED`, `SERIAL_ERROR`, `PROBE_FAILED`, `RATE_LIMITED`.

## Desktop agent (`desktop/`)

Python 3.12 + PySide6 (QtWidgets only) in one-folder PyInstaller build. The agent core (`app/core/agent.py`) is UI-free;
the Qt window and `--headless` mode both drive it.

* `hardware/usb.py` — COM-port enumeration (pyserial), non-serial programmer detection (PnP query on Windows, sysfs on Linux),
  VID/PID classification, stable device ids. `devices.py` merges, applies the allow policy and tool availability.
* `hardware/flashers/` — one backend per family behind a common interface: `esp.py` (esptool, run as a child process),
  `avr.py` (avrdude), `stm32.py` (STM32CubeProgrammer CLI / OpenOCD), `wch.py` (wlink). `simulated.py` is a dev/CI-only fake.
* `networking/transfer.py` — chunked, acknowledged, resumable download. `core/agent.py` — pairing, WS loop with exponential
  backoff + jitter, job runner threads, fixed command vocabulary.
* `security/credstore.py` — DPAPI (`CryptProtectData`) for the device token.
* `ui/` — dark monochrome QSS theme, hairline progress bars, tray icon, QR pairing screen.

Resource profile: no Electron/WebEngine/QML; one asyncio thread (WebSocket), one 2 s device poll (+ `WM_DEVICECHANGE`),
child processes only while flashing. Measured numbers are in the README.

## Cloud compilation (chats without a code sandbox)

`compile_firmware` / `build_and_flash` (cloud/src/compile/backend.ts) send the Arduino sketch to a remote build service
(default: Wokwi's public `hexi` server; replace via the `COMPILER_URL` variable) which returns Intel HEX (AVR) or an ESP32
application image. For `build_and_flash` the Worker checks the target device first, builds the manifest *from the build output*
(ESP flash mode/size/frequency are read from the image header), creates the job and then acts as the uploader: the bytes are
PUT straight into the job's TransferRelay (memory only) while the desktop downloads them. Nothing is stored; the source is
sent to the build service, which is the one privacy trade-off.
