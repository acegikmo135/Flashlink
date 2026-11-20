// Capture the REAL MCU Bridge web app (web/dist) with fictional placeholder data → assets/ui-*.png
// usage: NODE_PATH=$(npm root -g) node tools/capture_ui.cjs
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const DIST = path.resolve(__dirname, "../../web/dist");
const OUT = path.resolve(__dirname, "../assets");
fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
const now = Date.now();
const dev = (id, name, state, port, chip, family, board) => ({ device_id: id, name, state, port, family, chip, board, remote_flashing_allowed: true, flash_size: "4MB", active_job_id: null });
const overview = (state1) => ({
  email: "you@example.com",
  stats: { agents_online: 1, devices_ready: 3, jobs_total: 48, jobs_ok: 46 },
  agents: [{ id: "a1", name: "Studio PC", platform: "windows", created_at: now - 9e8, last_seen_at: now, online: true, version: "0.9.0", os: "Windows 11", devices: 3, toolchains: { avrdude: { available: true, version: "8.0" }, esptool: { available: true, version: "5.0" } } }],
  devices: [dev("dev_a1b2c3", "Kitchen ESP32", state1, "COM7", "ESP32-D0WD-V3", "esp32", "esp32-wroom-32"), dev("dev_d4e5f6", "Robot Uno", "idle", "COM5", "ATmega328P", "avr", "arduino-uno"), dev("dev_g7h8i9", "Desk Nano", "idle", "COM9", "ATmega328P", "avr", "arduino-nano")],
  tokens: [], apps: [{ client_id: "c1", name: "Your AI assistant", since: now - 5e6 }],
  jobs: [
    ["build_9f3ac21b_x1", "esp32-wroom-32", "esp32", "completed", null, 40e3],
    ["build_71be0aa4_x2", "arduino-uno", "avr", "completed", null, 3 * 60e3],
    ["build_c2d19e07_x3", "arduino-nano", "avr", "completed", null, 11 * 60e3],
    ["build_0a77f3d1_x4", "esp32-wroom-32", "esp32", "completed", null, 26 * 60e3],
    ["build_e45b8820_x5", "arduino-uno", "avr", "completed", null, 52 * 60e3],
  ].map(([id, board, family, status, error_code, ago]) => ({ id, device_id: null, kind: "flash", board, family, status, error_code, created_at: now - ago - 4000, finished_at: now - ago })),
});
(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const shots = [
    ["devices-idle", "/dashboard/devices", "idle", "light"],
    ["devices-flashing", "/dashboard/devices", "flashing", "light"],
    ["activity", "/dashboard/activity", "idle", "light"],
    ["devices-dark", "/dashboard/devices", "idle", "dark"],
  ];
  for (const [name, route, st, theme] of shots) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
    const page = await ctx.newPage();
    await page.route("**/api/web/session", (r) => r.fulfill({ json: { ok: true, user: { id: "u1", email: "you@example.com" }, config: { origin: base, installer_url: null } } }));
    await page.route("**/api/web/overview", (r) => r.fulfill({ json: { ok: true, ...overview(st) } }));
    await page.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    await page.goto(base + route);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT, `ui-${name}.png`) });
    console.log("shot", name);
    await ctx.close();
  }
  await browser.close();
  srv.close();
})();
