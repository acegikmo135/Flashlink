/**
 * Optional firmware cache (Cloudflare KV): a successful build is kept for a few days, per account, under a hash of its
 * inputs (board + sketch + files + libraries). Asking for the same build again — a retry, a re-flash, flash_build —
 * then skips the (slow, flaky) cloud compile. Off when the FIRMWARE_CACHE binding is missing or FIRMWARE_CACHE_DAYS=0.
 */
import type { Env } from "../env";
import type { BuildStats, CompileResult } from "./backend";
import { cacheKey, type BuildInput } from "./builds";

type Ok = Extract<CompileResult, { ok: true }>;
export const DEFAULT_CACHE_DAYS = 7;

export const cacheDays = (env: Env): number => {
  const n = env.FIRMWARE_CACHE_DAYS === undefined || env.FIRMWARE_CACHE_DAYS === "" ? DEFAULT_CACHE_DAYS : Number(env.FIRMWARE_CACHE_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 0;
};
export const cacheEnabled = (env: Env): boolean => !!env.FIRMWARE_CACHE && cacheDays(env) > 0;

const kvKey = (userId: string, key: string) => `fw:${userId}:${key}`;

interface Meta {
  kind: "ihex" | "bin";
  stats: BuildStats;
  esp?: Ok["esp"];
  saved_at: number;
  estimated_seconds: number;
  basis: string;
  timeout_seconds: number;
}

export async function cacheKeyFor(i: BuildInput): Promise<string> {
  return cacheKey(i);
}

export async function cacheGet(env: Env, userId: string, key: string): Promise<Ok | null> {
  if (!cacheEnabled(env)) return null;
  try {
    const { value, metadata } = await env.FIRMWARE_CACHE!.getWithMetadata<Meta>(kvKey(userId, key), "arrayBuffer");
    if (!value || !metadata) return null;
    const bytes = new Uint8Array(value);
    return {
      ok: true,
      time: { estimated_seconds: metadata.estimated_seconds, took_seconds: 0, timeout_seconds: metadata.timeout_seconds, basis: metadata.basis, cached: true, cached_at: new Date(metadata.saved_at).toISOString() },
      kind: metadata.kind,
      bytes,
      text: metadata.kind === "ihex" ? new TextDecoder().decode(bytes) : null,
      stats: metadata.stats,
      stdout: "",
      ...(metadata.esp ? { esp: metadata.esp } : {}),
    };
  } catch (e) {
    console.error("firmware cache read failed", e instanceof Error ? e.message : e);
    return null; // a cache problem must never fail a build
  }
}

export async function cachePut(env: Env, userId: string, key: string, r: Ok): Promise<void> {
  if (!cacheEnabled(env)) return;
  try {
    const meta: Meta = { kind: r.kind, stats: r.stats, esp: r.esp, saved_at: Date.now(), estimated_seconds: r.time.estimated_seconds, basis: r.time.basis.slice(0, 300), timeout_seconds: r.time.timeout_seconds };
    await env.FIRMWARE_CACHE!.put(kvKey(userId, key), r.bytes, { expirationTtl: Math.max(60, Math.round(cacheDays(env) * 86400)), metadata: meta });
  } catch (e) {
    console.error("firmware cache write failed", e instanceof Error ? e.message : e);
  }
}

export async function cacheDelete(env: Env, userId: string, key: string): Promise<void> {
  if (!env.FIRMWARE_CACHE) return;
  try {
    await env.FIRMWARE_CACHE.delete(kvKey(userId, key));
  } catch {
    /* nothing cached */
  }
}
