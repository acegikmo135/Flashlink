#!/usr/bin/env node
/**
 * Prepare the Windows installer for edge delivery by the Worker (no R2/KV): split it into parts that fit
 * Cloudflare's 25 MiB static-asset limit and write web/dist/dl/manifest.json. Run AFTER `npm run build` in web/
 * and BEFORE `wrangler deploy`.
 *
 *   node scripts/publish-installer.mjs desktop/dist/MCUBridge-Setup.exe
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PART = 10 * 1024 * 1024;

export function planParts(total, partSize = PART) {
  const sizes = [];
  for (let off = 0; off < total; off += partSize) sizes.push(Math.min(partSize, total - off));
  return sizes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = resolve(process.argv[2] ?? join(ROOT, "desktop", "dist", "MCUBridge-Setup.exe"));
  const out = join(ROOT, "web", "dist", "dl");
  const buf = readFileSync(src);
  if (buf.subarray(0, 2).toString() !== "MZ") throw new Error(`${src} does not look like a Windows executable`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const parts = [];
  let off = 0;
  planParts(buf.length).forEach((size, i) => {
    const path = `/dl/MCUBridge-Setup.exe.part${i + 1}`;
    writeFileSync(join(out, `MCUBridge-Setup.exe.part${i + 1}`), buf.subarray(off, off + size));
    parts.push({ path, size });
    off += size;
  });
  const sha256 = createHash("sha256").update(buf).digest("hex");
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ name: "MCUBridge-Setup.exe", total: buf.length, sha256, parts, built_at: new Date().toISOString() }, null, 2));
  console.log(`installer ${(buf.length / 1048576).toFixed(2)} MiB in ${parts.length} parts -> web/dist/dl  (sha256 ${sha256})`);
}
