import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { Resvg } from "@resvg/resvg-js"
import { C } from "./lib.mjs"
const keys = ["archm", "span", "chiparch", "pixelbridge", "barch"]
const OUT = "out-mcu"
const rd = (f) => readFileSync(f, "utf8")
const body = (s) => s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
const render = (svg, w) => new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng()
for (const k of keys) {
  const d = `${OUT}/${k}`; mkdirSync(`${d}/png`, { recursive: true })
  const icon = rd(`${d}/mcu-bridge-${k}-icon.svg`), iconDark = rd(`${d}/mcu-bridge-${k}-icon-on-dark.svg`).replace(/<rect[^>]*\/>/, "")
  const hasSm = ["pixelbridge", "archm"].includes(k); const sm = hasSm ? rd(`${d}/mcu-bridge-${k}-icon-sm.svg`) : icon
  // transparent PNG exports
  for (const w of [1024, 512, 256, 64]) writeFileSync(`${d}/png/mcu-bridge-${k}-icon-${w}.png`, render(icon, w))
  for (const w of [32, 16, 48]) writeFileSync(`${d}/png/mcu-bridge-${k}-icon-${w}.png`, render(w <= 32 ? sm : icon, w))
  // app icon: ink squircle, mark on dark colourway at 62%
  const sq = (bg, g) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="230" fill="${bg}"/><g transform="translate(194 194) scale(${636 / 240})">${g}</g></svg>`
  writeFileSync(`${d}/png/mcu-bridge-${k}-app-icon-1024.png`, render(sq(C.ink, body(iconDark)), 1024))
  writeFileSync(`${d}/mcu-bridge-${k}-app-icon.svg`, sq(C.ink, body(iconDark)))
  // construction view: 12-unit grid, centre axes, circle/line guides
  const g = (await import("./mcu_marks.mjs"))
  const mark = { archm: g.archm, span: g.span, chiparch: g.chiparch, pixelbridge: g.pixelbridge, barch: g.barch }[k]()
  let grid = ""
  for (let i = 0; i <= 240; i += 12) grid += `<line x1="${i}" y1="0" x2="${i}" y2="240" stroke="${C.blue}" stroke-opacity="${i % 60 === 0 ? 0.35 : 0.14}" stroke-width="${i % 60 === 0 ? 0.8 : 0.5}"/><line x1="0" y1="${i}" x2="240" y2="${i}" stroke="${C.blue}" stroke-opacity="${i % 60 === 0 ? 0.35 : 0.14}" stroke-width="${i % 60 === 0 ? 0.8 : 0.5}"/>`
  const circ = (mark.guides?.circles ?? []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${C.blue}" stroke-width="0.9"/>`).join("")
  const lines = (mark.guides?.lines ?? []).map((l) => `<polyline points="${l.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${C.blue}" stroke-width="0.9" stroke-dasharray="3 3"/>`).join("")
  const shift = mark.shift ? `translate(${mark.shift[0]} ${mark.shift[1]})` : ""
  const shape = mark.parts.map((p) => `<path d="${p.d}" fill="${C.ink}" fill-opacity="0.12" stroke="${C.ink}" stroke-width="0.8"${p.rule === "evenodd" ? ' fill-rule="evenodd"' : ""}/>`).join("")
  writeFileSync(`${d}/mcu-bridge-${k}-construction.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#fff"/>${grid}<g transform="${shift}">${shape}${circ}${lines}</g></svg>`)
  writeFileSync(`${d}/png/mcu-bridge-${k}-construction.png`, render(rd(`${d}/mcu-bridge-${k}-construction.svg`), 800))
}
// ---- test battery sheet (PIL composes later from these PNGs)
for (const k of keys) {
  const d = `${OUT}/${k}`
  writeFileSync(`${d}/png/t-black-256.png`, render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#fff"/>${body(rd(`${d}/mcu-bridge-${k}-icon-mono-black.svg`))}</svg>`, 256))
  writeFileSync(`${d}/png/t-white-256.png`, render(rd(`${d}/mcu-bridge-${k}-icon-mono-white.svg`), 256))
  const sm = ["pixelbridge", "archm"].includes(k) ? rd(`${d}/mcu-bridge-${k}-icon-sm-mono-black.svg`) : rd(`${d}/mcu-bridge-${k}-icon-mono-black.svg`)
  for (const w of [16, 32]) writeFileSync(`${d}/png/t-${w}.png`, render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#fff"/>${body(w <= 32 ? sm : rd(`${d}/mcu-bridge-${k}-icon.svg`))}</svg>`, w))
}
console.log("exported")
