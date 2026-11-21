// Geometry + typography helpers for the Flashlink logo suite. Everything exported is filled paths.
import opentype from "opentype.js"
import { readFileSync } from "node:fs"

export const C = { ink: "#07090D", paper: "#F4F6F8", blue: "#3185FF", grey: "#8A94A6" }
export const f2 = (n) => (Math.round(n * 100) / 100).toString()

/* ---------- polyline → filled polygon (miter joins, butt caps) ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const len = (v) => Math.hypot(v[0], v[1])
const norm = (v) => { const l = len(v); return [v[0] / l, v[1] / l] }
const lineHit = (p1, d1, p2, d2) => {
  const cr = d1[0] * d2[1] - d1[1] * d2[0]
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cr
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]
}
/** Offset an open polyline by `off` (positive = left of travel direction). Miter joins. */
export function offsetLine(pts, off) {
  const segs = []
  for (let i = 0; i < pts.length - 1; i++) {
    const d = norm(sub(pts[i + 1], pts[i])), n = [d[1], -d[0]] // left normal (y-down screen: [dy,-dx])
    segs.push({ p: [pts[i][0] + n[0] * off, pts[i][1] + n[1] * off], d })
  }
  const out = [segs[0].p]
  for (let i = 1; i < segs.length; i++) out.push(lineHit(segs[i - 1].p, segs[i - 1].d, segs[i].p, segs[i].d))
  const last = segs[segs.length - 1]
  out.push([pts[pts.length - 1][0] + (last.p[0] - pts[pts.length - 2][0]), pts[pts.length - 1][1] + (last.p[1] - pts[pts.length - 2][1])])
  return out
}
export function strokeToPolygon(pts, w) {
  const a = offsetLine(pts, w / 2), b = offsetLine(pts, -w / 2).reverse()
  return [...a, ...b]
}
export const polyD = (p) => "M" + p.map((q) => f2(q[0]) + " " + f2(q[1])).join("L") + "Z"
export const circleD = (cx, cy, r, ccw = false) => `M${f2(cx - r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 ${ccw ? 0 : 1} ${f2(cx + r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 ${ccw ? 0 : 1} ${f2(cx - r)} ${f2(cy)}Z`
export const rectD = (x, y, w, h) => `M${f2(x)} ${f2(y)}H${f2(x + w)}V${f2(y + h)}H${f2(x)}Z`
export function pillD(x, y, w, h) {
  const r = Math.min(w, h) / 2
  return w >= h
    ? `M${f2(x + r)} ${f2(y)}H${f2(x + w - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w - r)} ${f2(y + h)}H${f2(x + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + r)} ${f2(y)}Z`
    : `M${f2(x + w)} ${f2(y + r)}V${f2(y + h - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x)} ${f2(y + h - r)}V${f2(y + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w)} ${f2(y + r)}Z`
}

/* ---------- parts model ---------- */
// A mark is { parts:[{d, role:'ink'|'accent', rule?}], box:[x,y,w,h] } in a 240-unit design space.
export const bboxOfPoints = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
export function recenter(parts, box, size = 240) {
  const [x0, y0, x1, y1] = box
  const dx = size / 2 - (x0 + x1) / 2, dy = size / 2 - (y0 + y1) / 2
  return { dx, dy, parts, box: [x0 + dx, y0 + dy, x1 + dx, y1 + dy] }
}

/* ---------- typography ---------- */
const cache = {}
export function loadFont(path) {
  if (!cache[path]) { const b = readFileSync(path); cache[path] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
  return cache[path]
}
/** Split a glyph path into contours (array of command arrays). */
function contours(path) {
  const out = []
  let cur = null
  for (const c of path.commands) { if (c.type === "M") { cur = []; out.push(cur) } cur.push(c) }
  return out
}
const contourD = (cs, ox, oy, s) => cs.map((c) => {
  const X = (v) => f2(ox + v * s), Y = (v) => f2(oy + v * s) // opentype paths are already y-down
  if (c.type === "M") return "M" + X(c.x) + " " + Y(c.y)
  if (c.type === "L") return "L" + X(c.x) + " " + Y(c.y)
  if (c.type === "C") return "C" + X(c.x1) + " " + Y(c.y1) + " " + X(c.x2) + " " + Y(c.y2) + " " + X(c.x) + " " + Y(c.y)
  if (c.type === "Q") return "Q" + X(c.x1) + " " + Y(c.y1) + " " + X(c.x) + " " + Y(c.y)
  return "Z"
}).join("")
const cbox = (cs) => {
  const xs = [], ys = []
  cs.forEach((c) => { if (c.x !== undefined) { xs.push(c.x); ys.push(c.y) } })
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/**
 * Set text as outlines. `hooks.glyph(ch, i)` may return {skip:true} (omit glyph, still advance),
 * or {replace:(ctx)=>[{d,role}]} to swap a glyph for custom geometry, or {dropTittle:true}.
 * Returns {parts, width, xHeight, capHeight, asc, size} with the baseline at y=0, y down, origin x=0.
 */
export function setText(font, str, { size = 100, tracking = 0, hooks = {} } = {}) {
  const s = size / font.unitsPerEm
  const xh = font.charToGlyph("x").getBoundingBox().y2 * s
  const cap = font.charToGlyph("H").getBoundingBox().y2 * s
  const asc = font.charToGlyph("l").getBoundingBox().y2 * s
  const stem = (font.charToGlyph("l").getBoundingBox().x2 - font.charToGlyph("l").getBoundingBox().x1) * s
  let x = 0
  const parts = []
  const gl = [...str].map((ch) => font.charToGlyph(ch))
  gl.forEach((g, i) => {
    const ch = str[i]
    const h = hooks.glyph?.(ch, i, { x, s, xh, cap, asc, stem, g })
    const adv = g.advanceWidth * s
    const bb = g.getBoundingBox()
    if (h?.replace) parts.push(...h.replace({ x, s, xh, cap, asc, stem, adv, bb }))
    else if (!h?.skip) {
      const p = g.getPath(0, 0, font.unitsPerEm)
      let cs = contours(p)
      if (h?.dropTittle) {
        const top = cs.map((c) => ({ c, b: cbox(c) })).sort((a, b) => a.b.y0 - b.b.y0)[0] // y-down: smallest y = highest on the page
        cs = cs.filter((c) => c !== top.c)
        h.onTittle?.({ x: x + (top.b.x0 + top.b.x1) / 2 * s, y: (top.b.y0 + top.b.y1) / 2 * s, w: (top.b.x1 - top.b.x0) * s, h: (top.b.y1 - top.b.y0) * s })
      }
      parts.push({ d: contourD(cs.flat(), x, 0, s), role: h?.role ?? "ink", rule: "nonzero" })
    }
    x += h?.advance ?? adv
    if (i < gl.length - 1) x += font.getKerningValue(g, gl[i + 1]) * s + tracking * size
  })
  return { parts, width: x - tracking * size, xHeight: xh, capHeight: cap, asc, stem, size }
}

/* ---------- path transform (absolute commands only: M L H V A C Q Z) ---------- */
export function xformD(d, k = 1, dx = 0, dy = 0) {
  const toks = d.match(/[MLHVACQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi)
  const out = []
  let i = 0
  const num = () => parseFloat(toks[i++])
  while (i < toks.length) {
    const c = toks[i++]
    if (c === "Z") out.push("Z")
    else if (c === "H") out.push("H" + f2(num() * k + dx))
    else if (c === "V") out.push("V" + f2(num() * k + dy))
    else if (c === "A") { const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), x = num(), y = num(); out.push(`A${f2(rx * k)} ${f2(ry * k)} ${f2(rot)} ${la} ${sw} ${f2(x * k + dx)} ${f2(y * k + dy)}`) }
    else if (c === "C") { const a = [num(), num(), num(), num(), num(), num()]; out.push("C" + [0, 1, 2, 3, 4, 5].map((j) => f2(a[j] * k + (j % 2 ? dy : dx))).join(" ")) }
    else if (c === "Q") { const a = [num(), num(), num(), num()]; out.push("Q" + [0, 1, 2, 3].map((j) => f2(a[j] * k + (j % 2 ? dy : dx))).join(" ")) }
    else { const x = num(), y = num(); out.push(c + f2(x * k + dx) + " " + f2(y * k + dy)) }
  }
  return out.join("")
}
/** Implicit lineto pairs after M (e.g. "M1 2 3 4") are rewritten by our own generators as explicit L, so xformD is safe. */
