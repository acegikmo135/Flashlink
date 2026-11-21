import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs"
const keys = ["trace", "pinf", "split", "flbridge", "signal"]
const META = {
  trace:    { name: "Trace", strategy: "Abstract gesture", idea: "Signal becomes a bolt of copper.", why: "A PCB trace drawn as a lightning step: a hollow ring (the AI's signal) travels to a solid pad (the board). 45° / 90° only, one 30-unit weight.", scores: [4, 4, 3, 4, 4, 3, 4, 4, 3, 4] },
  pinf:     { name: "Pin F", strategy: "Letterform from the brand's object", idea: "F made of pins, ending in light.", why: "Three header pins form the F — round heads, a flat foot where it plugs into the board — and the LED that confirms the flash sits off the top arm.", scores: [4, 3, 5, 5, 5, 3, 4, 3, 5, 4] },
  split:    { name: "Split", strategy: "Negative space", idea: "One disc, cut by a flash.", why: "A solid disc divided by a stepped 45° cut: the gap is the bolt. Two pieces, one idea; the strongest silhouette of the five.", scores: [4, 5, 4, 5, 4, 3, 4, 4, 5, 4] },
  flbridge: { name: "FL Bridge", strategy: "Ligature / system wordmark", idea: "Two letters, one link.", why: "The f's crossbar runs across to the l: the join is the 'link' in Flashlink, and it is the one blue element. The ligature is the first two letters of the logotype.", scores: [4, 3, 3, 3, 4, 4, 4, 5, 3, 4] },
  signal:   { name: "Signal", strategy: "System / abstract", idea: "Matter dissolving into signal.", why: "A pixel F: a solid stem, then arms that shrink into blue dots. It speaks the pixel typography of the site and means digital → physical.", scores: [4, 4, 4, 4, 5, 4, 5, 4, 4, 3] },
}
const CRIT = ["One idea", "Silhouette", "16px", "One-colour", "Geometry", "Ownable", "Appropriate", "Wordmark", "Versatility", "Timeless"]
const rd = (f) => readFileSync(f, "utf8")
const inline = (f, cls = "") => rd(f).replace("<svg ", `<svg class="${cls}" `)
const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64")
const css = `
*{box-sizing:border-box}body{margin:0;background:#E7EAEE;font-family:Inter,system-ui,sans-serif;color:#07090D;-webkit-font-smoothing:antialiased}
.sec{width:1600px;padding:56px 64px 64px;background:#fff;margin:0 auto 24px}
h2{font-size:44px;letter-spacing:-.03em;margin:0}.sub{color:#5a6577;font-size:17px;margin-top:6px;max-width:900px}
.tag{display:inline-block;font:600 12px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#3185FF;margin-bottom:10px}
.row{display:grid;gap:20px;margin-top:22px}.card{border-radius:14px;overflow:hidden;position:relative}
.paper{background:#F4F6F8}.ink{background:#07090D}.lab{position:absolute;left:14px;top:12px;font:500 11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;opacity:.55}
.center{display:flex;align-items:center;justify-content:center}.ink .lab{color:#fff}
.score{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin-top:22px}.score div{background:#F4F6F8;border-radius:10px;padding:10px 8px;text-align:center;font:500 11px ui-monospace,monospace;color:#5a6577}.score b{display:block;font:700 24px Inter;color:#07090D;margin-bottom:2px}
.fav{display:flex;align-items:flex-end;gap:18px;padding:18px}.fav img{image-rendering:pixelated}
.browser{background:#fff;border:1px solid #d8dde4;border-radius:12px;overflow:hidden}.bar{height:30px;background:#EEF1F4;display:flex;gap:6px;align-items:center;padding:0 12px}.bar i{width:9px;height:9px;border-radius:50%;background:#cdd3db}
.nav{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid #eef0f3}.nav .links{display:flex;gap:22px;font-size:13px;color:#5a6577}.btn{background:#07090D;color:#fff;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:600}
.cardmock{aspect-ratio:1.75;border-radius:8px;box-shadow:0 12px 30px rgba(7,9,13,.18)}.sign{height:100%;display:flex;align-items:center;justify-content:center;background:#1a1f29;border-radius:6px}
`
let html = `<html><head><style>${css}</style></head><body>`
// overview
html += `<div class="sec" id="overview"><span class="tag">Flashlink · five new identities</span><h2>Five directions, one name</h2><div class="sub">Each hand-built in SVG from circles, straight segments and a 12-unit grid, then judged by render: squint, 16 px, photocopy, reverse and flip.</div><div class="row" style="grid-template-columns:repeat(5,1fr)">${keys.map((k) => `<div class="card paper" style="padding:26px 18px 18px"><div class="center" style="height:170px">${inline(`out/${k}/flashlink-${k}-icon.svg`, "")}</div><div style="margin-top:14px;font-weight:700;font-size:19px">${META[k].name}</div><div style="font-size:12.5px;color:#5a6577;margin-top:2px">${META[k].strategy}</div><div style="font-size:13px;margin-top:8px">${META[k].idea}</div><div style="margin-top:10px;font:600 12px ui-monospace,monospace;color:#3185FF">${META[k].scores.reduce((a, b) => a + b, 0)}/50</div></div>`).join("")}</div><div class="row" style="grid-template-columns:repeat(5,1fr)">${keys.map((k) => `<div class="card ink" style="padding:18px 14px"><div class="center" style="height:150px"><div style="height:130px;display:flex;justify-content:center">${inline(`out/${k}/flashlink-${k}-stacked-on-dark.svg`).replace(/<rect[^>]*\/>/, "").replace("<svg ", `<svg style="height:130px;width:auto" `)}</div></div></div>`).join("")}</div></div>`
for (const k of keys) {
  const m = META[k], d = `out/${k}`, total = m.scores.reduce((a, b) => a + b, 0)
  const png = (n) => b64(`${d}/png/flashlink-${k}-icon-${n}.png`)
  html += `<div class="sec" id="${k}"><span class="tag">${m.strategy}</span><h2>${m.name}</h2><div class="sub"><b>${m.idea}</b> ${m.why}</div>
  <div class="row" style="grid-template-columns:1.25fr 1fr"><div class="card paper center" style="height:280px;padding:40px"><span class="lab">Primary · paper</span><div style="width:100%;max-width:640px">${inline(`${d}/flashlink-${k}-primary.svg`)}</div></div><div class="card ink center" style="height:280px;padding:40px"><span class="lab">Primary · ink</span><div style="width:100%;max-width:520px">${inline(`${d}/flashlink-${k}-primary-on-dark.svg`).replace(/<rect[^>]*\/>/, "")}</div></div></div>
  <div class="row" style="grid-template-columns:1.1fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr">
    <div class="card center" style="height:210px;background:#fff;border:1px solid #e3e7ec"><span class="lab">Construction</span><div style="width:170px">${inline(`${d}/flashlink-${k}-construction.svg`)}</div></div>
    <div class="card paper center" style="height:210px"><span class="lab">Colour</span><div style="width:120px">${inline(`${d}/flashlink-${k}-icon.svg`)}</div></div>
    <div class="card ink center" style="height:210px"><span class="lab">Reverse</span><div style="width:120px">${inline(`${d}/flashlink-${k}-icon-on-dark.svg`).replace(/<rect[^>]*\/>/, "")}</div></div>
    <div class="card center" style="height:210px;background:#fff;border:1px solid #e3e7ec"><span class="lab">Mono black</span><div style="width:120px">${inline(`${d}/flashlink-${k}-icon-mono-black.svg`)}</div></div>
    <div class="card center" style="height:210px;background:#000"><span class="lab" style="color:#fff">Mono white</span><div style="width:120px">${inline(`${d}/flashlink-${k}-icon-mono-white.svg`).replace(/<rect[^>]*\/>/, "")}</div></div>
    <div class="card paper" style="height:210px"><span class="lab">Favicons (real pixels)</span><div class="fav" style="margin-top:34px"><img src="${b64(`${d}/png/flashlink-${k}-icon-16.png`)}" width="16"/><img src="${b64(`${d}/png/flashlink-${k}-icon-32.png`)}" width="32"/><img src="${b64(`${d}/png/flashlink-${k}-icon-48.png`)}" width="48"/><img src="${b64(`${d}/png/flashlink-${k}-icon-16.png`)}" width="64"/><img src="${b64(`${d}/png/flashlink-${k}-icon-32.png`)}" width="96"/></div></div>
  </div>
  <div class="row" style="grid-template-columns:230px 150px 1.5fr 1fr 1fr">
    <div class="card center" style="height:230px;background:#E7EAEE"><span class="lab">App icon</span><img src="${b64(`${d}/png/flashlink-${k}-app-icon-1024.png`)}" width="170"/></div>
    <div class="card center" style="height:230px;background:#E7EAEE;flex-direction:column;gap:12px"><span class="lab">Avatar</span><div style="width:96px;height:96px;border-radius:50%;background:#07090D;display:flex;align-items:center;justify-content:center;overflow:hidden"><div style="width:64px">${inline(`${d}/flashlink-${k}-icon-on-dark.svg`).replace(/<rect[^>]*\/>/, "")}</div></div></div>
    <div class="browser" style="height:230px"><div class="bar"><i></i><i></i><i></i></div><div class="nav"><div style="width:150px">${inline(`${d}/flashlink-${k}-primary.svg`)}</div><div class="links"><span>Experience</span><span>Hardware</span><span>Docs</span><span class="btn">Get started</span></div></div><div style="padding:22px;font:700 24px Inter;letter-spacing:-.03em">Give intelligence a physical connection.</div></div>
    <div class="center" style="background:#E7EAEE;border-radius:14px"><div class="cardmock ink center" style="width:84%;flex-direction:column;gap:6px;padding:16px"><div style="width:130px">${inline(`${d}/flashlink-${k}-stacked-on-dark.svg`).replace(/<rect[^>]*\/>/, "")}</div></div></div>
    <div class="center" style="background:#c9ced6;border-radius:14px;padding:18px"><div class="sign" style="width:100%"><div style="width:84%">${inline(`${d}/flashlink-${k}-primary-on-dark.svg`).replace(/<rect[^>]*\/>/, "")}</div></div></div>
  </div>
  <div class="score">${m.scores.map((s, i) => `<div><b>${s}</b>${CRIT[i]}</div>`).join("")}</div>
  <div style="margin-top:12px;font:600 13px ui-monospace,monospace;color:#5a6577">TOTAL ${total}/50 ${total >= 40 ? "· passes the winner gate" : "· below the 40/50 winner gate (kept: delivered as one of five requested directions)"}</div></div>`
}
html += "</body></html>"
writeFileSync("board.html", html)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 })
await p.setContent(html, { waitUntil: "load" }); await p.waitForTimeout(500)
mkdirSync("boards", { recursive: true })
for (const id of ["overview", ...keys]) await (await p.$("#" + id)).screenshot({ path: `boards/board-${id}.png` })
await p.screenshot({ path: "boards/board-all.png", fullPage: true })
await b.close(); console.log("boards done")
