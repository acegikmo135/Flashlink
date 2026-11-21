// Captures the REAL dashboard (web/dist) in dark theme with placeholder data → public/media/product-*.webp
// usage: (cd web && npm run build) && NODE_PATH=$(npm root -g) node scripts/capture-product.cjs   (needs Playwright + PIL-free: uses sharp-less png→webp via playwright? no: writes png)
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const DIST = path.resolve(__dirname, "../dist"), OUT = path.resolve(__dirname, "../public/media");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => { let p = path.join(DIST, decodeURIComponent(req.url.split("?")[0])); if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, "index.html"); res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res); });
const now = Date.now();
const dev = (id, name, state, port, chip, family, board) => ({ device_id: id, name, state, port, family, chip, board, remote_flashing_allowed: true, flash_size: "4MB", active_job_id: null });
const overview = (st) => ({
  email: "you@example.com", stats: { agents_online: 1, devices_ready: 3, jobs_total: 48, jobs_ok: 46 },
  agents: [{ id: "a1", name: "Studio PC", platform: "windows", created_at: now - 9e8, last_seen_at: now, online: true, version: "0.9.0", os: "Windows 11", devices: 3, toolchains: { avrdude: { available: true, version: "8.0" }, esptool: { available: true, version: "5.0" } } }],
  devices: [dev("d1", "Desk ESP32", st, "COM7", "ESP32-D0WD-V3", "esp32", "esp32-wroom-32"), dev("d2", "Robot Uno", "idle", "COM5", "ATmega328P", "avr", "arduino-uno"), dev("d3", "Desk Nano", "idle", "COM9", "ATmega328P", "avr", "arduino-nano")],
  tokens: [{ id: "t1", name: "Claude Code", created_at: now - 4e8, last_used_at: now - 3e5 }, { id: "t2", name: "Laptop scripts", created_at: now - 9e8, last_used_at: null }],
  apps: [{ client_id: "c1", name: "claude.ai", since: now - 5e6 }, { client_id: "c2", name: "ChatGPT", since: now - 7e6 }, { client_id: "c3", name: "Gemini", since: now - 9e6 }],
  jobs: [["build_9f3ac21b_a1", "esp32-wroom-32", "esp32", 40e3], ["build_71be0aa4_a2", "arduino-uno", "avr", 3 * 60e3], ["build_c2d19e07_a3", "arduino-nano", "avr", 11 * 60e3], ["build_0a77f3d1_a4", "esp32-wroom-32", "esp32", 26 * 60e3], ["build_e45b8820_a5", "arduino-uno", "avr", 52 * 60e3], ["build_5d19c0aa_a6", "esp32-wroom-32", "esp32", 3 * 3600e3]].map(([id, board, family, ago]) => ({ id, device_id: null, kind: "flash", board, family, status: "completed", error_code: null, created_at: now - ago - 4000, finished_at: now - ago })),
});
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  for (const [name, route, st] of [["devices", "/dashboard/devices", "flashing"], ["activity", "/dashboard/activity", "idle"], ["overview", "/dashboard", "idle"], ["access", "/dashboard/access", "idle"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.route("**/api/web/session", (r) => r.fulfill({ json: { ok: true, user: { id: "u1", email: "you@example.com" }, config: { origin: "https://your-worker.workers.dev", installer_url: null } } }));
    await page.route("**/api/web/overview", (r) => r.fulfill({ json: { ok: true, ...overview(st) } }));
    await page.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
    await page.goto(base + route); await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, `product-${name}.png`) }); console.log("shot", name); await ctx.close();
  }
  await browser.close(); srv.close();
})();
