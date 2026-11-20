# Security model

Flashing changes hardware, so the design assumes the MCP side may be compromised.

| Boundary | Control |
|---|---|
| Transport | HTTPS/WSS only (Cloudflare terminates TLS). The agent refuses job file URLs that are not under its configured server. |
| Accounts | PBKDF2-SHA256 (100k, per-user salt), invite-code gated sign-up, HttpOnly/SameSite=Lax session cookies, `Sec-Fetch-Site` CSRF check, CSP, rate limits. |
| Desktop pairing | Short-lived (10 min) pairing session; 8-char code shown on both the desktop and the approval page; poll secret never leaves the desktop; credential issued once, stored hashed (SHA-256) in D1. |
| Desktop credential | Per-installation, revocable (dashboard or the desktop's Settings), stored with Windows DPAPI. Revocation closes the socket immediately and fails the agent's jobs. |
| MCP | Separate per-token Bearer credentials (hashed), revocable, 120 calls/min/token. A token only reaches *its own account's* hub (one Durable Object per user). |
| Job authorization | HMAC-signed, job-bound, scope-bound (`dl`/`ul`), expiring tokens; the download token is also bound to the agent id. |
| Firmware | Exact size + SHA-256 enforced by the relay (end-to-end) and again by the agent; per-file/package size caps; image-header chip-id check; never stored in the cloud; deleted from the PC after the job (`finally`). |
| Manifest | Strict schema (unknown keys rejected), family/board/flash-config allow-lists, address alignment/range/overlap checks, no free-form flags or paths. |
| What Claude can ask the PC to do | Only: identify, flash, verify, reset, read serial, capture boot log, rescan. There is **no** shell, PowerShell, file or process primitive. Subprocess calls use argv lists, `shell=False`, fixed argument templates and sanitised temp paths. |
| Device allow-listing | The desktop decides per device whether remote flashing is allowed (`auto` for recognised boards, or `manual`). Unrecognised serial ports are never flashable. |
| Busy/safety | One job per device; serial/reset/probe blocked during flashing; cancel kills the programmer (possible partial image — reported). |

## Known limits

* Anyone holding a valid MCP token can flash allowed devices with firmware of their choosing — that is the product. Treat tokens like SSH keys; revoke freely.
* On non-Windows (development/CI) the credential falls back to a 0600 file; DPAPI is Windows-only.
* The pairing code is 40 bits and the approval page requires a signed-in user plus an explicit click; there is no phishing-proof binding beyond the code comparison.
* Cloudflare Workers Free plan limits (requests/day, DO duration) apply.
