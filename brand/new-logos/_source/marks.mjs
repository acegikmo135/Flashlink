import { C, circleD, f2, pillD, polyD, rectD, strokeToPolygon, offsetLine, setText, loadFont } from "./lib.mjs"

/* All marks live on a 240×240 design grid (module 12). Parts are filled paths; role = ink | accent. */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/* ============ 1 · TRACE — gesture: a PCB trace that is also a bolt ============ */
export function trace(o = {}) {
  const w = o.w ?? 30
  const raw = [[186, 36], [108, 114], [156, 114], [78, 192]]
  const R0 = 28, r0 = 12, Rp = 26
  const xs = [...raw.map((p) => p[0] - R0), ...raw.map((p) => p[0] + R0)], ys = [...raw.map((p) => p[1] - R0), ...raw.map((p) => p[1] + R0)]
  const dx = 120 - (Math.min(...xs) + Math.max(...xs)) / 2, dy = 120 - (Math.min(...ys) + Math.max(...ys)) / 2
  const pts = raw.map((p) => [p[0] + dx, p[1] + dy])
  // the stroke starts on the ring band (distance 22 from its centre) so the ring's hole stays clean
  const u = [(pts[1][0] - pts[0][0]) / Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), (pts[1][1] - pts[0][1]) / Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])]
  const path = [[pts[0][0] + u[0] * 22, pts[0][1] + u[1] * 22], pts[1], pts[2], pts[3]]
  const body = strokeToPolygon(path, w)
  const ring = circleD(pts[0][0], pts[0][1], R0) + circleD(pts[0][0], pts[0][1], r0, true)
  const pad = circleD(pts[3][0], pts[3][1], Rp)
  return {
    name: "trace", idea: "Signal becomes a bolt of copper.",
    parts: [{ d: polyD(body), role: "ink" }, { d: pad, role: "ink" }, { d: ring, role: "accent", rule: "evenodd" }],
    guides: { circles: [[pts[0][0], pts[0][1], R0], [pts[0][0], pts[0][1], r0], [pts[3][0], pts[3][1], Rp]], lines: [pts] },
    sm: null,
  }
}

/* ============ 2 · PIN F — letterform: F built from three header pins + lit LED ============ */
export function pinf() {
  const t = 36 // pin thickness (module 12 × 3)
  const x0 = 54, y0 = 36
  const parts = [
    { d: `M${x0} ${y0 + 168}V${y0 + t / 2}A${t / 2} ${t / 2} 0 0 1 ${x0 + t} ${y0 + t / 2}V${y0 + 168}Z`, role: "ink" }, // stem: round head, flat foot
    { d: pillD(x0, y0, 120, t), role: "ink" },        // top arm
    { d: pillD(x0, y0 + 66, 84, t), role: "ink" },    // middle arm
    { d: circleD(x0 + 120 + 12 + 18, y0 + 18, 18), role: "accent" }, // LED
  ]
  return {
    name: "pinf", idea: "F made of pins, ending in light.", parts,
    guides: { circles: [[x0 + 150, y0 + 18, 18]], lines: [] },
    sm: null,
  }
}

/* ============ 3 · SPLIT — negative space: a disc cut by a stepped flash ============ */
export function split(o = {}) {
  const R = 96, cx = 120, cy = 120, g = o.g ?? 20
  const Q = [[222, 18], [112, 128], [148, 128], [38, 238]] // 45° steps; ends outside the disc
  const A = offsetLine(Q, g / 2), B = offsetLine(Q, -g / 2) // left / right of travel
  const hit = (p, q, last) => { // line p→q ∩ circle; entering (first) or exiting (last)
    const d = [q[0] - p[0], q[1] - p[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L]
    const fx = p[0] - cx, fy = p[1] - cy
    const b = fx * u[0] + fy * u[1], c = fx * fx + fy * fy - R * R, disc = b * b - c
    const s = Math.sqrt(disc), t = last ? -b + s : -b - s
    return [p[0] + u[0] * t, p[1] + u[1] * t]
  }
  const piece = (off, far) => {
    const e = hit(off[0], off[1], false), x = hit(off[off.length - 2], off[off.length - 1], true)
    const inner = off.slice(1, -1)
    const ang = (p) => Math.atan2(p[1] - cy, p[0] - cx), mod = (v) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const aX = ang(x), aE = ang(e), aF = ang(far)
    // arc from exit x back to entry e: pick the sweep direction that passes through `far`
    const cw = mod(aF - aX) < mod(aE - aX)
    const span = cw ? mod(aE - aX) : mod(aX - aE)
    const largeArc = span > Math.PI ? 1 : 0
    const path = "M" + [e, ...inner, x].map((p) => f2(p[0]) + " " + f2(p[1])).join("L") + `A${R} ${R} 0 ${largeArc} ${cw ? 1 : 0} ${f2(e[0])} ${f2(e[1])}Z`
    return path
  }
  const nw = [cx - R * 0.7071, cy - R * 0.7071], se = [cx + R * 0.7071, cy + R * 0.7071]
  return {
    name: "split", idea: "One disc, cut by a flash.",
    parts: [{ d: piece(A, se), role: "ink" }, { d: piece(B, nw), role: "ink" }],
    guides: { circles: [[cx, cy, R]], lines: [Q] },
    sm: null,
  }
}

/* ============ 4 · FL BRIDGE — ligature: f and l joined by one shared crossbar ============ */
/** Geometry in a local space: y down, baseline at y=0, ascender at y=-asc. Returns parts + bounding extents. */
export function flGeom({ stem, asc, xh, gap, hook, bar, fr = 1 }) {
  const parts = []
  const fx = 0                       // f stem left edge
  const lx = fx + stem + gap         // l stem left edge
  const barTop = -xh, barBot = -xh + bar
  const R = hook                     // hook outer radius
  // f: stem + hook (quarter-ring) + terminal, with the crossbar stub to the left
  const top = -asc * fr
  const d = `M${f2(fx)} 0V${f2(top + R)}A${f2(R)} ${f2(R)} 0 0 1 ${f2(fx + R)} ${f2(top)}H${f2(fx + R + stem * 0.55)}V${f2(top + stem)}H${f2(fx + R)}A${f2(R - stem)} ${f2(R - stem)} 0 0 0 ${f2(fx + stem)} ${f2(top + R)}V0Z`
  parts.push({ d, role: "ink" })
  parts.push({ d: rectD(fx - stem * 0.55, barTop, stem * 0.55 + 0.5, bar), role: "ink" }) // left stub
  parts.push({ d: rectD(fx + stem - 0.5, barTop, gap + 1, bar), role: "accent" })          // the link
  parts.push({ d: rectD(lx, -asc, stem, asc), role: "ink" })                               // l (taller than the f: breaks the "A" reading)
  return { parts, x0: fx - stem * 0.55, x1: lx + stem, y0: -asc, y1: 0 }
}
export function flbridge(o = {}) {
  const stem = o.stem ?? 28, asc = 192, xh = 120, gap = o.gap ?? 76, hook = o.hook ?? 44, bar = o.bar ?? 24
  const g = flGeom({ stem, asc, xh, gap, hook, bar, fr: 0.82 })
  const w = g.x1 - g.x0, h = g.y1 - g.y0
  const dx = 120 - (g.x0 + w / 2), dy = 120 - (g.y0 + h / 2)
  const sh = (d) => d // translate by wrapping later
  return {
    name: "flbridge", idea: "Two letters, one link.", parts: g.parts, shift: [dx, dy],
    guides: { circles: [], lines: [] }, sm: null,
  }
}

/* ============ 5 · SIGNAL — pixel F: solid stem, arms dissolving into signal ============ */
export function signal({ small = false } = {}) {
  const u = 24
  const x0 = 48, y0 = 24
  const parts = [{ d: rectD(x0, y0, 2 * u, 8 * u), role: "ink" }] // stem 2u × 8u
  const arm = (y, count) => {
    const sizes = small ? [48, 32] : [48, 32, 16]
    let x = x0 + 2 * u + 4
    for (let i = 0; i < Math.min(count, sizes.length); i++) {
      const s = sizes[i]
      parts.push({ d: rectD(x, y + (48 - s) / 2, s, s), role: i === 0 ? "ink" : "accent" })
      x += s + (small ? 6 : 8)
    }
  }
  arm(y0, 3)              // top arm: 48, 32, 16
  arm(y0 + 4 * u, small ? 2 : 2) // mid arm: 48, 32
  return {
    name: "signal", idea: "Matter dissolving into signal.", parts,
    guides: { circles: [], lines: [] }, sm: null,
  }
}
