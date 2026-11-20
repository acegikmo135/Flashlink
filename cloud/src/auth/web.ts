/** Cookie sessions + the JSON API consumed by the web app (served from /api/web/*). */
import type { Env } from "../env";
import { hashPassword, randomId, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { clientIp, errorJson, json } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";
import { createToken, loadOverview, revokeAgent, revokeApp, revokeToken } from "./account";
import { oauthAuthorizeInfo, oauthDecision } from "./oauth";

export { revokeAgent };

const SESSION_COOKIE = "mcb_session";
const SESSION_TTL_MS = 14 * 24 * 3600_000;

function cookieOf(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function setCookie(request: Request, value: string, maxAgeSec: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export interface SessionUser {
  id: string;
  email: string;
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const sid = cookieOf(request, SESSION_COOKIE);
  if (!sid) return null;
  return (
    (await env.DB.prepare("SELECT u.id AS id, u.email AS email FROM web_sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.expires_at > ?2")
      .bind(await sha256Hex(sid), Date.now())
      .first<SessionUser>()) ?? null
  );
}

async function startSession(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const sid = randomToken(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO web_sessions (id_hash, user_id, created_at, expires_at) VALUES (?1,?2,?3,?4)").bind(await sha256Hex(sid), user.id, now, now + SESSION_TTL_MS).run();
  return json({ ok: true, user }, 200, { "set-cookie": setCookie(request, sid, SESSION_TTL_MS / 1000) });
}

/** CSRF defence for state-changing browser requests: same-origin only (Sec-Fetch-Site is unforgeable by pages). */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function body<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const text = await request.text();
    if (text.length > 16_384) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 256) => (typeof v === "string" ? v.slice(0, max) : "");

export async function handleWebApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/web/")) return null;
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request)) return errorJson(403, "FORBIDDEN", "Cross-site request blocked.");
  const user = await currentUser(request, env);
  const unauth = () => errorJson(401, "UNAUTHENTICATED", "Sign in required.");

  if (path === "/api/web/session" && method === "GET") {
    return json({ ok: true, user, config: { origin: url.origin, installer_url: `${url.origin}/download/MCUBridge-Setup.exe`, signup_requires_invite: true } });
  }

  if (path === "/api/web/signup" && method === "POST") {
    const b = await body(request);
    if (!b) return errorJson(400, "BAD_REQUEST", "JSON body required.");
    const email = str(b.email, 320).trim().toLowerCase();
    const pw = str(b.password, 300);
    if (!(await rateLimit(env, `signup:${clientIp(request)}`, 8, 3600))) return errorJson(429, "RATE_LIMITED", "Too many attempts. Try again later.");
    if (!/^[^@\s]{1,64}@[^@\s]{1,255}$/.test(email)) return errorJson(400, "INVALID_EMAIL", "Enter a valid email address.");
    if (pw.length < 10 || pw.length > 200) return errorJson(400, "WEAK_PASSWORD", "Password must be 10–200 characters.");
    if (!env.SIGNUP_CODE || !timingSafeEqual(str(b.invite), env.SIGNUP_CODE)) return errorJson(403, "INVALID_INVITE", "Invalid invite code.");
    const u = { id: randomId("usr", 9), email };
    try {
      await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?1,?2,?3,?4)").bind(u.id, email, await hashPassword(pw), Date.now()).run();
    } catch {
      return errorJson(409, "EMAIL_EXISTS", "An account with this email already exists.");
    }
    return startSession(request, env, u);
  }

  if (path === "/api/web/login" && method === "POST") {
    const b = await body(request);
    if (!b) return errorJson(400, "BAD_REQUEST", "JSON body required.");
    const email = str(b.email, 320).trim().toLowerCase();
    if (!(await rateLimit(env, `login:${clientIp(request)}`, 20, 900)) || !(await rateLimit(env, `login-acct:${email}`, 10, 900))) return errorJson(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
    const row = await env.DB.prepare("SELECT id, email, password_hash FROM users WHERE email = ?1").bind(email).first<{ id: string; email: string; password_hash: string }>();
    // always run a hash so unknown accounts cost the same time
    const ok = row ? await verifyPassword(str(b.password, 300), row.password_hash) : (await verifyPassword("x", "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAA"), false);
    if (!row || !ok) return errorJson(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    return startSession(request, env, { id: row.id, email: row.email });
  }

  if (path === "/api/web/logout" && method === "POST") {
    const sid = cookieOf(request, SESSION_COOKIE);
    if (sid) await env.DB.prepare("DELETE FROM web_sessions WHERE id_hash = ?1").bind(await sha256Hex(sid)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie(request, "", 0) });
  }

  // ------------------------------------------------- OAuth consent (called by the SPA)
  if (path === "/api/web/oauth/authorize" && method === "GET") return oauthAuthorizeInfo(env, url, user);

  if (!user) return unauth();

  if (path === "/api/web/oauth/decision" && method === "POST") {
    const b = await body<Record<string, string>>(request);
    return b ? oauthDecision(env, url, user, b) : errorJson(400, "BAD_REQUEST", "JSON body required.");
  }

  if (path === "/api/web/overview" && method === "GET") return json({ ok: true, ...(await loadOverview(env, user.id, user.email)) });

  if (path === "/api/web/tokens" && method === "POST") {
    const b = await body(request);
    const r = await createToken(env, user.id, str(b?.name, 60));
    return r.ok ? json({ ok: true, token: r.token, id: r.id }) : errorJson(400, "TOKEN_LIMIT", r.error);
  }
  if (path === "/api/web/tokens/revoke" && method === "POST") {
    const b = await body(request);
    return json({ ok: await revokeToken(env, user.id, str(b?.id, 64)) });
  }
  if (path === "/api/web/apps/revoke" && method === "POST") {
    const b = await body(request);
    await revokeApp(env, user.id, str(b?.client_id, 80));
    return json({ ok: true });
  }
  if (path === "/api/web/agents/revoke" && method === "POST") {
    const b = await body(request);
    return json({ ok: await revokeAgent(env, user.id, str(b?.id, 64)) });
  }

  if (path === "/api/web/password" && method === "POST") {
    const b = await body(request);
    const next = str(b?.new_password, 300);
    if (!(await rateLimit(env, `pw-change:${user.id}`, 10, 900))) return errorJson(429, "RATE_LIMITED", "Too many attempts.");
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(str(b?.current_password, 300), row.password_hash))) return errorJson(403, "INVALID_CREDENTIALS", "Current password is incorrect.");
    if (next.length < 10 || next.length > 200) return errorJson(400, "WEAK_PASSWORD", "New password must be 10–200 characters.");
    const keep = await sha256Hex(cookieOf(request, SESSION_COOKIE) ?? "");
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(next), user.id),
      env.DB.prepare("DELETE FROM web_sessions WHERE user_id = ?1 AND id_hash != ?2").bind(user.id, keep),
    ]);
    return json({ ok: true });
  }

  // ------------------------------------------------------------------ desktop pairing
  if (path === "/api/web/pair" && method === "GET") {
    const code = str(url.searchParams.get("code"), 16).toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return errorJson(400, "BAD_CODE", "Malformed pairing code.");
    if (!(await rateLimit(env, `pair-view:${user.id}`, 60, 600))) return errorJson(429, "RATE_LIMITED", "Too many requests.");
    const row = await env.DB.prepare("SELECT device_name, platform, status, expires_at FROM pairings WHERE user_code = ?1").bind(code).first<{ device_name: string; platform: string; status: string; expires_at: number }>();
    if (!row || row.expires_at < Date.now()) return errorJson(410, "EXPIRED", "This pairing request expired. Restart pairing in the desktop app.");
    if (row.status !== "pending") return errorJson(409, "HANDLED", `This pairing request is already ${row.status}.`);
    return json({ ok: true, device_name: row.device_name, platform: row.platform, expires_at: row.expires_at });
  }
  if (path === "/api/web/pair/decision" && method === "POST") {
    const b = await body(request);
    const code = str(b?.code, 16).toUpperCase();
    const approve = b?.decision === "approve";
    const res = await env.DB.prepare("UPDATE pairings SET status = ?1, user_id = ?2 WHERE user_code = ?3 AND status = 'pending' AND expires_at > ?4")
      .bind(approve ? "approved" : "denied", approve ? user.id : null, code, Date.now())
      .run();
    return res.meta.changes ? json({ ok: true, approved: approve }) : errorJson(410, "EXPIRED", "The request expired or was already handled.");
  }

  return errorJson(404, "NOT_FOUND", "Unknown API route.");
}
