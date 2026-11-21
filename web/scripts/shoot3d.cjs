// Dev helper: serves web/dist (SPA, signed out) and screenshots the 3D landing at chosen scene/progress points.
// usage: node shoot3d.cjs <outdir> <width> <height> "0:0,1:0.3,..." [dpr]
const http = require("http"), fs = require("fs"), path = require("path")
const { chromium } = require("playwright")
const dist = path.join(__dirname, "..", "dist")
const [out, W, H, spec, dpr] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5], +(process.argv[6] || 1)]
fs.mkdirSync(out, { recursive: true })
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg" }
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0]
  if (u === "/api/web/session") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ user: null, config: { origin: "https://x.workers.dev", installer_url: null } })) }
  let f = path.join(dist, u)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html")
  res.setHeader("content-type", mime[path.extname(f)] || "application/octet-stream"); fs.createReadStream(f).pipe(res)
})
;(async () => {
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] })
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, reducedMotion: process.env.RM ? "reduce" : "no-preference", userAgent: process.env.MOBILE ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" : undefined })
  const page = await ctx.newPage(); const errs = []
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()))
  page.on("pageerror", (e) => errs.push("PAGEERR " + e.message))
  await page.goto(base + "/", { waitUntil: "networkidle" })
  await page.waitForTimeout(5000)
  console.log("overflowX", await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "height", await page.evaluate(() => document.documentElement.scrollHeight))
  for (const item of spec.split(",")) {
    const [sc, fr] = item.split(":").map(Number)
    const y = await page.evaluate(([sc, fr]) => {
      const el = document.querySelectorAll(".scene")[sc]; const r = el.getBoundingClientRect(); const top = r.top + scrollY
      const pinned = getComputedStyle(el.querySelector(".pin") || el).position === "sticky"
      return top + fr * Math.max(0, r.height - (pinned ? innerHeight : 0))
    }, [sc, fr])
    await page.evaluate((y) => window.scrollTo(0, y), y)
    await page.waitForTimeout(+process.env.WAIT || 2600)
    await page.screenshot({ path: `${out}/s${sc}_${String(fr).replace(".", "")}.png` })
  }
  console.log(errs.length ? errs.slice(0, 8).join("\n") : "no console errors")
  await b.close(); server.close()
})()
