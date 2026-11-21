// Dev helper: serves web/dist (SPA) with a signed-out session and screenshots the landing page.
const http = require("http"), fs = require("fs"), path = require("path")
const { chromium } = require("playwright")
const dist = path.join(__dirname, "..", "dist")
const out = process.argv[2] || "/tmp/shots"
fs.mkdirSync(out, { recursive: true })
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg" }
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0]
  if (u === "/api/web/session") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ user: null, config: { origin: "https://your-worker.workers.dev", installer_url: null } })) }
  let f = path.join(dist, u)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html")
  res.setHeader("content-type", mime[path.extname(f)] || "application/octet-stream")
  fs.createReadStream(f).pipe(res)
})
;(async () => {
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch()
  const errors = []
  const sizes = [["desktop", 1440, 900], ["tablet", 820, 1100], ["mobile", 390, 844]]
  for (const [name, w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: process.env.RM ? "reduce" : "no-preference" })
    const page = await ctx.newPage()
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`))
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`))
    page.on("requestfailed", (r) => errors.push(`${name}: failed ${r.url()}`))
    await page.goto(base + "/", { waitUntil: "networkidle" })
    // hero at three moments
    await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/${name}-hero-1.png` })
    await page.waitForTimeout(6500); await page.screenshot({ path: `${out}/${name}-hero-2.png` })
    const total = await page.evaluate(() => document.documentElement.scrollHeight)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(name, "height", total, "overflowX", ov)
    // scroll through in steps, shoot viewport slices
    const step = Math.round(h * 0.9)
    let i = 0
    for (let y = h; y < total; y += step) {
      await page.mouse.wheel(0, step); await page.waitForTimeout(700)
      if (process.env.ALL) await page.screenshot({ path: `${out}/${name}-s${String(i).padStart(2, "0")}.png` })
      i++
      if (i > 60) break
    }
    await ctx.close()
  }
  await browser.close(); server.close()
  console.log(errors.length ? errors.join("\n") : "no console errors")
})()
