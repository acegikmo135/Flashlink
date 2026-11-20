# Setup

## 1. Deploy the cloud (once, on your PC)

Requirements: Node.js 20+ (`winget install OpenJS.NodeJS.LTS`), a free Cloudflare account.

```powershell
git clone <this repo>; cd Flashlink
.\scripts\setup.ps1
```

The script: checks Node/npm → `npm install` (Wrangler is a **local** dev dependency) → runs `wrangler login` if needed (your
browser opens the Cloudflare authorization page; credentials never touch this repo) → creates the D1 database `mcu-bridge` and
patches `cloud/wrangler.toml` → applies migrations → generates the invite code and job-signing key locally and uploads them
with `wrangler secret bulk` → deploys → prints the Worker URL, invite code and next steps. Secrets are kept in
`.mcu-bridge/config.json` (git-ignored). Re-run safely at any time; `-RotateSecrets` rotates them.

Later code changes: `.\scripts\deploy.ps1`.

## 2. Create your account and MCP token

Open `<worker-url>/signup` → create an account with the invite code → on the dashboard press **Create token**. The token
(`mcb_mcp_…`) is shown once.

## 3. Install the Windows app

**Fast direct download (no GitHub login):** `https://<your-worker>.workers.dev/download/MCUBridge-Setup.exe` — served from Cloudflare's
edge by the Worker (static-asset parts + Range/resume support). To publish a new installer after building it:
`cd web && npm run build && cd .. && node scripts/publish-installer.mjs desktop/dist/MCUBridge-Setup.exe && cd cloud && npx wrangler deploy`.
(Until one is published the route falls back to the GitHub release.)


Download **MCUBridge-Setup.exe** (GitHub release `desktop-latest`, or the CI artifact) and run it. It is a per-user installer:
no administrator rights, installs to `%LOCALAPPDATA%\Programs\MCU Bridge`, adds a Start-menu entry, and optionally
starts with Windows. (Unsigned build: SmartScreen may show "More info → Run anyway".) A portable `MCUBridge-win64.zip`
is published next to it. To build it yourself: `.\scripts\build-desktop.ps1` (PyInstaller; Inno Setup 6 for the installer).

First start shows the pairing screen: open the link (or scan the QR code), sign in, compare the code, **Approve**. The app stores
a revocable credential (DPAPI) and reconnects automatically from then on.

**Desktop app sections:** *Overview* (boards, live state) · *Activity* (progress for transfer / flashing / verification, errors,
history) · *Tools* · *Account* · *Settings*.

**Tools.** ESP32/ESP8266 work out of the box (esptool is built in). For other families open **Tools**: a missing tool shows a
**Download** button — avrdude 8.0 and OpenOCD 0.12.0-7 are fetched from their official releases, verified against a pinned
SHA-256 and unpacked into `%APPDATA%\MCUBridge\tools`. STM32CubeProgrammer (needs an ST account) and `wlink` open their
vendor page (**Get…**). USB drivers (CP210x / CH340 / FTDI / ST-Link / WCH-Link) come from Windows Update or the vendor.

**Account (in the app).** See your computers, create/revoke access tokens, disconnect connected apps (OAuth), open the web
dashboard, or disconnect this PC.

## 4a. Add as a claude.ai connector (recommended — OAuth, no token to copy)

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Name: `MCU Bridge`, URL: `https://<your-worker>.workers.dev/mcp` (leave OAuth client id/secret empty — clients register themselves).
3. Press **Connect**: a browser tab opens on your Worker, you sign in with your MCU Bridge account and press **Allow access**.
4. Start a new Claude Code Cloud session; the connector's tools are loaded at session start.

Manage or disconnect connectors under **Dashboard → Connected apps**. Access tokens last 1 hour and refresh automatically
(refresh tokens rotate; a replayed one revokes the whole grant).

## 4b. Connect Claude Code with a static token

```bash
claude mcp add --transport http mcu-bridge https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer mcb_mcp_..."
```

Firmware is uploaded by Claude with `curl`, so the Claude Code Cloud environment must be allowed to reach your Worker host
(add `<your-worker>.workers.dev` to the environment's allowed network hosts). Helper for building manifests in the build
environment: `curl -sO <worker>/tools/manifest.py` (stdlib only; prints a manifest with sizes and SHA-256).

Typical session: `list_devices` → `flash_firmware` (manifest) → run the returned `curl` commands → `get_flash_job` with
`wait_seconds` until `is_terminal` → `capture_boot_log`.

## Development

```bash
cd cloud && npm i && npx vitest run && npx wrangler dev          # Worker + unit tests
cd desktop && pip install -r requirements.txt
python run.py --simulate --headless --server http://127.0.0.1:8787   # agent with virtual boards
pytest tests                    # desktop unit + UI smoke + (from repo root) end-to-end
```
