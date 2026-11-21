#!/usr/bin/env node
/**
 * MCU Bridge — first-time setup / deploy (cross-platform core; Windows users run setup.ps1).
 *
 *   1. checks Node + npm            7. creates the D1 database (if needed)
 *   2. installs dependencies        8. applies D1 migrations (remote)
 *   3. uses the local Wrangler      9. generates secrets locally (never in source)
 *   4. `wrangler login` if needed  10. deploys the Worker
 *   5. opens the Cloudflare auth   11. reads back the Worker URL
 *      URL in your browser         12. writes .mcu-bridge/config.json
 *   6. verifies authentication     13. prints the desktop pairing + MCP instructions
 *
 * Flags: --deploy-only (skip login/db/secrets creation when already set up)
 *        --rotate-secrets   --dry-run   --status
 *        --domain <host>   serve the Worker on your own domain (zone must be on your Cloudflare account)
 * Your Cloudflare credentials are handled only by Wrangler's own OAuth flow.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUD = join(ROOT, "cloud");
const STATE_DIR = join(ROOT, ".mcu-bridge");
const CONFIG = join(STATE_DIR, "config.json");
const TOML = join(CLOUD, "wrangler.toml");
const DB_NAME = "mcu-bridge";
const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";
const argv = process.argv.slice(2);
const args = new Set(argv);
const domainArg = (() => {
  const i = argv.findIndex((a) => a === "--domain" || a.startsWith("--domain="));
  if (i < 0) return null;
  return argv[i].includes("=") ? argv[i].split("=")[1] : argv[i + 1] ?? null;
})();
const dry = args.has("--dry-run");
const isWin = process.platform === "win32";

const log = (m) => console.log(`\n\x1b[1m▸ ${m}\x1b[0m`);
const info = (m) => console.log(`  ${m}`);
const die = (m) => {
  console.error(`\n\x1b[31m✘ ${m}\x1b[0m`);
  process.exit(1);
};

/** Run a command with an argv array (no shell string interpolation). */
function run(cmd, argv, { capture = false, cwd = CLOUD, input, allowFail = false } = {}) {
  if (dry) {
    info(`[dry-run] ${cmd} ${argv.join(" ")}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  const r = spawnSync(isWin && !cmd.endsWith(".exe") ? `${cmd}` : cmd, argv, {
    cwd,
    input,
    encoding: "utf8",
    shell: isWin, // needed to resolve npm.cmd / npx.cmd; argv contains no user input
    stdio: capture ? ["pipe", "pipe", "pipe"] : input ? ["pipe", "inherit", "inherit"] : "inherit",
  });
  if (r.status !== 0 && !allowFail) die(`${cmd} ${argv.join(" ")} failed (exit ${r.status}).${capture ? "\n" + (r.stderr || r.stdout) : ""}`);
  return r;
}
const wrangler = (argv, opts) => run("npx", ["--no-install", "wrangler", ...argv], opts);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ---------------------------------------------------------------- pure helpers (unit-tested)
export function parseUuid(text) {
  const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
  return m ? m[0] : null;
}
export function parseWorkerUrl(text) {
  const m = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i.exec(text);
  return m ? m[0] : null;
}
export function setDatabaseId(toml, id) {
  return toml.replace(/(database_id\s*=\s*")[^"]*(")/, `$1${id}$2`);
}
/** Adds (or replaces) a Workers custom-domain route right after `workers_dev = true`. */
export function setCustomDomain(toml, host) {
  const line = `routes = [{ pattern = "${host}", custom_domain = true }]`;
  const without = toml.replace(/^routes\s*=.*\n/m, "");
  return without.replace(/^(workers_dev\s*=.*\n)/m, `$1${line}\n`);
}
export function getCustomDomain(toml) {
  const m = /^routes\s*=\s*\[\{\s*pattern\s*=\s*"([^"]+)"/m.exec(toml);
  return m ? m[1] : null;
}
export function getDatabaseId(toml) {
  const m = /database_id\s*=\s*"([^"]*)"/.exec(toml);
  return m ? m[1] : null;
}
const secret = (n) => randomBytes(n).toString("base64url");

// Run only when executed directly (importing the file for tests must have no side effects).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  // 1 ── prerequisites
  log("Checking Node.js and npm");
  const node = process.versions.node;
  if (Number(node.split(".")[0]) < 20) die(`Node.js ${node} is too old; install Node 20 or newer (https://nodejs.org).`);
  const npmv = run("npm", ["--version"], { capture: true, cwd: ROOT });
  info(`node ${node}, npm ${strip(npmv.stdout || "?").trim()}`);

  if (args.has("--status")) return status();

  // 2/3 ── dependencies incl. local Wrangler
  log("Installing dependencies (Wrangler is installed locally as a dev dependency)");
  run("npm", ["install", "--no-audit", "--no-fund"]);

  let cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
  if (!args.has("--deploy-only")) {
    // 4/5/6 ── authentication
    log("Checking Cloudflare authentication");
    let who = wrangler(["whoami"], { capture: true, allowFail: true });
    const loggedIn = (r) => r.status === 0 && /associated with the email|You are logged in/i.test(strip(r.stdout));
    if (!loggedIn(who) && !process.env.CLOUDFLARE_API_TOKEN) {
      info("Not logged in. Starting `wrangler login` — your browser will open the Cloudflare authorization page.");
      info("If it does not open, copy the URL Wrangler prints below into a browser.");
      wrangler(["login"], {});
      who = wrangler(["whoami"], { capture: true, allowFail: true });
      if (!loggedIn(who)) die("Still not authenticated. Run `npx wrangler login` in the cloud folder and retry.");
    }
    info(strip(who.stdout || "").split("\n").filter((l) => /email|Account Name|│/.test(l)).slice(0, 6).join("\n  ") || "authenticated");

    // 7 ── D1 database
    log("Preparing the D1 database");
    let toml = readFileSync(TOML, "utf8");
    let dbId = getDatabaseId(toml);
    const list = wrangler(["d1", "list", "--json"], { capture: true, allowFail: true });
    let known = [];
    try {
      known = JSON.parse(strip(list.stdout || "[]"));
    } catch {
      /* ignore */
    }
    const mine = known.find((d) => d.name === DB_NAME);
    // A database id that does not exist in THIS account (e.g. the one in a cloned repo) is treated as missing.
    if (dbId && dbId !== PLACEHOLDER_DB_ID && !known.some((d) => d.uuid === dbId) && !dry) dbId = null;
    if (!dbId || dbId === PLACEHOLDER_DB_ID) {
      dbId = mine?.uuid ?? null;
      if (!dbId) {
        const created = wrangler(["d1", "create", DB_NAME], { capture: true, allowFail: true });
        dbId = parseUuid(strip(created.stdout || ""));
      }
      if (!dbId && !dry) die("Could not create or find the D1 database. Create it with `npx wrangler d1 create mcu-bridge` and put the id in cloud/wrangler.toml.");
      if (dbId) {
        toml = readFileSync(TOML, "utf8");
        if (getDatabaseId(toml) !== dbId) writeFileSync(TOML, setDatabaseId(toml, dbId));
      }
    }
    info(`database ${DB_NAME} (${dbId ?? "dry-run"})`);

    // 8 ── migrations
    log("Applying database migrations");
    wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]);

    // 9 ── secrets are generated locally and uploaded through Wrangler only
    if (!cfg.signup_code || !cfg.job_signing_key || args.has("--rotate-secrets")) {
      cfg.signup_code = secret(18);
      cfg.job_signing_key = secret(48);
      cfg.secrets_pending_upload = true;
    }
    cfg.d1_database_id = dbId;
  }

  // 9b ── optional custom domain (kept in cloud/wrangler.toml so later deploys keep it)
  const wantDomain = domainArg || cfg.custom_domain || null;
  if (wantDomain && !dry) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(wantDomain)) die(`"${wantDomain}" is not a valid hostname.`);
    writeFileSync(TOML, setCustomDomain(readFileSync(TOML, "utf8"), wantDomain));
    cfg.custom_domain = wantDomain;
    info(`custom domain: ${wantDomain}`);
  }

  // 10 ── deploy
  log("Deploying the Worker");
  const dep = wrangler(["deploy"], { capture: true });
  console.log(strip(dep.stdout || ""));
  // 11 ── worker URL
  let url = parseWorkerUrl(strip(dep.stdout || "") + strip(dep.stderr || ""));
  if (!url && !dry) die("Deployment succeeded but the workers.dev URL could not be read. Check the Cloudflare dashboard (Workers → mcu-bridge).");
  cfg.worker_url = cfg.custom_domain ? `https://${cfg.custom_domain}` : url ?? cfg.worker_url;

  if (cfg.secrets_pending_upload || args.has("--rotate-secrets")) {
    log("Uploading secrets to the Worker (via Wrangler)");
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = join(STATE_DIR, "secrets.tmp.json");
    if (!dry) writeFileSync(tmp, JSON.stringify({ JOB_SIGNING_KEY: cfg.job_signing_key, SIGNUP_CODE: cfg.signup_code }), { mode: 0o600 });
    wrangler(["secret", "bulk", tmp]);
    if (!dry) rmSync(tmp, { force: true });
    delete cfg.secrets_pending_upload;
  }

  // 12 ── local config (git-ignored)
  if (!dry) {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    if (cfg.worker_url) writeFileSync(join(ROOT, "desktop", "server_url.txt"), cfg.worker_url + "\n");
  }

  // health check
  if (!dry && cfg.worker_url) {
    try {
      const h = await (await fetch(cfg.worker_url + "/health")).json();
      info(`health: ${JSON.stringify(h)}`);
    } catch (e) {
      info(`(health check failed: ${e.message}; the first request can take a few seconds)`);
    }
  }

  // 13 ── next steps
  log("Done");
  console.log(`
  Worker URL      ${cfg.worker_url}
  Invite code     ${cfg.signup_code}      (needed once, to create your account)

  1. Open ${cfg.worker_url}/signup  → create your account with the invite code.
  2. Dashboard → "Create token" → copy the MCP token (shown once).
  3. Claude Code:
       claude mcp add --transport http mcu-bridge ${cfg.worker_url}/mcp --header "Authorization: Bearer <token>"
     and allow the host ${new URL(cfg.worker_url).host} in the Claude Code Cloud environment's network settings.
  4. Windows PC: scripts\\build-desktop.ps1, run MCUBridge.exe, open the pairing link / scan the QR code.

  Secrets are stored in ${CONFIG} (git-ignored). Keep that file private.
`);
}

function status() {
  log("Status");
  const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : null;
  info(cfg ? `config: worker ${cfg.worker_url ?? "(not deployed)"}, d1 ${cfg.d1_database_id ?? "?"}` : "config: none yet (run setup)");
  info(`wrangler.toml database_id: ${getDatabaseId(readFileSync(TOML, "utf8"))}`);
}
