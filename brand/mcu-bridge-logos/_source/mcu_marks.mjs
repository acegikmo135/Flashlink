import { circleD, f2, pillD, rectD } from "./lib.mjs"

/* All marks on a 240 grid. Parts are filled paths; role = ink | accent. */

/* 1 · ARCH M — letterform + metaphor: a lowercase m is two bridge arches; the second span is the signal (blue) */
export function archm(o = {}) {
  const w = o.w ?? 32, R = o.R ?? 48, r = R - w
  const yb = 204, yc = 108
  const arch = (x0, role, skipLeft = false) => {
    const x1 = x0 + 2 * R
    const d = `M${x0} ${yb}V${yc}A${R} ${R} 0 0 1 ${x1} ${yc}V${yb}H${x1 - w}V${yc}A${r} ${r} 0 0 0 ${x0 + w} ${yc}V${yb}Z`
    return { d, role }
  }
  const x0 = 120 - (3 * R - w) / 2 // total width = 4R - w... centred
  const total = 4 * R - w, left = 120 - total / 2
  return {
    name: "archm", idea: "Two arches, one bridge.",
    parts: [arch(left + 2 * R - w, "accent"), arch(left, "ink")],
    guides: { circles: [[left + R, yc, R], [left + R, yc, r], [left + 3 * R - w, yc, R], [left + 3 * R - w, yc, r]], lines: [] },
  }
}

/* 2 · SPAN — gesture: one arch, two different feet: a square pad (hardware) and a ring (signal) */
export function span() {
  const w = 34, R = 74, r = R - w, cx = 120, yc = 104
  const lx = cx - (R - w / 2), rx = cx + (R - w / 2) // leg centre lines
  const foot = 200
  const arch = `M${f2(lx - w / 2)} ${foot}V${yc}A${R} ${R} 0 0 1 ${f2(rx + w / 2)} ${yc}V${foot}H${f2(rx - w / 2)}V${yc}A${r} ${r} 0 0 0 ${f2(lx + w / 2)} ${yc}V${foot}Z`
  const pad = rectD(lx - 32, foot - 6, 64, 54)
  const ringC = [rx, foot + 21]
  const ring = circleD(ringC[0], ringC[1], 33) + circleD(ringC[0], ringC[1], 13, true)
  // centre the whole (top yc-R .. bottom foot+48)
  const top = yc - R, bot = foot + 48, dy = 120 - (top + bot) / 2
  const sh = (d) => d // translated below
  return {
    name: "span", idea: "A bridge between two worlds.", shift: [0, dy],
    parts: [{ d: arch, role: "ink" }, { d: pad, role: "ink" }, { d: ring, role: "accent", rule: "evenodd" }],
    guides: { circles: [[cx, yc, R], [cx, yc, r], [ringC[0], ringC[1], 33], [ringC[0], ringC[1], 13]], lines: [] },
  }
}

/* 3 · CHIP ARCH — negative space: an MCU package with a bridge opening cut through it; a blue signal passes under */
export function chiparch() {
  const x0 = 56, y0 = 40, S = 128, rr = 22
  const body = `M${x0 + rr} ${y0}H${x0 + S - rr}A${rr} ${rr} 0 0 1 ${x0 + S} ${y0 + rr}V${y0 + S - rr}A${rr} ${rr} 0 0 1 ${x0 + S - rr} ${y0 + S}H${x0 + rr}A${rr} ${rr} 0 0 1 ${x0} ${y0 + S - rr}V${y0 + rr}A${rr} ${rr} 0 0 1 ${x0 + rr} ${y0}Z`
  // arch opening from the bottom edge
  const aw = 64, ax = 120 - aw / 2, ah = 86, ar = aw / 2
  const arch = `M${ax} ${y0 + S}V${y0 + S - ah + ar}A${ar} ${ar} 0 0 1 ${ax + aw} ${y0 + S - ah + ar}V${y0 + S}Z`
  const pins = []
  const pw = 28, ph = 16
  ;[y0 + 28, y0 + S / 2, y0 + S - 28].forEach((cy) => {
    pins.push({ d: pillD(x0 - pw - 4, cy - ph / 2, pw, ph), role: "ink" }, { d: pillD(x0 + S + 4, cy - ph / 2, pw, ph), role: "ink" })
  })
  const dot = circleD(120, y0 + S - 22, 11)
  const total = [x0 - pw - 4, x0 + S + pw + 4]
  return {
    name: "chiparch", idea: "A chip with a bridge through it.",
    parts: [{ d: body + arch, role: "ink", rule: "evenodd" }, ...pins, { d: dot, role: "accent" }],
    guides: { circles: [[120, y0 + S - ah + ar, ar]], lines: [] },
  }
}

/* 4 · PIXEL BRIDGE — system: a pixel arch with signal pixels shrinking beneath it */
export function pixelbridge({ small = false } = {}) {
  const u = 27, cols = 8, rows = 6, o = 0.3
  const x0 = (240 - cols * u) / 2, y0 = (240 - rows * u) / 2
  const R = (c, r, w, h, role = "ink") => ({ d: rectD(x0 + c * u - o, y0 + r * u - o, w * u + 2 * o, h * u + 2 * o), role })
  const sq = (c, r, size, role = "accent") => ({ d: rectD(x0 + c * u + (u - size) / 2, y0 + r * u + (u - size) / 2, size, size), role })
  const ink = [R(2, 0, 4, 1), R(1, 1, 2, 1), R(5, 1, 2, 1), R(0, 2, 2, 4), R(6, 2, 2, 4)]
  const sig = small ? [sq(2, 5, 27), sq(3, 5, 18)] : [sq(2, 5, 27), sq(3, 5, 18), sq(4, 5, 9)]
  return { name: "pixelbridge", idea: "A bridge, pixel by pixel.", parts: [...ink, ...sig], guides: { circles: [], lines: [] } }
}

/* 5 · B ARCH — letterform: a B whose two counters are bridge arches; a blue signal sits in the lower one */
export function barch() {
  const x0 = 50, y0 = 36
  const top = `M${x0} ${y0}H${x0 + 82}A42 42 0 0 1 ${x0 + 82} ${y0 + 84}H${x0}Z`
  const bot = `M${x0} ${y0 + 84}H${x0 + 98}A42 42 0 0 1 ${x0 + 98} ${y0 + 168}H${x0}Z`
  const c1 = `M${x0 + 38} ${y0 + 66}V${y0 + 44}A18 18 0 0 1 ${x0 + 74} ${y0 + 44}V${y0 + 66}Z`
  const c2 = `M${x0 + 38} ${y0 + 150}V${y0 + 114}A26 26 0 0 1 ${x0 + 90} ${y0 + 114}V${y0 + 150}Z`
  const dot = circleD(x0 + 64, y0 + 136, 11)
  const width = 98 + 42, dx = 120 - (x0 + width / 2)
  return {
    name: "barch", idea: "B with bridge-arch counters.", shift: [dx, 0],
    parts: [{ d: top + bot + c1 + c2, role: "ink", rule: "evenodd" }, { d: dot, role: "accent" }],
    guides: { circles: [[x0 + 56, y0 + 44, 16], [x0 + 64, y0 + 112, 24]], lines: [] },
  }
}
