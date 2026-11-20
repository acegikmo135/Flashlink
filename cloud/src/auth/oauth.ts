/**
 * OAuth 2.1 authorization server for the MCP endpoint, so MCU Bridge can be added as a
 * claude.ai "custom connector" (and by any other MCP client that speaks the MCP authorization spec).
 *
 *  - RFC 9728  protected-resource metadata  (/.well-known/oauth-protected-resource)
 *  - RFC 8414  authorization-server metadata (/.well-known/oauth-authorization-server)
 *  - RFC 7591  dynamic client registration   (POST /oauth/register)
 *  - authorization code flow with mandatory PKCE (S256), public clients, exact redirect-URI matching
 *  - short-lived access tokens + rotating refresh tokens with reuse detection
 *
 * Users authenticate with their existing MCU Bridge account (cookie session) and explicitly consent.
 */
import type { Env } from "../env";
import { b64urlEncode, randomId, randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { clientIp, errorJson, json } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";
import type { SessionUser } from "./web";
import { revokeApp } from "./account";

const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 86_400_000;
const CODE_TTL_MS = 10 * 60_000;
const SCOPE = "mcp";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id, accept",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
  "access-control-max-age": "86400",
};

export function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) r.headers.set(k, v);
  return r;
}

const oauthError = (error: string, description: string, status = 400) =>
  withCors(json({ error, error_description: description }, status, { pragma: "no-cache" }));

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: [SCOPE], resource_name: "MCU Bridge" };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

/** Redirect URI policy: https, loopback http, or an app-specific custom scheme. No fragments. */
export function validRedirectUri(uri: string): boolean {
  if (uri.length > 512) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return !["javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ws:", "wss:", "ftp:"].includes(u.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

interface Client {
  id: string;
  name: string;
  redirect_uris: string[];
}

async function getClient(env: Env, id: string | null): Promise<Client | null> {
  if (!id || id.length > 80) return null;
  const row = await env.DB.prepare("SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?1").bind(id).first<{ id: string; name: string; redirect_uris: string }>();
  return row ? { id: row.id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) } : null;
}

async function register(request: Request, env: Env): Promise<Response> {
  if (!(await rateLimit(env, `oauth-register:${clientIp(request)}`, 30, 3600))) return oauthError("temporarily_unavailable", "Too many registrations.", 429);
  let body: Record<string, unknown> | null = null;
  try {
    const text = await request.text();
    if (text.length > 8192) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON (max 8 KB).");
  }
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be 1-5 absolute https, loopback-http or custom-scheme URIs without fragments.");
  }
  const name = String(body?.client_name ?? "MCP client").replace(/[\u0000-\u001f<>]/g, "").slice(0, 60) || "MCP client";
  const id = randomId("cli", 12);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?1,?2,?3,?4)").bind(id, name, JSON.stringify(uris), now).run();
  return withCors(
    json(
      { client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: SCOPE },
      201,
    ),
  );
}

interface AuthParams {
  client: Client;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  resource: string;
}

type AuthCheck = { ok: true; p: AuthParams } | { ok: false; error: string } | { ok: false; redirect: string };

function redirectWith(uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== "") u.searchParams.set(k, v);
  return u.toString();
}

/** Validate an authorization request. Errors before the redirect URI is trusted are shown, never redirected. */
async function checkAuthRequest(env: Env, q: URLSearchParams, origin: string): Promise<AuthCheck> {
  const client = await getClient(env, q.get("client_id"));
  const redirect = q.get("redirect_uri") ?? "";
  if (!client) return { ok: false, error: "This application is not registered. Remove and re-add the connector." };
  if (!client.redirect_uris.includes(redirect)) return { ok: false, error: "The redirect address does not match the application's registration." };
  const state = q.get("state") ?? "";
  const fail = (error: string, desc: string) => ({ ok: false as const, redirect: redirectWith(redirect, { error, error_description: desc, state }) });
  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request", "PKCE with S256 is required");
  const resource = q.get("resource") ?? `${origin}/mcp`;
  if (resource !== `${origin}/mcp` && resource !== origin) return fail("invalid_target", "Unknown resource");
  return { ok: true, p: { client, redirect_uri: redirect, state, code_challenge: challenge, resource: `${origin}/mcp` } };
}

/** JSON for the consent screen. Errors are returned (never redirected) until the redirect URI is trusted. */
export async function oauthAuthorizeInfo(env: Env, url: URL, user: SessionUser | null): Promise<Response> {
  const chk = await checkAuthRequest(env, url.searchParams, url.origin);
  if (!chk.ok) return "error" in chk ? json({ ok: true, status: "error", message: chk.error }) : json({ ok: true, status: "redirect", url: chk.redirect });
  if (!user) return json({ ok: true, status: "login_required" });
  const p = chk.p;
  let host = p.redirect_uri;
  try {
    const u = new URL(p.redirect_uri);
    host = u.host || u.protocol;
  } catch {
    /* validated at registration */
  }
  return json({
    ok: true,
    status: "consent",
    user: user.email,
    client_name: p.client.name,
    redirect_host: host,
    fields: { client_id: p.client.id, redirect_uri: p.redirect_uri, state: p.state, code_challenge: p.code_challenge, resource: p.resource },
  });
}

/** Consent decision. Hidden fields are never trusted: everything is re-validated. */
export async function oauthDecision(env: Env, url: URL, user: SessionUser, f: Record<string, string>): Promise<Response> {
  const chk = await checkAuthRequest(env, new URLSearchParams({ response_type: "code", code_challenge_method: "S256", client_id: String(f.client_id ?? ""), redirect_uri: String(f.redirect_uri ?? ""), state: String(f.state ?? ""), code_challenge: String(f.code_challenge ?? ""), resource: String(f.resource ?? "") }), url.origin);
  if (!chk.ok) return "error" in chk ? errorJson(400, "INVALID_REQUEST", chk.error) : json({ ok: true, redirect: chk.redirect });
  const p = chk.p;
  if (f.decision !== "approve") return json({ ok: true, redirect: redirectWith(p.redirect_uri, { error: "access_denied", error_description: "The user denied the request", state: p.state }) });
  if (!(await rateLimit(env, `oauth-consent:${user.id}`, 30, 3600))) return errorJson(429, "RATE_LIMITED", "Too many authorization attempts.");
  const code = randomToken(32);
  await env.DB.prepare("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
    .bind(await sha256Hex(code), p.client.id, user.id, p.redirect_uri, p.code_challenge, p.resource, Date.now() + CODE_TTL_MS)
    .run();
  return json({ ok: true, redirect: redirectWith(p.redirect_uri, { code, state: p.state }) });
}

async function issueTokens(env: Env, clientId: string, clientName: string, userId: string, family: string) {
  const access = `mcb_mcp_${randomToken(32)}`;
  const refresh = `mcb_rt_${randomToken(32)}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mcp_tokens (id, user_id, name, token_hash, created_at, expires_at, client_id) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(randomId("tok", 8), userId, `OAuth: ${clientName}`, await sha256Hex(access), now, now + ACCESS_TTL_MS, clientId),
    env.DB.prepare("INSERT INTO oauth_refresh (token_hash, client_id, user_id, family, created_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6)").bind(await sha256Hex(refresh), clientId, userId, family, now, now + REFRESH_TTL_MS),
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: SCOPE };
}

const revokeGrant = revokeApp;

async function token(request: Request, env: Env): Promise<Response> {
  if (!(await rateLimit(env, `oauth-token:${clientIp(request)}`, 120, 60))) return oauthError("temporarily_unavailable", "Too many requests.", 429);
  let f: URLSearchParams;
  try {
    const ct = request.headers.get("content-type") ?? "";
    const text = (await request.text()).slice(0, 8192);
    f = ct.includes("json") ? new URLSearchParams(Object.entries(JSON.parse(text)).map(([k, v]) => [k, String(v)])) : new URLSearchParams(text);
  } catch {
    return oauthError("invalid_request", "Unparseable body.");
  }
  const client = await getClient(env, f.get("client_id"));
  if (!client) return oauthError("invalid_client", "Unknown client_id.", 401);
  const grant = f.get("grant_type");

  if (grant === "authorization_code") {
    const code = f.get("code") ?? "";
    const verifier = f.get("code_verifier") ?? "";
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError("invalid_request", "code and a valid PKCE code_verifier are required.");
    // single use: consume atomically
    const row = await env.DB.prepare("DELETE FROM oauth_codes WHERE code_hash = ?1 RETURNING client_id, user_id, redirect_uri, code_challenge, expires_at")
      .bind(await sha256Hex(code))
      .first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
    if (!row || row.expires_at < Date.now() || row.client_id !== client.id) return oauthError("invalid_grant", "Invalid or expired authorization code.");
    if (f.get("redirect_uri") !== row.redirect_uri) return oauthError("invalid_grant", "redirect_uri mismatch.");
    const challenge = b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    if (!timingSafeEqual(challenge, row.code_challenge)) return oauthError("invalid_grant", "PKCE verification failed.");
    return withCors(json(await issueTokens(env, client.id, client.name, row.user_id, randomId("fam", 8)), 200, { pragma: "no-cache" }));
  }

  if (grant === "refresh_token") {
    const rt = f.get("refresh_token") ?? "";
    if (!rt.startsWith("mcb_rt_") || rt.length > 100) return oauthError("invalid_grant", "Invalid refresh token.");
    const hash = await sha256Hex(rt);
    const row = await env.DB.prepare("SELECT client_id, user_id, family, expires_at, used_at FROM oauth_refresh WHERE token_hash = ?1")
      .bind(hash)
      .first<{ client_id: string; user_id: string; family: string; expires_at: number; used_at: number | null }>();
    if (!row || row.client_id !== client.id || row.expires_at < Date.now()) return oauthError("invalid_grant", "Invalid or expired refresh token.");
    if (row.used_at) {
      // a rotated token was replayed: assume theft and revoke the whole grant
      await revokeGrant(env, row.user_id, client.id);
      return oauthError("invalid_grant", "Refresh token reuse detected; the grant was revoked. Reconnect the application.");
    }
    const claim = await env.DB.prepare("UPDATE oauth_refresh SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL").bind(Date.now(), hash).run();
    if (!claim.meta.changes) return oauthError("invalid_grant", "Refresh token already used.");
    return withCors(json(await issueTokens(env, client.id, client.name, row.user_id, row.family), 200, { pragma: "no-cache" }));
  }
  return oauthError("unsupported_grant_type", "Supported: authorization_code, refresh_token.");
}

async function revoke(request: Request, env: Env): Promise<Response> {
  // RFC 7009: always 200. Handles refresh tokens (revokes the grant) and access tokens.
  const f = new URLSearchParams((await request.text().catch(() => "")).slice(0, 4096));
  const t = f.get("token") ?? "";
  if (t.startsWith("mcb_rt_")) {
    const row = await env.DB.prepare("SELECT client_id, user_id FROM oauth_refresh WHERE token_hash = ?1").bind(await sha256Hex(t)).first<{ client_id: string; user_id: string }>();
    if (row) await revokeGrant(env, row.user_id, row.client_id);
  } else if (t.startsWith("mcb_mcp_")) {
    await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE token_hash = ?2 AND client_id IS NOT NULL").bind(Date.now(), await sha256Hex(t)).run();
  }
  return withCors(new Response(null, { status: 200 }));
}

/** Routes: /.well-known/*, /oauth/*. Returns null when the path is not an OAuth path. */
export async function handleOAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  const origin = url.origin;
  const isWellKnown = p.startsWith("/.well-known/oauth-");
  if (!isWellKnown && !p.startsWith("/oauth/")) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (request.method === "GET" && /^\/\.well-known\/oauth-protected-resource(\/.*)?$/.test(p)) return withCors(json(protectedResourceMetadata(origin), 200, { "cache-control": "public, max-age=300" }));
  if (request.method === "GET" && /^\/\.well-known\/oauth-authorization-server(\/.*)?$/.test(p)) return withCors(json(authorizationServerMetadata(origin), 200, { "cache-control": "public, max-age=300" }));
  if (request.method === "POST" && p === "/oauth/register") return register(request, env);
  if (request.method === "POST" && p === "/oauth/token") return token(request, env);
  if (request.method === "POST" && p === "/oauth/revoke") return revoke(request, env);
  return null;
}
