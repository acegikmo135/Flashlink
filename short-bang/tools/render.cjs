// usage: node tools/render.cjs <page.html> <outDir> [fps=30] [workers=4]
// Frame-by-frame deterministic render: seek the GSAP timeline to t, screenshot, repeat. No dropped frames by construction.
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const page = path.resolve(process.argv[2] || "index.html");
const outDir = path.resolve(process.argv[3] || "out/frames");
const FPS = parseInt(process.argv[4] || "30", 10);
const W = parseInt(process.argv[5] || "4", 10);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const probe = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await probe.goto("file://" + page + "?export=1");
  await probe.evaluate(() => document.fonts.ready);
  const dur = await probe.evaluate(() => window.DUR);
  await probe.close();
  const total = Math.round(dur * FPS);
  console.log("frames", total, "fps", FPS, "workers", W);
  let next = 0, done = 0;
  const worker = async () => {
    const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await p.goto("file://" + page + "?export=1");
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    for (;;) {
      const i = next++;
      if (i >= total) break;
      const t = i / FPS;
      await p.evaluate((t) => window.seekTo(t), t);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await p.screenshot({ path: path.join(outDir, `f_${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 94 });
      if (++done % 60 === 0) console.log("done", done, "/", total);
    }
    await p.close();
  };
  await Promise.all(Array.from({ length: W }, worker));
  await browser.close();
  console.log("render complete");
})();
