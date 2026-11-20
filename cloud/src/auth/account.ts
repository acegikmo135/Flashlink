/** Account operations shared by the web dashboard API and the desktop app's account API. */
import type { Env } from "../env";
import { publicAgent, publicDevice } from "../devices/public";
import { loadNames } from "../devices/names";
import { randomId, randomToken, sha256Hex } from "../lib/crypto";
import { hubOf } from "../lib/hub";

export interface Overview {
  email: string;
  stats: { agents_online: number; devices_ready: number; jobs_total: number; jobs_ok: number };
  agents: Record<string, unknown>[];
  devices: Record<string, unknown>[];
  tokens: { id: string; name: string; created_at: number; last_used_at: number | null }[];
  apps: { client_id: string; name: string; since: number }[];
  jobs: Record<string, unknown>[];
}

export async function loadOverview(env: Env, userId: string, email: string): Promise<Overview> {
  const hub = hubOf(env, userId);
  const [snap, jobsLive, agentRows, tokenRows, appRows, jobRows, totals] = await Promise.all([
    hub.snapshot(),
    hub.listJobs(),
    env.DB.prepare("SELECT id, name, platform, created_at, last_seen_at FROM agents WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at DESC").bind(userId).all<{ id: string; name: string; platform: string; created_at: number; last_seen_at: number | null }>(),
    env.DB.prepare("SELECT id, name, created_at, last_used_at FROM mcp_tokens WHERE user_id = ?1 AND revoked_at IS NULL AND client_id IS NULL ORDER BY created_at DESC").bind(userId).all<{ id: string; name: string; created_at: number; last_used_at: number | null }>(),
    env.DB.prepare("SELECT r.client_id AS client_id, c.name AS name, MAX(r.created_at) AS since FROM oauth_refresh r JOIN oauth_clients c ON c.id = r.client_id WHERE r.user_id = ?1 AND r.expires_at > ?2 GROUP BY r.client_id, c.name").bind(userId, Date.now()).all<{ client_id: string; name: string; since: number }>(),
    env.DB.prepare("SELECT id, device_id, kind, board, family, status, error_code, created_at, finished_at FROM jobs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 25").bind(userId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ok FROM jobs WHERE user_id = ?1").bind(userId).first<{ total: number; ok: number | null }>(),
  ]);
  const agentsById = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
  const names = await loadNames(env, userId);
  const devices = snap.devices.filter((d) => d.supported && d.connected && agentsById[d.agent_id]?.connected).map((d) => publicDevice(d, agentsById, jobsLive, names));
  const agents = agentRows.results.map((a) => {
    const live = agentsById[a.id];
    return { ...a, online: !!live?.connected, version: live?.version ?? null, os: live?.os ?? null, devices: devices.filter((d) => snap.devices.find((x) => x.id === d.device_id)?.agent_id === a.id).length, toolchains: live ? publicAgent(live).toolchains : {} };
  });
  return {
    email,
    stats: { agents_online: agents.filter((a) => a.online).length, devices_ready: devices.length, jobs_total: totals?.total ?? 0, jobs_ok: totals?.ok ?? 0 },
    agents,
    devices,
    tokens: tokenRows.results,
    apps: appRows.results,
    jobs: jobRows.results,
  };
}

export async function createToken(env: Env, userId: string, rawName: string): Promise<{ ok: true; token: string; id: string } | { ok: false; error: string }> {
  const name = rawName.trim().replace(/[\u0000-\u001f<>]/g, "").slice(0, 48) || "Claude Code";
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id = ?1 AND revoked_at IS NULL AND client_id IS NULL").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 10) return { ok: false, error: "Token limit reached (10). Revoke one first." };
  const token = `mcb_mcp_${randomToken(32)}`;
  const id = randomId("tok", 8);
  await env.DB.prepare("INSERT INTO mcp_tokens (id, user_id, name, token_hash, created_at) VALUES (?1,?2,?3,?4,?5)").bind(id, userId, name, await sha256Hex(token), Date.now()).run();
  return { ok: true, token, id };
}

export async function revokeToken(env: Env, userId: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL AND client_id IS NULL").bind(Date.now(), id, userId).run();
  return r.meta.changes > 0;
}

export async function revokeApp(env: Env, userId: string, clientId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_refresh WHERE user_id = ?1 AND client_id = ?2").bind(userId, clientId),
    env.DB.prepare("UPDATE mcp_tokens SET revoked_at = ?1 WHERE user_id = ?2 AND client_id = ?3 AND revoked_at IS NULL").bind(Date.now(), userId, clientId),
  ]);
}

/** Revoke a desktop credential and disconnect it immediately. */
export async function revokeAgent(env: Env, userId: string, agentId: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE agents SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL").bind(Date.now(), agentId, userId).run();
  if (!res.meta.changes) return false;
  await hubOf(env, userId).revokeAgent(agentId);
  return true;
}
