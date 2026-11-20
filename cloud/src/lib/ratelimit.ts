import type { Env } from "../env";

/**
 * Fixed-window rate limiter backed by D1.
 * Returns true when the request is allowed.
 */
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, windowSec)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** Opportunistic cleanup of stale limiter rows. */
export async function pruneRateLimits(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(cutoff).run();
}
