import type { Env } from "../env";
import { sha256Hex } from "../lib/crypto";

export interface AgentAuth {
  agent_id: string;
  user_id: string;
  name: string;
}

/** Resolve a desktop-agent bearer token (`mcb_agent_…`). Revoked tokens never match. */
export async function authenticateAgent(env: Env, token: string | null): Promise<AgentAuth | null> {
  if (!token || !token.startsWith("mcb_agent_") || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT id, user_id, name, last_seen_at FROM agents WHERE token_hash = ?1 AND revoked_at IS NULL")
    .bind(hash)
    .first<{ id: string; user_id: string; name: string; last_seen_at: number | null }>();
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - row.last_seen_at > 60_000) {
    await env.DB.prepare("UPDATE agents SET last_seen_at = ?1 WHERE id = ?2").bind(Date.now(), row.id).run();
  }
  return { agent_id: row.id, user_id: row.user_id, name: row.name };
}

export interface McpAuth {
  user_id: string;
  token_id: string;
}

/** Resolve an MCP bearer token (`mcb_mcp_…`). */
export async function authenticateMcp(env: Env, token: string | null): Promise<McpAuth | null> {
  if (!token || !token.startsWith("mcb_mcp_") || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT id, user_id, last_used_at FROM mcp_tokens WHERE token_hash = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)")
    .bind(hash, Date.now())
    .first<{ id: string; user_id: string; last_used_at: number | null }>();
  if (!row) return null;
  if (!row.last_used_at || Date.now() - row.last_used_at > 60_000) {
    await env.DB.prepare("UPDATE mcp_tokens SET last_used_at = ?1 WHERE id = ?2").bind(Date.now(), row.id).run();
  }
  return { user_id: row.user_id, token_id: row.id };
}
