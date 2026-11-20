import type { Env } from "../env";
import { hashPassword, randomId, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { clientIp } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";
import { hubOf } from "../lib/hub";
import { authPage, dashboardPage, landingPage, pairPage, simplePage } from "./pages";

const SESSION_COOKIE = "mcb_session";
const SESSION_TTL_MS = 14 * 24 * 3600_000;

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; script-src 'none'",
      ...headers,
    },
  });

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, ...headers } });

function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

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
  const row = await env.DB.prepare(
    "SELECT u.id AS id, u.email AS email FROM web_sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.expires_at > ?2",
  )
    .bind(await sha256Hex(sid), Date.now())
    .first<SessionUser>();
  return row ?? null;
}

async function startSession(request: Request, env: Env, userId: string, to: string): Promise<Response> {
  const sid = randomToken(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO web_sessions (id_hash, user_id, created_at, expires_at) VALUES (?1,?2,?3,?4)")
    .bind(await sha256Hex(sid), userId, now, now + SESSION_TTL_MS)
    .run();
  return redirect(to, { "set-cookie": setCookie(request, sid, SESSION_TTL_MS / 1000) });
}

/** CSRF defence for state-changing browser requests: same-origin only. */
function sameOrigin(request: Request): boolean {
  // Browsers always send Sec-Fetch-Site; it is the most reliable signal
  // (Origin can legitimately be "null" under some Referrer-Policy settings).
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function form(request: Request): Promise<URLSearchParams | null> {
  if (!sameOrigin(request)) return null;
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded")) return null;
  const text = await request.text();
  if (text.length > 8192) return null;
  return new URLSearchParams(text);
}

export async function handleWeb(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const user = await currentUser(request, env);

  if (path === "/" && method === "GET") return user ? redirect("/dashboard") : html(landingPage());

  if ((path === "/login" || path === "/signup") && method === "GET") {
    return html(authPage(path === "/login" ? "login" : "signup", { next: safeNext(url.searchParams.get("next")) === "/dashboard" ? "" : url.searchParams.get("next") ?? "" }));
  }

  if (path === "/signup" && method === "POST") {
    const f = await form(request);
    if (!f) return html(simplePage("Blocked", "Cross-site or malformed request."), 400);
    const next = f.get("next") ?? "";
    const email = (f.get("email") ?? "").trim().toLowerCase();
    const pw = f.get("password") ?? "";
    const err = (m: string, s = 400) => html(authPage("signup", { error: m, next, email }), s);
    if (!(await rateLimit(env, `signup:${clientIp(request)}`, 8, 3600))) return err("Too many attempts. Try again later.", 429);
    if (!/^[^@\s]{1,64}@[^@\s]{1,255}$/.test(email)) return err("Enter a valid email address.");
    if (pw.length < 10 || pw.length > 200) return err("Password must be 10–200 characters.");
    if (!env.SIGNUP_CODE || !timingSafeEqual(f.get("invite") ?? "", env.SIGNUP_CODE)) return err("Invalid invite code.", 403);
    const id = randomId("usr", 9);
    try {
      await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?1,?2,?3,?4)").bind(id, email, await hashPassword(pw), Date.now()).run();
    } catch {
      return err("An account with this email already exists.", 409);
    }
    return startSession(request, env, id, safeNext(next));
  }

  if (path === "/login" && method === "POST") {
    const f = await form(request);
    if (!f) return html(simplePage("Blocked", "Cross-site or malformed request."), 400);
    const next = f.get("next") ?? "";
    const email = (f.get("email") ?? "").trim().toLowerCase();
    const err = (m: string, s = 401) => html(authPage("login", { error: m, next, email }), s);
    if (!(await rateLimit(env, `login:${clientIp(request)}`, 20, 900)) || !(await rateLimit(env, `login-acct:${email}`, 10, 900))) return err("Too many attempts. Try again in a few minutes.", 429);
    const row = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?1").bind(email).first<{ id: string; password_hash: string }>();
    // always run a hash to keep timing similar for unknown accounts
    const ok = row ? await verifyPassword(f.get("password") ?? "", row.password_hash) : (await verifyPassword("x", "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAA"), false);
    if (!row || !ok) return err("Invalid email or password.");
    return startSession(request, env, row.id, safeNext(next));
  }

  if (path === "/logout" && method === "POST") {
    if (!sameOrigin(request)) return html(simplePage("Blocked", "Cross-site request."), 400);
    const sid = cookieOf(request, SESSION_COOKIE);
    if (sid) await env.DB.prepare("DELETE FROM web_sessions WHERE id_hash = ?1").bind(await sha256Hex(sid)).run();
    return redirect("/", { "set-cookie": setCookie(request, "", 0) });
  }

  // ---------------------------------------------------------------- pairing page
  if (path === "/pair") {
    const code = (url.searchParams.get("code") ?? "").toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return html(simplePage("Invalid link", "This pairing link is malformed."), 400);
    if (!user) return redirect(`/login?next=${encodeURIComponent(`/pair?code=${code}`)}`);
    if (!(await rateLimit(env, `pair-view:${user.id}`, 60, 600))) return html(simplePage("Slow down", "Too many requests."), 429, {});
    const row = await env.DB.prepare("SELECT device_name, platform, status, expires_at FROM pairings WHERE user_code = ?1").bind(code).first<{ device_name: string; platform: string; status: string; expires_at: number }>();
    if (!row || row.expires_at < Date.now()) return html(simplePage("Link expired", "This pairing request expired. Restart pairing in the desktop app.", user.email), 410);
    if (row.status !== "pending") return html(simplePage("Already handled", `This pairing request is ${row.status}.`, user.email), 409);
    return html(pairPage({ user: user.email, code, deviceName: row.device_name, platform: row.platform }));
  }

  if (path === "/pair/decision" && method === "POST") {
    if (!user) return redirect("/login");
    const f = await form(request);
    if (!f) return html(simplePage("Blocked", "Cross-site or malformed request."), 400);
    const code = (f.get("code") ?? "").toUpperCase();
    const approve = f.get("decision") === "approve";
    const res = await env.DB.prepare("UPDATE pairings SET status = ?1, user_id = ?2 WHERE user_code = ?3 AND status = 'pending' AND expires_at > ?4")
      .bind(approve ? "approved" : "denied", approve ? user.id : null, code, Date.now())
      .run();
    if (!res.meta.changes) return html(simplePage("Could not complete", "The request expired or was already handled.", user.email), 410);
    return html(simplePage(approve ? "Desktop connected" : "Request denied", approve ? "You can close this tab. The desktop app will connect automatically." : "The desktop app was not linked.", user.email));
  }

  // ------------------------------------------------------------------- dashboard
  if (path.startsWith("/dashboard")) {
    if (!user) return redirect(`/login?next=${encodeURIComponent("/dashboard")}`);
    const origin = url.origin;
    const render = async (extra: { newToken?: string; error?: string } = {}) => {
      const agents = await env.DB.prepare("SELECT id, name, platform, created_at, last_seen_at FROM agents WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at DESC").bind(user.id).all<{ id: string; name: string; platform: string; created_at: number; last_seen_at: number | null }>();
      const tokens = await env.DB.prepare("SELECT id, name, created_at, last_used_at FROM mcp_tokens WHERE user_id = ?1 AND revoked_at IS NULL AND client_id IS NULL ORDER BY created_at DESC").bind(user.id).all<{ id: string; name: string; created_at: number; last_used_at: number | null }>();
      const apps = await env.DB.prepare("SELECT r.client_id AS client_id, c.name AS name, MAX(r.created_at) AS since FROM oauth_refresh r JOIN oauth_clients c ON c.id = r.client_id WHERE r.user_id = ?1 AND r.expires_at > ?2 GROUP BY r.client_id, c.name").bind(user.id, Date.now()).all<{ client_id: string; name: string; since: number }>();
      const hub = hubOf(env, user.id);
      const snap = await hub.snapshot();
      return html(
        dashboardPage({
          email: user.email,
          origin,
          agents: agents.results.map((a) => ({ ...a, online: !!snap.agents.find((x) => x.id === a.id)?.connected, devices: snap.devices.filter((d) => d.agent_id === a.id && d.connected).length })),
          tokens: tokens.results,
          apps: apps.results,
          ...extra,
        }),
      );
    };
    if (path === "/dashboard" && method === "GET") return render();
    if (method !== "POST") return html(simplePage("Not found", "Unknown page."), 404);
    const f = await form(request);
    if (!f) return html(simplePage("Blocked", "Cross-site or malformed request."), 400);
    if (path === "/dashboard/tokens") {
      const name = (f.get("name") ?? "").trim().slice(0, 48) || "Claude Code";
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id = ?1 AND revoked_at IS NULL AND client_id IS NULL").bind(user.id).first<{ n: number }>();
      if ((count?.n ?? 0) >= 10) return render({ error: "Token limit reached (10). Revoke one first." });
      const token = `mcb_mcp_${randomToken(32)}`;
      await env.DB.prepare("INSERT INTO mcp_tokens (id, user_id, name, token_hash, created_at) VALUES (?1,?2,?3,?4,?5)").bind(randomId("tok", 8), user.id, name, await sha256Hex(token), Date.now()).run();
      return render({ newToken: token });
    }
    if (path === "/dashboard/tokens/revoke") {
      await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(Date.now(), f.get("id") ?? "", user.id).run();
      return redirect("/dashboard");
    }
    if (path === "/dashboard/apps/revoke") {
      const cid = f.get("client_id") ?? "";
      await env.DB.batch([
        env.DB.prepare("DELETE FROM oauth_refresh WHERE user_id = ?1 AND client_id = ?2").bind(user.id, cid),
        env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE user_id = ?2 AND client_id = ?3 AND revoked_at IS NULL").bind(Date.now(), user.id, cid),
      ]);
      return redirect("/dashboard");
    }
    if (path === "/dashboard/agents/revoke") {
      await revokeAgent(env, user.id, f.get("id") ?? "");
      return redirect("/dashboard");
    }
  }
  return null;
}

/** Revoke a desktop credential and disconnect it immediately. */
export async function revokeAgent(env: Env, userId: string, agentId: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE agents SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(Date.now(), agentId, userId).run();
  if (!res.meta.changes) return false;
  await hubOf(env, userId).revokeAgent(agentId);
  return true;
}
