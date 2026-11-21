// Re-render the README banner + logo PNG:  NODE_PATH=$(npm root -g) node docs/assets/src/render.cjs
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  await p.goto("file://" + path.resolve(__dirname, "banner.html")); await p.waitForTimeout(600);
  await p.screenshot({ path: path.resolve(__dirname, "../banner.png") });
  const l = await b.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 });
  await l.setContent('<body style="margin:0;background:transparent"><img src="file://' + path.resolve(__dirname, "../logo.svg") + '" width=256 height=256>');
  await l.waitForTimeout(300); await l.screenshot({ path: path.resolve(__dirname, "../logo.png"), omitBackground: true });
  await b.close();
})();
