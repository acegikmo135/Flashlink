import type { Env } from "../env";
import { randomId, randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { clientIp, errorJson, json, readJson } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";

const PAIRING_TTL_MS = 10 * 60_000;
// no 0/O/1/I/L to keep the code unambiguous when read off a screen
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** POST /api/pair/start — called by the desktop app on first launch. */
export async function pairStart(request: Request, env: Env): Promise<Response> {
  if (!(await rateLimit(env, `pair-start:${clientIp(request)}`, Number(env.PAIR_START_LIMIT) || 15, 3600))) return errorJson(429, "RATE_LIMITED", "Too many pairing attempts. Try again later.");
  const body = await readJson<{ install_id?: string; device_name?: string; platform?: string }>(request, 4096);
  const installId = body?.install_id;
  if (!body || typeof installId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(installId)) return errorJson(400, "BAD_REQUEST", "install_id is required.");
  const deviceName = String(body.device_name ?? "Windows PC").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 48) || "Windows PC";
  const platform = String(body.platform ?? "unknown").replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 48) || "unknown";

  const id = randomId("pair", 10);
  const secret = randomToken(32);
  const now = Date.now();
  let code = newUserCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await env.DB.prepare(
        "INSERT INTO pairings (id, user_code, secret_hash, install_id, device_name, platform, status, created_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8)",
      )
        .bind(id, code, await sha256Hex(secret), installId, deviceName, platform, now, now + PAIRING_TTL_MS)
        .run();
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      code = newUserCode(); // unique-collision retry
    }
  }
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    pairing_id: id,
    poll_secret: secret,
    user_code: code,
    verification_url: `${origin}/pair?code=${code}`,
    expires_at: now + PAIRING_TTL_MS,
    poll_interval_seconds: 2,
  });
}

/** POST /api/pair/poll — desktop polls until the user approves in the browser. */
export async function pairPoll(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ pairing_id?: string; poll_secret?: string }>(request, 2048);
  if (!body?.pairing_id || !body.poll_secret) return errorJson(400, "BAD_REQUEST", "pairing_id and poll_secret required.");
  if (!(await rateLimit(env, `pair-poll:${body.pairing_id}`, 400, 600))) return errorJson(429, "RATE_LIMITED", "Polling too fast.");

  const row = await env.DB.prepare("SELECT id, secret_hash, status, user_id, device_name, platform, install_id, expires_at FROM pairings WHERE id = ?1")
    .bind(body.pairing_id)
    .first<{ id: string; secret_hash: string; status: string; user_id: string | null; device_name: string; platform: string; install_id: string; expires_at: number }>();
  if (!row || !timingSafeEqual(await sha256Hex(body.poll_secret), row.secret_hash)) return errorJson(404, "NOT_FOUND", "Unknown pairing.");
  if (Date.now() > row.expires_at && row.status !== "consumed") return json({ ok: true, status: "expired" });
  if (row.status === "pending") return json({ ok: true, status: "pending" });
  if (row.status === "denied") return json({ ok: true, status: "denied" });
  if (row.status === "consumed") return errorJson(410, "ALREADY_CLAIMED", "This pairing's credential was already issued.");

  // approved → issue the device-specific credential exactly once
  const agentId = randomId("agt", 9);
  const token = `mcb_agent_${randomToken(32)}`;
  const claim = await env.DB.prepare("UPDATE pairings SET status='consumed', agent_id=?1 WHERE id=?2 AND status='approved'").bind(agentId, row.id).run();
  if (!claim.meta.changes) return errorJson(410, "ALREADY_CLAIMED", "This pairing's credential was already issued.");
  await env.DB.prepare("INSERT INTO agents (id, user_id, name, install_id, platform, token_hash, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
    .bind(agentId, row.user_id, row.device_name, row.install_id, row.platform, await sha256Hex(token), Date.now())
    .run();
  const user = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(row.user_id).first<{ email: string }>();
  return json({ ok: true, status: "approved", agent_id: agentId, agent_token: token, account_email: user?.email ?? null });
}
