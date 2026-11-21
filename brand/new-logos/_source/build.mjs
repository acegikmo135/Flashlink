import { mkdirSync, writeFileSync } from "node:fs"
import { Resvg } from "@resvg/resvg-js"
import { C, circleD, f2, loadFont, pillD, rectD, setText, xformD } from "./lib.mjs"
import { flbridge, flGeom, pinf, signal, split, trace } from "./marks.mjs"

const OUT = process.argv[2] || "out"
const FONT = {
  geist: "node_modules/@fontsource/geist/files/geist-latin-600-normal.woff",
  geistMono: "node_modules/@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff",
  inter: "/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf",
}
const fillFor = (role, scheme) => ({ "color-light": role === "accent" ? C.blue : C.ink, "color-dark": role === "accent" ? C.blue : C.paper, black: "#000", white: "#fff", currentColor: "currentColor" })[scheme]
const pathEl = (p, scheme) => `<path d="${p.d}" fill="${fillFor(p.role, scheme)}"${p.rule === "evenodd" ? ' fill-rule="evenodd"' : ""}/>`
export const svgDoc = (vb, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}">${bg ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${bg}"/>` : ""}${body}</svg>`
export const png = (svg, w) => new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng()

/* bake a mark into the 240 canvas (apply its shift) */
function bake(m) {
  if (!m.shift) return m
  return { ...m, parts: m.parts.map((p) => ({ ...p, d: xformD(p.d, 1, m.shift[0], m.shift[1]) })), shift: null }
}
const place = (parts, k, dx, dy) => parts.map((p) => ({ ...p, d: xformD(p.d, k, dx, dy) }))

/* ---------- wordmarks (outlines, baseline y=0, y down) ---------- */
function wordmark(name) {
  if (name === "trace") {
    const f = loadFont(FONT.geist); let tit
    const t = setText(f, "Flashlink", { size: 100, tracking: -0.02, hooks: { glyph: (ch, i) => (i === 6 ? { dropTittle: true, onTittle: (o) => (tit = o) } : null) } })
    const r = tit.w * 0.78
    t.parts.push({ d: circleD(tit.x, tit.y, r) + circleD(tit.x, tit.y, r * 0.45, true), role: "accent", rule: "evenodd" })
    return t
  }
  if (name === "pinf") {
    const f = loadFont(FONT.geistMono); let pillAt
    const t = setText(f, "FLASHLINK", { size: 100, tracking: 0.12, hooks: { glyph: (ch, i, c) => (i === 6 ? { replace: ({ x, adv, cap }) => { const w = cap * 0.19; return [{ d: pillD(x + adv * 0.31 - w / 2, -cap, w, cap), role: "accent" }] }, advance: c.g.advanceWidth * c.s * 0.62 } : null) } })
    return t
  }
  if (name === "split") {
    const f = loadFont(FONT.inter); let tit
    const t = setText(f, "flashlink", { size: 100, tracking: -0.015, hooks: { glyph: (ch, i) => (i === 6 ? { dropTittle: true, onTittle: (o) => (tit = o) } : null) } })
    const s = tit.w * 1.0
    const d = `M${f2(tit.x)} ${f2(tit.y - s * 0.78)}L${f2(tit.x + s * 0.78)} ${f2(tit.y)}L${f2(tit.x)} ${f2(tit.y + s * 0.78)}L${f2(tit.x - s * 0.78)} ${f2(tit.y)}Z`
    t.parts.push({ d, role: "accent" })
    return t
  }
  if (name === "flbridge") {
    const f = loadFont(FONT.geist)
    const rest = setText(f, "ashlink", { size: 100, tracking: -0.01 })
    const g = flGeom({ stem: rest.stem * 1.0, asc: rest.asc, xh: rest.xHeight, gap: rest.xHeight * 0.52, hook: rest.asc * 0.3, bar: rest.stem * 0.92, fr: 0.94 })
    const lead = g.x1 - g.x0 + rest.size * 0.07
    const parts = [...place(g.parts, 1, -g.x0, 0), ...place(rest.parts, 1, lead, 0)]
    return { ...rest, parts, width: lead + rest.width }
  }
  if (name === "signal") return pixelText("flashlink", 12)
}

/* 5×7 pixel face for the SIGNAL wordmark (rows 0–6, x-height rows 2–6) */
const PX = {
  f: [".##", "#..", "###", "#..", "#..", "#..", "#.."], l: ["#", "#", "#", "#", "#", "#", "#"],
  a: ["....", "....", ".##.", "...#", ".###", "#..#", ".###"], s: ["....", "....", ".###", "#...", ".##.", "...#", "###."],
  h: ["#...", "#...", "###.", "#..#", "#..#", "#..#", "#..#"], i: ["#", ".", "#", "#", "#", "#", "#"],
  n: ["....", "....", "###.", "#..#", "#..#", "#..#", "#..#"], k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
}
function pixelText(str, U) {
  const parts = []
  let x = 0
  const o = 0.35 // overlap so abutting squares never show a seam
  ;[...str].forEach((ch, gi) => {
    const rows = PX[ch]; const w = rows[0].length
    rows.forEach((row, r) => {
      let c = 0
      while (c < row.length) {
        if (row[c] === "#") {
          let e = c; while (e + 1 < row.length && row[e + 1] === "#") e++
          const isDot = ch === "i" && r === 0
          parts.push({ d: rectD((x + c) * U - o, (r - 7) * U - o, (e - c + 1) * U + 2 * o, U + 2 * o), role: isDot ? "accent" : "ink" })
          c = e + 1
        } else c++
      }
    })
    x += w + 1
  })
  return { parts, width: (x - 1) * U, xHeight: 5 * U, capHeight: 7 * U, asc: 7 * U, size: 7 * U }
}

/* ---------- lockups ---------- */
const bboxOf = (parts) => {
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">${parts.map((p) => `<path d="${p.d}"/>`).join("")}</svg>`)
  const b = r.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }
}
export function lockups(m, wm, o = {}) {
  const mark = bake(m)
  const bb = bboxOf(mark.parts)
  const H = wm.asc * (o.markScale ?? 1.55)             // visible mark size relative to the wordmark's ascender
  const k = H / Math.max(bb.w, bb.h)
  const mw = bb.w * k, mh = bb.h * k
  const mx = (px) => (px - bb.x) * k, my = (py) => (py - bb.y) * k
  const markAt = (ox, oy) => mark.parts.map((p) => ({ ...p, d: xformD(p.d, k, ox - bb.x * k, oy - bb.y * k) }))
  const gap = o.gap ?? H * 0.34
  const baseline = Math.max(mh, wm.asc) / 2 + (wm.xHeight + wm.asc) / 4   // wordmark middle on the mark's middle
  const top = 0
  const total = Math.max(mh, wm.asc + wm.size * 0.28)
  const mY = (total - mh) / 2
  const wY = mY + mh / 2 + (wm.xHeight + wm.asc) / 4
  const horiz = [...markAt(0, mY), ...place(wm.parts, 1, mw + gap, wY)]
  const hv = [0, 0, mw + gap + wm.width, total]
  // stacked
  const gap2 = H * 0.3
  const sw = Math.max(mw, wm.width)
  const st2 = o.stackedWord ?? wm
  const sw2 = Math.max(mw, st2.width)
  const stacked = [...markAt((sw2 - mw) / 2, 0), ...place(st2.parts, 1, (sw2 - st2.width) / 2, mh + gap2 + st2.asc)]
  const sv = [0, 0, sw2, mh + gap2 + st2.asc + st2.size * 0.28]
  const word = place(wm.parts, 1, 0, wm.asc)
  return { horiz, hv, stacked, sv, word, wv: [0, 0, wm.width, wm.asc + wm.size * 0.28], mark: mark.parts, k, bb }
}

const logos = [
  { key: "trace", mk: trace, title: "Trace" },
  { key: "pinf", mk: pinf, title: "Pin F" },
  { key: "split", mk: split, title: "Split" },
  { key: "flbridge", mk: flbridge, title: "FL Bridge" },
  { key: "signal", mk: signal, title: "Signal" },
]
export const built = {}
for (const L of logos) {
  const m = bake(L.mk())
  const wm = wordmark(L.key)
  let lk
  if (L.key === "flbridge") {
    const caps = setText(loadFont(FONT.geist), "FLASHLINK", { size: 100, tracking: 0.16 })
    lk = lockups(m, wm, { stackedWord: { ...caps, parts: caps.parts }, markScale: 2.0 })
    const word = place(wm.parts, 1, 0, wm.asc)
    lk.horiz = word; lk.hv = [0, 0, wm.width, wm.asc + wm.size * 0.28]   // the ligature wordmark IS the primary logo
  } else lk = lockups(m, wm, L.key === "signal" ? { markScale: 1.2 } : {})
  const pad = (v, p) => [v[0] - p, v[1] - p, v[2] + 2 * p, v[3] + 2 * p]
  built[L.key] = { ...L, mark: m, wm, lk, small: ({ signal: () => signal({ small: true }), trace: () => trace({ w: 42 }), split: () => split({ g: 24 }), flbridge: () => flbridge({ stem: 38, bar: 32, hook: 52, gap: 64 }) })[L.key]?.() ? bake(({ signal: () => signal({ small: true }), trace: () => trace({ w: 42 }), split: () => split({ g: 24 }), flbridge: () => flbridge({ stem: 38, bar: 32, hook: 52, gap: 64 }) })[L.key]()) : null }
  const dir = `${OUT}/${L.key}`; mkdirSync(dir, { recursive: true })
  const write = (name, vb, parts, scheme, bg) => writeFileSync(`${dir}/flashlink-${L.key}-${name}.svg`, svgDoc(vb, parts.map((p) => pathEl(p, scheme)).join(""), bg))
  for (const [sn, scheme, bg] of [["", "color-light"], ["-on-dark", "color-dark", C.ink], ["-mono-black", "black"], ["-mono-white", "white", "#000"]]) {
    write("icon" + sn, [0, 0, 240, 240], m.parts, scheme, bg)
    write("primary" + sn, pad(lk.hv, S_PAD()), lk.horiz, scheme, bg)
    write("stacked" + sn, pad(lk.sv, S_PAD()), lk.stacked, scheme, bg)
    write("wordmark" + sn, pad(lk.wv, 6), lk.word, scheme, bg)
  }
  write("icon-currentColor", [0, 0, 240, 240], m.parts, "currentColor")
  if (built[L.key].small) { write("icon-sm", [0, 0, 240, 240], built[L.key].small.parts, "color-light"); write("icon-sm-mono-black", [0, 0, 240, 240], built[L.key].small.parts, "black") }
}
function S_PAD() { return 10 }
console.log("built", Object.keys(built).join(", "))
