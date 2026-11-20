import type { Env } from "./env";
import { authenticateAgent, authenticateMcp } from "./auth/tokens";
import { pairPoll, pairStart } from "./auth/pairing";
import { handleWeb, revokeAgent } from "./auth/web";
import { verifyToken } from "./lib/crypto";
import { bearer, errorJson, json } from "./lib/http";
import { pruneRateLimits, rateLimit } from "./lib/ratelimit";
import { handleMcp } from "./mcp/server";
import { MANIFEST_HELPER_PY } from "./tools/manifest-helper";

export { UserHub } from "./durable-objects/user-hub";
export { TransferRelay } from "./durable-objects/transfer-relay";

interface JobToken {
  t: "dl" | "ul";
  uid: string;
  jid: string;
  aid?: string;
  exp: number;
  files: { size: number; sha256: string }[];
}

const relayFor = (env: Env, t: JobToken) => env.TRANSFER_RELAY.get(env.TRANSFER_RELAY.idFromName(`${t.uid}:${t.jid}`));

async function jobToken(env: Env, request: Request, want: "dl" | "ul", jobId: string, idx: number): Promise<JobToken | Response> {
  const raw = bearer(request);
  if (!raw) return errorJson(401, "UNAUTHORIZED", "Missing job token.");
  const t = await verifyToken<JobToken>(env.JOB_SIGNING_KEY, raw);
  if (!t || t.t !== want || t.jid !== jobId) return errorJson(401, "UNAUTHORIZED", "Invalid, expired or mismatched job token.");
  if (!Number.isInteger(idx) || idx < 0 || idx >= t.files.length) return errorJson(404, "NO_SUCH_FILE", "Unknown file index.");
  return t;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/health") {
        return json({ ok: true, service: "mcu-bridge", configured: !!env.JOB_SIGNING_KEY && !!env.SIGNUP_CODE, time: new Date().toISOString() });
      }

      // ------------------------------------------------------------- pairing API
      if (path === "/api/pair/start" && request.method === "POST") return await pairStart(request, env);
      if (path === "/api/pair/poll" && request.method === "POST") return await pairPoll(request, env);

      // --------------------------------------------------------------- agent API
      if (path === "/api/agent/ws") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return errorJson(426, "UPGRADE_REQUIRED", "WebSocket upgrade required.");
        const auth = await authenticateAgent(env, bearer(request));
        if (!auth) return errorJson(401, "UNAUTHORIZED", "Invalid or revoked agent credential.");
        if (!(await rateLimit(env, `agent-ws:${auth.agent_id}`, 60, 60))) return errorJson(429, "RATE_LIMITED", "Reconnecting too fast.");
        const headers = new Headers(request.headers);
        headers.set("x-agent-id", auth.agent_id);
        headers.set("x-user-id", auth.user_id);
        headers.set("x-agent-name", auth.name);
        return env.USER_HUB.get(env.USER_HUB.idFromName(auth.user_id)).fetch(new Request("https://hub/ws", { headers }));
      }
      if (path === "/api/agent/me" && request.method === "GET") {
        const auth = await authenticateAgent(env, bearer(request));
        return auth ? json({ ok: true, agent_id: auth.agent_id, name: auth.name }) : errorJson(401, "UNAUTHORIZED", "Invalid or revoked agent credential.");
      }
      if (path === "/api/agent/revoke" && request.method === "POST") {
        const auth = await authenticateAgent(env, bearer(request));
        if (!auth) return errorJson(401, "UNAUTHORIZED", "Invalid or revoked agent credential.");
        await revokeAgent(env, auth.user_id, auth.agent_id);
        return json({ ok: true });
      }

      // ----------------------------------------------------- firmware transfer
      let m = /^\/api\/transfers\/([A-Za-z0-9_-]{8,64})\/(\d{1,2})(\/ack)?$/.exec(path);
      if (m) {
        const idx = Number(m[2]);
        const t = await jobToken(env, request, "dl", m[1], idx);
        if (t instanceof Response) return t;
        const headers = { "x-relay-spec": JSON.stringify({ files: t.files }) };
        const stub = relayFor(env, t);
        if (m[3] && request.method === "POST") {
          return stub.fetch(`https://relay/ack/${idx}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: await request.text() });
        }
        if (!m[3] && request.method === "GET") {
          return stub.fetch(`https://relay/download/${idx}?from=${encodeURIComponent(url.searchParams.get("from") ?? "0")}`, { headers });
        }
        return errorJson(405, "METHOD_NOT_ALLOWED", "Unsupported method.");
      }
      m = /^\/api\/uploads\/([A-Za-z0-9_-]{8,64})\/(\d{1,2})$/.exec(path);
      if (m && request.method === "PUT") {
        const idx = Number(m[2]);
        const t = await jobToken(env, request, "ul", m[1], idx);
        if (t instanceof Response) return t;
        if (!(await rateLimit(env, `upload:${t.uid}`, 120, 60))) return errorJson(429, "RATE_LIMITED", "Too many uploads.");
        const h: Record<string, string> = { "x-relay-spec": JSON.stringify({ files: t.files }) };
        const cl = request.headers.get("content-length");
        if (cl) h["x-declared-length"] = cl;
        return relayFor(env, t).fetch(`https://relay/upload/${idx}`, { method: "PUT", headers: h, body: request.body });
      }

      // --------------------------------------------------------------------- MCP
      if (path === "/mcp") {
        const auth = await authenticateMcp(env, bearer(request));
        if (!auth) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: provide 'Authorization: Bearer mcb_mcp_…' (create a token on the MCU Bridge dashboard)." }, id: null }), {
            status: 401,
            headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="mcu-bridge"' },
          });
        }
        return await handleMcp(request, { env, userId: auth.user_id, tokenId: auth.token_id, origin: url.origin });
      }

      if (path === "/tools/manifest.py" && request.method === "GET") {
        return new Response(MANIFEST_HELPER_PY, { headers: { "content-type": "text/x-python; charset=utf-8", "cache-control": "public, max-age=300" } });
      }

      // -------------------------------------------------------------- web pages
      const web = await handleWeb(request, env, url);
      if (web) return web;
      return errorJson(404, "NOT_FOUND", "Not found.");
    } catch (e) {
      console.error("unhandled", e instanceof Error ? e.stack : e);
      return errorJson(500, "INTERNAL", "Internal error.");
    } finally {
      if (Math.random() < 0.01) ctx.waitUntil(pruneRateLimits(env).catch(() => undefined));
    }
  },
} satisfies ExportedHandler<Env>;
