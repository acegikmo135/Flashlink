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

Option A — build locally (Python 3.12): `.\scripts\build-desktop.ps1` → `desktop\dist\MCUBridge\MCUBridge.exe`
(or unzip `MCUBridge-win64.zip`). Option B — download `MCUBridge-win64` from the GitHub Actions run.

First start shows the pairing screen: open the link (or scan the QR code), sign in, compare the code, **Approve**. The app stores
a revocable credential (DPAPI) and reconnects automatically from then on. Settings → *Start with Windows* is optional.

Optional tools (only for the families you use) go in `tools\` next to the exe — see `tools\README.txt`. ESP32/ESP8266 work out of the box.
USB drivers: CP210x / CH340 / FTDI bridges need their usual Windows drivers (Windows Update installs most); ST-Link needs the
ST-Link driver; WCH-LinkE needs the WCH driver.

## 4. Connect Claude Code (Cloud)

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
