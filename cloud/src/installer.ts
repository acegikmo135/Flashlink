/**
 * Serves the Windows installer from the Worker's static assets (Cloudflare's edge), without R2/KV.
 *
 * Static assets are limited to 25 MiB per file, so the installer is stored as several parts
 * (`/dl/MCUBridge-Setup.exe.partN` + `/dl/manifest.json`, produced by scripts/publish-installer.mjs) and streamed
 * back to the client as ONE file, with HTTP Range support so browsers can resume interrupted downloads.
 * If no installer has been published, the request falls back to the configured external URL.
 */
import type { Env } from "./env";

interface Manifest {
  name: string;
  total: number;
  sha256: string;
  parts: { path: string; size: number }[];
}

export async function loadManifest(env: Env, origin: string): Promise<Manifest | null> {
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/dl/manifest.json`));
    // with SPA fallback enabled a missing file comes back as index.html (200), so insist on JSON
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const m = (await res.json()) as Manifest;
    if (!Array.isArray(m.parts) || !m.parts.length || m.parts.reduce((a, p) => a + p.size, 0) !== m.total) return null;
    return m;
  } catch {
    return null;
  }
}

/** Parse a single `Range: bytes=…` header. Returns null for "no range", "invalid" when unsatisfiable. */
export function parseRange(header: string | null, total: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = parseInt(m[2], 10);
    if (n === 0) return "invalid";
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === "" ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  }
  if (start > end || start >= total) return "invalid";
  return { start, end };
}

/** Drop the first `skip` bytes and pass at most `take` bytes. */
function slicer(skip: number, take: number): TransformStream<Uint8Array, Uint8Array> {
  let skipLeft = skip;
  let left = take;
  return new TransformStream({
    transform(chunk, ctrl) {
      if (left <= 0) return;
      let c = chunk;
      if (skipLeft > 0) {
        if (c.length <= skipLeft) {
          skipLeft -= c.length;
          return;
        }
        c = c.subarray(skipLeft);
        skipLeft = 0;
      }
      if (c.length > left) c = c.subarray(0, left);
      left -= c.length;
      ctrl.enqueue(c);
    },
  });
}

export async function serveInstaller(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const m = await loadManifest(env, url.origin);
  if (!m) {
    return env.INSTALLER_URL && env.INSTALLER_URL.startsWith("https://")
      ? new Response(null, { status: 302, headers: { location: env.INSTALLER_URL, "cache-control": "no-store" } })
      : new Response(JSON.stringify({ ok: false, error: { code: "NOT_PUBLISHED", message: "No installer has been published yet." } }), { status: 404, headers: { "content-type": "application/json" } });
  }
  const etag = `"${m.sha256.slice(0, 32)}"`;
  const base: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${m.name}"`,
    "accept-ranges": "bytes",
    etag,
    "x-sha256": m.sha256,
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const range = parseRange(request.headers.get("range"), m.total);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${m.total}` } });
  const start = range ? range.start : 0;
  const end = range ? range.end : m.total - 1;
  const length = end - start + 1;
  const headers = { ...base, "content-length": String(length), ...(range ? { "content-range": `bytes ${start}-${end}/${m.total}` } : {}) };
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const pump = (async () => {
    let offset = 0;
    try {
      for (const part of m.parts) {
        const pStart = offset;
        const pEnd = offset + part.size - 1;
        offset += part.size;
        if (pEnd < start || pStart > end) continue;
        const res = await env.ASSETS.fetch(new Request(`${url.origin}${part.path}`));
        if (!res.ok || !res.body) throw new Error(`part ${part.path} unavailable`);
        const skip = Math.max(0, start - pStart);
        const take = Math.min(pEnd, end) - Math.max(pStart, start) + 1;
        await res.body.pipeThrough(slicer(skip, take)).pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (e) {
      await writable.abort(e);
    }
  })();
  ctx.waitUntil(pump);
  return new Response(readable, { status, headers });
}
