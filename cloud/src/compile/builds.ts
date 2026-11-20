import type { SourceFile } from "./backend";
import { sha256Hex } from "../lib/crypto";

/** How many builds per account are kept (oldest are pruned). */
export const MAX_BUILDS = 40;

export interface BuildInput {
  board: string;
  sketch: string;
  files: SourceFile[];
  libraries: string[];
}

/** Deterministic key for a set of build inputs (order of files/libraries does not matter). */
export async function cacheKey(i: BuildInput): Promise<string> {
  const files = [...i.files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, f.content]);
  const libs = [...i.libraries].sort();
  return sha256Hex(JSON.stringify([i.board, i.sketch, files, libs]));
}

export const buildIdFor = (key: string) => `bld_${key.slice(0, 12)}`;

export interface BuildRow {
  id: string;
  cache_key: string;
  board: string;
  sha256: string;
  size_bytes: number;
  stats: string | null;
  libraries: string | null;
  sketch: string;
  files: string | null;
  title: string | null;
  created_at: number;
  last_built_at: number;
  build_count: number;
  flash_count: number;
  last_job_id: string | null;
  last_flashed_at: number | null;
}

/** The previous record for identical inputs, if any (a "cache hit": same inputs were built before). */
export async function findBuild(db: D1Database, userId: string, id: string): Promise<BuildRow | null> {
  return db.prepare("SELECT * FROM builds WHERE user_id = ?1 AND id = ?2").bind(userId, id).first<BuildRow>();
}

/** Insert or refresh a build record; prunes the account's oldest builds. Returns whether identical inputs were built before and whether the output changed. */
export async function recordBuild(
  db: D1Database,
  userId: string,
  input: BuildInput,
  out: { sha256: string; size_bytes: number; stats: unknown },
  title?: string,
): Promise<{ id: string; previous: BuildRow | null; output_changed: boolean }> {
  const key = await cacheKey(input);
  const id = buildIdFor(key);
  const now = Date.now();
  const previous = await findBuild(db, userId, id);
  const stats = JSON.stringify(out.stats ?? {});
  if (previous) {
    await db
      .prepare("UPDATE builds SET sha256 = ?3, size_bytes = ?4, stats = ?5, last_built_at = ?6, build_count = build_count + 1, title = COALESCE(?7, title) WHERE user_id = ?1 AND id = ?2")
      .bind(userId, id, out.sha256, out.size_bytes, stats, now, title ?? null)
      .run();
  } else {
    await db
      .prepare("INSERT INTO builds (user_id, id, cache_key, board, sha256, size_bytes, stats, libraries, sketch, files, title, created_at, last_built_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)")
      .bind(userId, id, key, input.board, out.sha256, out.size_bytes, stats, JSON.stringify(input.libraries), input.sketch, JSON.stringify(input.files), title ?? null, now)
      .run();
    await db
      .prepare("DELETE FROM builds WHERE user_id = ?1 AND id NOT IN (SELECT id FROM builds WHERE user_id = ?1 ORDER BY last_built_at DESC LIMIT ?2)")
      .bind(userId, MAX_BUILDS)
      .run();
  }
  return { id, previous, output_changed: !!previous && previous.sha256 !== out.sha256 };
}

export async function markFlashed(db: D1Database, userId: string, id: string, jobId: string): Promise<void> {
  await db.prepare("UPDATE builds SET flash_count = flash_count + 1, last_job_id = ?3, last_flashed_at = ?4 WHERE user_id = ?1 AND id = ?2").bind(userId, id, jobId, Date.now()).run();
}

export const parseJson = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
