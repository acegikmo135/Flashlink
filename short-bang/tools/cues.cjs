// usage: node tools/cues.cjs [page.html] [out.json]  — reads the sound cues the film registers while building its timeline
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto("file://" + path.resolve(process.argv[2] || "index.html") + "?export=1");
  await p.waitForTimeout(500);
  const c = await p.evaluate(() => ({ dur: window.DUR, cues: window.__sfx }));
  fs.writeFileSync(process.argv[3] || "out/sfx.json", JSON.stringify(c));
  console.log("cues", c.cues.length, "dur", c.dur);
  await b.close();
})();
