/** Invite codes: multiple, optionally multi-use and expiring, revocable. Only the SHA-256 of a code is stored. */
import type { Env } from "../env";
import { randomId, sha256Hex } from "../lib/crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** FLASH-XXXX-XXXX-XXXX (60 random bits). */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `FLASH-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Case, dashes and spaces don't matter when typing a code. */
export function canonicalCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createInvite(env: Env, o: { label?: string; email?: string; maxUses: number; expiresDays?: number; requestId?: string }): Promise<{ id: string; code: string; expires_at: number | null }> {
  const code = generateInviteCode();
  const id = randomId("inv", 9);
  const now = Date.now();
  const expires = o.expiresDays && o.expiresDays > 0 ? now + o.expiresDays * 86_400_000 : null;
  await env.DB.prepare("INSERT INTO invite_codes (id, code_hash, code_hint, label, email, max_uses, expires_at, created_at, request_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
    .bind(id, await sha256Hex(canonicalCode(code)), code.slice(-4), o.label?.slice(0, 80) ?? null, o.email ?? null, Math.min(100, Math.max(1, Math.floor(o.maxUses))), expires, now, o.requestId ?? null)
    .run();
  return { id, code, expires_at: expires };
}

/** Atomically use up one seat of a valid code. Returns the invite id, or null if the code is unknown/revoked/expired/used up. */
export async function claimInvite(env: Env, input: string): Promise<string | null> {
  const canon = canonicalCode(input);
  if (canon.length < 8 || canon.length > 40) return null;
  const row = await env.DB.prepare(
    "UPDATE invite_codes SET uses = uses + 1 WHERE code_hash = ?1 AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?2) RETURNING id",
  )
    .bind(await sha256Hex(canon), Date.now())
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Give the seat back (e.g. the signup failed after the code was claimed). */
export async function releaseInvite(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE invite_codes SET uses = MAX(0, uses - 1) WHERE id = ?1").bind(id).run();
}
