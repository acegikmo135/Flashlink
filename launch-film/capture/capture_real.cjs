// REAL screen capture of the actual MCU Bridge web app (web/dist) driven through real UI interactions.
// Backend responses are mocked with fictional placeholder data (no personal data). Output: frames/*.jpg  (15 fps timeline)
// usage: NODE_PATH=$(npm root -g) node capture/capture_real.cjs
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const DIST = path.resolve(__dirname, "../../web/dist");
const OUT = path.resolve(__dirname, "frames");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

const now = Date.now();
const S = { name1: null, state1: "idle", extraJob: false };
const dev = (id, name, state, port, chip, family, board) => ({ device_id: id, name, state, port, family, chip, board, remote_flashing_allowed: true, flash_size: "4MB", active_job_id: null });
const overview = () => ({
  email: "you@example.com",
  stats: { agents_online: 1, devices_ready: 3, jobs_total: S.extraJob ? 49 : 48, jobs_ok: S.extraJob ? 47 : 46 },
  agents: [{ id: "a1", name: "Studio PC", platform: "windows", created_at: now - 9e8, last_seen_at: now, online: true, version: "0.9.0", os: "Windows 11", devices: 3, toolchains: { avrdude: { available: true, version: "8.0" }, esptool: { available: true, version: "5.0" } } }],
  devices: [dev("dev_a1b2c3", S.name1, S.state1, "COM7", "ESP32-D0WD-V3", "esp32", "esp32-wroom-32"), dev("dev_d4e5f6", "Robot Uno", "idle", "COM5", "ATmega328P", "avr", "arduino-uno"), dev("dev_g7h8i9", "Desk Nano", "idle", "COM9", "ATmega328P", "avr", "arduino-nano")],
  tokens: [], apps: [{ client_id: "c1", name: "Your AI assistant", since: now - 5e6 }],
  jobs: [
    ...(S.extraJob ? [["build_9f3ac21b_new", "esp32-wroom-32", "esp32", "completed", 2e3]] : []),
    ["build_71be0aa4_x2", "arduino-uno", "avr", "completed", 3 * 60e3],
    ["build_c2d19e07_x3", "arduino-nano", "avr", "completed", 11 * 60e3],
    ["build_0a77f3d1_x4", "esp32-wroom-32", "esp32", "completed", 26 * 60e3],
    ["build_e45b8820_x5", "arduino-uno", "avr", "completed", 52 * 60e3],
  ].map(([id, board, family, status, ago]) => ({ id, device_id: null, kind: "flash", board, family, status, error_code: null, created_at: now - ago - 4000, finished_at: now - ago })),
});

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.route("**/api/web/session", (r) => r.fulfill({ json: { ok: true, user: { id: "u1", email: "you@example.com" }, config: { origin: base, installer_url: null } } }));
  await page.route("**/api/web/overview", (r) => r.fulfill({ json: { ok: true, ...overview() } }));
  await page.route("**/api/web/devices/*/name", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    S.name1 = body.name ?? null;
    await r.fulfill({ json: { ok: true, name: S.name1 } });
  });
  await page.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch {} });
  await page.goto(base + "/dashboard/devices");
  await page.waitForSelector("text=Connected boards");
  await page.waitForTimeout(1500);

  let n = 0;
  const shot = async (count = 1) => {
    const f = path.join(OUT, `f_${String(n).padStart(4, "0")}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 92 });
    for (let i = 1; i < count; i++) { fs.copyFileSync(f, path.join(OUT, `f_${String(n + i).padStart(4, "0")}.jpg`)); }
    n += count;
  };
  const nameCell = page.locator("button[title^='Rename']").first();

  await shot(15);                       // 1.0 s: the Devices page as it is
  await nameCell.click();               // real UI: click the board name to rename
  await page.waitForSelector("input[placeholder^='e.g.']");
  await shot(8);
  const input = page.locator("input[placeholder^='e.g.']");
  for (const ch of "Kitchen ESP32") {   // real typing into the real input, one char per frame
    await input.pressSequentially(ch);
    await shot(1);
  }
  await shot(6);
  await input.press("Enter");           // saves through the real handler (mocked API)
  await page.waitForTimeout(500);
  await shot(15);                       // named + toast
  // a flash job starts on that board: state flips to "flashing"
  S.state1 = "flashing";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock?.runFor?.(0).catch?.(() => {});
  await page.waitForTimeout(4300);      // the app polls every 4 s
  await shot(24);                       // 1.6 s of "flashing"
  S.state1 = "idle"; S.extraJob = true;
  await page.waitForTimeout(4300);
  await shot(18);                       // back to "ready"
  await page.getByRole("link", { name: "Activity" }).click();   // real navigation
  await page.waitForSelector("text=Every flash and verification");
  await page.waitForTimeout(900);
  await shot(30);                       // the newest row: Completed
  console.log("frames", n);
  await browser.close();
  srv.close();
})();
