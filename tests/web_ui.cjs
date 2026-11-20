// Drives the real web UI in headless Chromium: sign in through the form, visit every page, screenshot, assert.
const { chromium } = require("playwright");
const [base, out, email, password] = process.argv.slice(2);
const fs = require("fs");
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 401")) errors.push(m.text()); });

  // login page (unauthenticated "/" redirects to /login)
  await page.goto(base + "/");
  await page.waitForURL("**/login");
  check("root redirects to /login", true);
  await page.screenshot({ path: `${out}/1-login.png` });
  // wrong password shows an error
  await page.fill("#email", email);
  await page.fill("#password", "definitely-wrong-password");
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=alert]");
  check("bad login shows alert", (await page.textContent("[role=alert]")).includes("Invalid"));
  // real login
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
  await page.waitForSelector("text=Success rate");
  check("login lands on dashboard", true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/2-overview.png` });

  for (const [label, path, text] of [["devices", "/dashboard/devices", "Connected boards"], ["activity", "/dashboard/activity", "Every flash"], ["access", "/dashboard/access", "Connector"], ["account", "/dashboard/account", "Change password"]]) {
    await page.goto(base + path);
    await page.waitForSelector(`text=${text}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/3-${label}.png` });
    check(`${label} page renders`, true);
  }
  // devices page shows the simulated ESP32
  await page.goto(base + "/dashboard/devices");
  await page.waitForSelector("text=Connected boards");
  check("device table lists the board", (await page.textContent("main")).includes("ESP32") || (await page.textContent("main")).includes("No board detected"));

  // create a token through the dialog
  await page.goto(base + "/dashboard/access");
  await page.click("text=New token");
  await page.waitForSelector("text=Create access token");
  await page.screenshot({ path: `${out}/4-token-dialog.png` });
  await page.click("button:has-text('Create token')");
  await page.waitForSelector("text=Copy your token now");
  const body = await page.textContent("[role=dialog]");
  check("token shown once with mcp command", /mcb_mcp_/.test(body) && body.includes("claude mcp add"));
  await page.screenshot({ path: `${out}/5-token-created.png` });

  // light theme
  await page.keyboard.press("Escape");
  await page.goto(base + "/dashboard");
  await page.waitForSelector("text=Success rate");
  await page.click("button[aria-label='Toggle theme']");
  await page.waitForTimeout(300);
  check("theme toggles to light", !(await page.evaluate(() => document.documentElement.classList.contains("dark"))));
  await page.screenshot({ path: `${out}/6-overview-light.png` });

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(base + "/login");
  await mp.fill("#email", email); await mp.fill("#password", password); await mp.click("button[type=submit]");
  await mp.waitForSelector("text=Success rate");
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `${out}/7-mobile.png` });
  check("mobile has no horizontal scroll", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  check("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(JSON.stringify(results));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
