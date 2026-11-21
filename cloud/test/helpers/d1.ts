// @ts-nocheck — Node-only test helper (node:sqlite); the Worker tsconfig has no Node types.
/** A tiny D1 stand-in over node:sqlite so the real migrations and SQL run in unit tests. */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "../../migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql: string, vals: unknown[] = []) => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async () => (db.prepare(sql).get(...(vals as never[])) as unknown) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(vals as never[])) as unknown[], meta: {} }),
    run: async () => {
      const r = db.prepare(sql).run(...(vals as never[]));
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => Promise.all(list.map((s) => s.run())) } as unknown as D1Database;
}
