/** Account management API for the desktop app, authenticated with the device credential (/api/agent/*). */
import type { Env } from "../env";
import { errorJson, json, readJson } from "../lib/http";
import { rateLimit } from "../lib/ratelimit";
import { createToken, loadOverview, revokeAgent, revokeApp, revokeToken } from "./account";
import type { AgentAuth } from "./tokens";

export async function agentAccountApi(request: Request, env: Env, auth: AgentAuth, path: string): Promise<Response | null> {
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(auth.user_id).first<{ email: string }>();
  if (!user) return errorJson(401, "UNAUTHORIZED", "Account no longer exists.");
  if (!(await rateLimit(env, `agent-account:${auth.agent_id}`, 120, 60))) return errorJson(429, "RATE_LIMITED", "Too many requests.");

  if (path === "/api/agent/account" && request.method === "GET") {
    return json({ ok: true, agent_id: auth.agent_id, agent_name: auth.name, ...(await loadOverview(env, auth.user_id, user.email)) });
  }
  if (request.method !== "POST") return null;
  const b = (await readJson<Record<string, unknown>>(request, 4096)) ?? {};
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

  if (path === "/api/agent/tokens") {
    const r = await createToken(env, auth.user_id, s(b.name, 60));
    return r.ok ? json({ ok: true, token: r.token, id: r.id }) : errorJson(400, "TOKEN_LIMIT", r.error);
  }
  if (path === "/api/agent/tokens/revoke") return json({ ok: await revokeToken(env, auth.user_id, s(b.id, 64)) });
  if (path === "/api/agent/apps/revoke") {
    await revokeApp(env, auth.user_id, s(b.client_id, 80));
    return json({ ok: true });
  }
  if (path === "/api/agent/agents/revoke") {
    const id = s(b.id, 64);
    if (id === auth.agent_id) return errorJson(400, "USE_SELF_REVOKE", "Use Disconnect to revoke this device.");
    return json({ ok: await revokeAgent(env, auth.user_id, id) });
  }
  return null;
}
