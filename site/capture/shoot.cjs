// usage: NODE_PATH=$(npm root -g) node capture/shoot.cjs   (needs `npm run preview` on :4173)
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const OUT = path.resolve(__dirname, "../shots"); fs.mkdirSync(OUT, { recursive: true });
const SECTIONS = ["top", "pipeline", "chats", "toolset", "boards", "security", "short", "quickstart", "faq"];
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  for (const [tag, vp] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await page.goto("http://127.0.0.1:4173/"); await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(OUT, `${tag}-fold.png`) });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 400) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(160); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${tag}-full.png`), fullPage: true });
    for (const id of SECTIONS) {
      const el = await page.$("#" + id); if (!el) continue;
      await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
      await el.screenshot({ path: path.join(OUT, `${tag}-${id}.png`) });
    }
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(tag, "height", h, "overflow", overflow, "errors", errs.length ? errs : "none");
    await ctx.close();
  }
  await browser.close();
})();
