import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { LIMITS } from "../boards";
import { encodeFrame } from "../transfers/framing";
import { toHex } from "../lib/crypto";
import { errorJson, json } from "../lib/http";

/**
 * TransferRelay — one instance per flashing job.
 *
 * It is a bounded, in-memory rendezvous between the uploader (Claude's cloud
 * environment) and the downloader (the desktop agent). Firmware bytes are NEVER
 * written to Durable Object storage, D1, KV or R2: they live only in a sliding
 * window of at most WINDOW_CHUNKS * CHUNK_BYTES per file, and chunks are freed as
 * soon as the desktop agent acknowledges them.
 */

const CHUNK = LIMITS.chunk_bytes;
const WINDOW_CHUNKS = 16;
const FIRST_CHUNK_WAIT_MS = 25_000; // long-poll: agent retries on 204
const STALL_MS = 90_000; // no ack / no data progress for this long => fail

interface FileSpec {
  size: number;
  sha256: string;
}
export interface RelaySpec {
  files: FileSpec[];
}

class Signal {
  private waiters = new Set<() => void>();
  notify() {
    const w = [...this.waiters];
    this.waiters.clear();
    for (const fn of w) fn();
  }
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }
}

class RelayError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface FileSession {
  spec: FileSpec;
  total: number;
  chunks: Map<number, Uint8Array>;
  produced: number;
  acked: number;
  upload: "idle" | "uploading" | "complete" | "failed";
  error: string | null;
  downloadGen: number;
  lastProgress: number;
  signal: Signal;
  everServed: boolean;
}

export class TransferRelay extends DurableObject<Env> {
  private files: FileSession[] | null = null;
  private aborted = false;

  private ensure(request: Request): FileSession[] {
    if (!this.files) {
      const raw = request.headers.get("x-relay-spec");
      if (!raw) throw new RelayError("NO_SPEC", "relay spec missing", 500);
      const spec = JSON.parse(raw) as RelaySpec;
      this.files = spec.files.map((spec) => ({
        spec,
        total: Math.ceil(spec.size / CHUNK),
        chunks: new Map(),
        produced: 0,
        acked: -1,
        upload: "idle" as const,
        error: null,
        downloadGen: 0,
        lastProgress: Date.now(),
        signal: new Signal(),
        everServed: false,
      }));
    }
    return this.files;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const action = parts[0];
    try {
      const files = this.ensure(request);
      if (action === "abort" && request.method === "POST") {
        this.abort("aborted by control plane");
        return json({ ok: true });
      }
      if (this.aborted) return errorJson(410, "TRANSFER_ABORTED", "This transfer was aborted.");
      const idx = Number(parts[1]);
      const fs = files[idx];
      if (!Number.isInteger(idx) || !fs) return errorJson(404, "NO_SUCH_FILE", "Unknown file index.");

      if (action === "upload" && request.method === "PUT") return await this.handleUpload(fs, idx, request);
      if (action === "download" && request.method === "GET") return await this.handleDownload(fs, Number(url.searchParams.get("from") ?? "0"));
      if (action === "ack" && request.method === "POST") return await this.handleAck(fs, request);
      return errorJson(404, "NOT_FOUND", "Unknown relay route.");
    } catch (e) {
      if (e instanceof RelayError) return errorJson(e.status, e.code, e.message);
      return errorJson(500, "INTERNAL", e instanceof Error ? e.message : String(e));
    }
  }

  private abort(reason: string) {
    this.aborted = true;
    for (const f of this.files ?? []) {
      f.error = reason;
      f.chunks.clear();
      f.signal.notify();
    }
  }

  // ---------------------------------------------------------------- upload

  private async push(fs: FileSession, data: Uint8Array): Promise<void> {
    while (fs.chunks.size >= WINDOW_CHUNKS) {
      if (this.aborted || fs.error) throw new RelayError("TRANSFER_ABORTED", fs.error ?? "aborted", 410);
      if (Date.now() - fs.lastProgress > STALL_MS) throw new RelayError("DOWNLOADER_STALLED", "The desktop agent is not downloading (no acknowledgements). Is it online and did it accept the job?", 504);
      await fs.signal.wait(1000);
    }
    fs.chunks.set(fs.produced++, data);
    fs.signal.notify();
  }

  private async handleUpload(fs: FileSession, idx: number, request: Request): Promise<Response> {
    if (fs.upload === "uploading") throw new RelayError("UPLOAD_IN_PROGRESS", "An upload for this file is already in progress.", 409);
    if (fs.upload === "complete") throw new RelayError("ALREADY_UPLOADED", "This file was already uploaded for this job.", 409);
    if (fs.upload === "failed" && fs.everServed) throw new RelayError("UPLOAD_BROKEN", "The previous upload failed after data reached the agent; create a new job.", 409);
    const declared = request.headers.get("x-declared-length") ?? request.headers.get("content-length");
    if (declared !== null && Number(declared) !== fs.spec.size) {
      throw new RelayError("SIZE_MISMATCH", `Content-Length ${declared} != manifest size ${fs.spec.size}.`, 400);
    }
    if (!request.body) throw new RelayError("EMPTY_BODY", "Request body required.", 400);

    // reset any partial state from a failed attempt that never reached the agent
    fs.chunks.clear();
    fs.produced = 0;
    fs.acked = -1;
    fs.error = null;
    fs.upload = "uploading";
    fs.lastProgress = Date.now();

    const digest = new crypto.DigestStream("SHA-256");
    const dw = digest.getWriter();
    const reader = request.body.getReader();
    let buf = new Uint8Array(CHUNK);
    let fill = 0;
    let total = 0;
    let finalized = false;

    const fail = (code: string, message: string, status: number) => {
      fs.upload = "failed";
      fs.error = message;
      fs.chunks.clear();
      fs.signal.notify();
      return new RelayError(code, message, status);
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        total += value.length;
        if (total > fs.spec.size) throw fail("SIZE_MISMATCH", `Body larger than declared size ${fs.spec.size}.`, 400);
        await dw.write(value.slice());
        let off = 0;
        while (off < value.length) {
          const n = Math.min(CHUNK - fill, value.length - off);
          buf.set(value.subarray(off, off + n), fill);
          fill += n;
          off += n;
          const bytesBefore = total - (value.length - off);
          const isLast = bytesBefore === fs.spec.size;
          if (fill === CHUNK || isLast) {
            if (isLast) {
              await dw.close();
              finalized = true;
              const actual = toHex(await digest.digest);
              if (actual !== fs.spec.sha256) throw fail("HASH_MISMATCH", `Uploaded data hashes to ${actual}, manifest says ${fs.spec.sha256}. Nothing was delivered for the final chunk.`, 422);
            }
            await this.push(fs, buf.slice(0, fill));
            buf = new Uint8Array(CHUNK);
            fill = 0;
          }
        }
      }
      if (total !== fs.spec.size) throw fail("SIZE_MISMATCH", `Body ended at ${total} bytes; manifest declares ${fs.spec.size}.`, 400);
    } catch (e) {
      if (!(e instanceof RelayError)) {
        throw fail("UPLOAD_FAILED", e instanceof Error ? e.message : String(e), 500);
      }
      if (fs.upload === "uploading") fs.upload = "failed";
      throw e;
    } finally {
      if (!finalized) {
        try {
          await dw.abort();
        } catch {
          /* ignore */
        }
      }
    }

    fs.upload = "complete";
    fs.signal.notify();

    // Keep the request open until the agent acknowledged every chunk, so that
    // "upload finished" really means "delivered to the desktop agent".
    while (fs.acked < fs.total - 1) {
      if (this.aborted || fs.error) throw new RelayError("TRANSFER_ABORTED", fs.error ?? "aborted", 410);
      if (Date.now() - fs.lastProgress > STALL_MS) throw new RelayError("DOWNLOADER_STALLED", "Upload accepted but the desktop agent stopped acknowledging chunks.", 504);
      await fs.signal.wait(1000);
    }
    return json({ ok: true, file_index: idx, bytes: total, sha256: fs.spec.sha256, delivered: true });
  }

  // -------------------------------------------------------------- download

  private async handleDownload(fs: FileSession, from: number): Promise<Response> {
    if (!Number.isInteger(from) || from < 0 || from > fs.total) throw new RelayError("BAD_RANGE", "Invalid 'from' chunk.", 416);
    if (from < fs.acked + 1) throw new RelayError("BAD_RANGE", `Chunks up to ${fs.acked} were acknowledged and freed; resume from ${fs.acked + 1}.`, 416);
    const gen = ++fs.downloadGen;
    fs.signal.notify();
    fs.lastProgress = Date.now();

    // Long-poll until the first requested chunk exists (uploader may not have started yet).
    const waitUntil = Date.now() + FIRST_CHUNK_WAIT_MS;
    while (from < fs.total && !fs.chunks.has(from)) {
      if (this.aborted) throw new RelayError("TRANSFER_ABORTED", "aborted", 410);
      if (fs.error) throw new RelayError("UPLOAD_FAILED", fs.error, 409);
      if (fs.downloadGen !== gen) return new Response(null, { status: 409, headers: { "x-relay-state": "superseded" } });
      if (Date.now() >= waitUntil) {
        return new Response(null, { status: 204, headers: { "x-relay-state": "waiting-for-upload", "retry-after": "1" } });
      }
      await fs.signal.wait(1000);
    }

    fs.everServed = true;
    let seq = from;
    const self = this;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (seq >= fs.total) {
            controller.close();
            return;
          }
          for (;;) {
            if (self.aborted || fs.error) {
              controller.error(new Error(fs.error ?? "aborted"));
              return;
            }
            if (fs.downloadGen !== gen) {
              controller.close();
              return;
            }
            const c = fs.chunks.get(seq);
            if (c) {
              controller.enqueue(encodeFrame(seq, c, seq === fs.total - 1));
              fs.lastProgress = Date.now();
              seq++;
              if (seq >= fs.total) controller.close();
              return;
            }
            if (Date.now() - fs.lastProgress > STALL_MS) {
              controller.error(new Error("upload stalled"));
              return;
            }
            await fs.signal.wait(1000);
          }
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "x-file-size": String(fs.spec.size),
        "x-file-sha256": fs.spec.sha256,
        "x-chunk-bytes": String(CHUNK),
        "x-total-chunks": String(fs.total),
        "x-start-seq": String(from),
      },
    });
  }

  // ------------------------------------------------------------------- ack

  private async handleAck(fs: FileSession, request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { seq?: number } | null;
    const seq = body?.seq;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) throw new RelayError("BAD_ACK", "ack requires integer 'seq'.", 400);
    if (seq >= fs.produced) throw new RelayError("BAD_ACK", `Cannot ack chunk ${seq}: only ${fs.produced} produced.`, 400);
    if (seq > fs.acked) {
      for (let s = fs.acked + 1; s <= seq; s++) fs.chunks.delete(s);
      fs.acked = seq;
      fs.lastProgress = Date.now();
      fs.signal.notify();
    }
    return json({ ok: true, acked: fs.acked, total: fs.total });
  }
}
