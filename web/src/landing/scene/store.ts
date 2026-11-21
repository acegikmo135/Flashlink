import * as THREE from "three"

/** Shared, mutable scene state. Written by scroll (GSAP ScrollTrigger), read every frame by the 3D rig. */
export const S = {
  t: 0, // global scene time: scene index + local progress (0..6)
  q: [0, 0, 0, 0, 0, 0] as number[], // per-scene pinned progress (0..1)
  portrait: false,
  reduced: false,
}

/** Animated channels drawn by the boards. Computed in channels(). */
export const FX = { a: 0, b: 0, c: 0, amb: 0, led: 0, glow: 0, rev: 0, int: 1 }

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const sm = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)
export const range = (v: number, a: number, b: number) => sm(clamp((v - a) / (b - a)))

type V3 = [number, number, number]
interface Key { t: number; cam: V3; look: V3; sx: number; sy: number }

/** Hardware row: x centre, camera distance, look-at height (world units, row sits at y = ROW_Y). */
export const ROW_Y = -30
export const STOPS = [
  { x: 0, d: 8.6 },
  { x: 8.4, d: 11.2 },
  { x: 15.4, d: 7.2 },
  { x: 21.4, d: 8.4 },
]

const hw = (i: number, sx: number, sy: number, t: number): Key => ({
  t, cam: [STOPS[i].x - 0.6, ROW_Y + STOPS[i].d * 0.42, STOPS[i].d], look: [STOPS[i].x, ROW_Y, 0], sx, sy,
})

const KEYS: Key[] = [
  { t: 0, cam: [-0.2, 2.1, 5.2], look: [-1.0, 0, 0.1], sx: 0.3, sy: 0 },
  { t: 0.85, cam: [2.7, 1.5, 3.9], look: [0.7, 0, 0], sx: 0.17, sy: 0 },
  { t: 1.0, cam: [2.7, 1.5, 3.9], look: [0.7, 0, 0], sx: 0.14, sy: 0 },
  { t: 1.3, cam: [-3.3, 1.0, 3.0], look: [-1.9, 0.1, 0.2], sx: 0.14, sy: 0 },
  { t: 1.55, cam: [-0.4, 3.5, 2.7], look: [-0.9, 0, 0], sx: 0.14, sy: 0 },
  { t: 1.85, cam: [3.4, 1.7, 3.2], look: [1.4, 0, 0], sx: 0.14, sy: 0 },
  { t: 2.4, cam: [5.2, 3.6, 9.5], look: [1.0, -0.3, 0], sx: -0.34, sy: -0.2 },
  { t: 2.85, cam: [1.5, -12, 9], look: [0, -14, 0], sx: 0, sy: 0 },
  hw(0, 0, 0, 3.0),
  hw(3, 0, 0, 3.85),
  { t: 4.0, cam: [21, ROW_Y + 3, 6.5], look: [21.4, ROW_Y, 0], sx: 0.12, sy: 0 },
  { t: 4.08, cam: [-3.5, 2.1, 3.2], look: [-2.0, 0, 0.3], sx: 0.12, sy: 0 },
  { t: 4.5, cam: [-0.8, 2.9, 2.7], look: [-0.5, 0, 0], sx: 0.12, sy: 0 },
  { t: 4.85, cam: [1.8, 2.4, 2.6], look: [-0.1, 0, -0.1], sx: 0.12, sy: 0 },
  { t: 5.0, cam: [2.4, 2.2, 3.4], look: [0.4, 0, 0], sx: 0.12, sy: 0 },
  { t: 5.7, cam: [-0.2, 2.1, 5.2], look: [-1.0, 0, 0.1], sx: 0.3, sy: -0.15 },
  { t: 6, cam: [-0.2, 2.1, 5.2], look: [-1.0, 0, 0.1], sx: 0.3, sy: -0.15 },
]
// Portrait phones: the board is rolled to run top→bottom, text sits above, image is pushed down.
const PORTRAIT_SY: [number, number][] = [[0, 0.34], [0.9, 0.34], [1.0, 0.4], [2.0, 0.4], [2.4, 0.3], [2.85, 0.1], [3.0, 0.3], [3.85, 0.3], [4.0, 0.38], [5.0, 0.4], [5.7, 0.4], [6, 0.42]]

function lerpKey(t: number): Key {
  let i = 0
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++
  const a = KEYS[i], b = KEYS[i + 1]
  const u = a.t === b.t ? 1 : sm(clamp((t - a.t) / (b.t - a.t)))
  const m = (p: V3, q: V3): V3 => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]
  const cm = m(a.cam, b.cam), lk = m(a.look, b.look)
  const Z = t > 2.9 && t < 4.0 ? 1 : t < 0.9 ? 1.7 - 0.0 * sm(clamp(t / 0.9)) : 1.75 // world scale: board is ~5 units wide
  const cz: V3 = [lk[0] + (cm[0] - lk[0]) * Z, lk[1] + (cm[1] - lk[1]) * Z, lk[2] + (cm[2] - lk[2]) * Z]
  return { t, cam: cz, look: lk, sx: a.sx + (b.sx - a.sx) * u, sy: a.sy + (b.sy - a.sy) * u }
}

const stepEase = (u: number) => { const f = Math.floor(Math.min(u, 2.999)); const r = u - f; return f + sm(clamp((r - 0.22) / 0.56)) }

export function pose(t: number) {
  const k = lerpKey(t)
  if (t > 3 && t < 3.85) {
    const u = stepEase(clamp((t - 3) / 0.85) * 3)
    const i = Math.floor(u), f = u - i, A = STOPS[i], Bn = STOPS[Math.min(3, i + 1)]
    const x = A.x + (Bn.x - A.x) * f, d = A.d + (Bn.d - A.d) * f
    k.cam = [x - 0.6 + Math.sin(t * 7) * 0.0, ROW_Y + d * 0.42, d]
    k.look = [x, ROW_Y, 0]
  }
  let sy = k.sy
  if (S.portrait) {
    let j = 0
    while (j < PORTRAIT_SY.length - 2 && t > PORTRAIT_SY[j + 1][0]) j++
    const [t0, v0] = PORTRAIT_SY[j], [t1, v1] = PORTRAIT_SY[j + 1]
    sy = v0 + (v1 - v0) * sm(clamp((t - t0) / (t1 - t0)))
  }
  return { cam: k.cam, look: k.look, sx: S.portrait ? 0 : k.sx, sy }
}

/** Animated hardware channels from scene progress. `time` is seconds (for the hero's idle pulse). */
export function channels(time: number) {
  const t = S.t, q2 = S.q[1], q5 = S.q[4]
  let a = 0, b = 0, c = 0, amb = 0, led = 0, glow = 0, rev = 0, int = 1
  if (t < 1.0) {
    const cyc = (time % 8) / 8
    a = range(cyc, 0.02, 0.3) * 1.06; b = range(cyc, 0.3, 0.5) * 1.06
    amb = 0; int = 1 - range(t, 0.6, 0.95)
    if (S.reduced) { a = b = 0 }
  } else if (t < 2) {
    a = range(q2, 0.3, 0.58) * 1.06; b = range(q2, 0.6, 0.86) * 1.06
    amb = 0.55 * range(q2, 0.6, 0.86); glow = range(q2, 0.86, 1)
  } else if (t < 4) {
    a = b = 1.06; amb = 0.18; glow = 0.15
  } else if (t < 5) {
    const r = range(q5, 0.5, 0.74)
    const writing = q5 < 0.5
    if (writing) { a = range(q5, 0.04, 0.24) * 1.06; b = range(q5, 0.24, 0.46) * 1.06; amb = 0.3 * range(q5, 0.3, 0.5) }
    else { // read-back: pulse travels module → USB → cable, driven in reverse
      rev = 1; b = Math.min(1, r * 2) * 1.06; a = r > 0.5 ? (r - 0.5) * 2 * 1.06 : -1; amb = 0
    }
    c = range(q5, 0.92, 0.98) * 1.06
    led = range(q5, 0.93, 0.99); glow = 0.2 + 0.6 * range(q5, 0.9, 1)
    if (S.reduced) { led = 1; c = 1.06 }
  } else {
    a = b = c = 1.06; amb = 0.35; led = 1; glow = 0.8
  }
  FX.a = a; FX.b = b; FX.c = c; FX.amb = amb; FX.led = led; FX.glow = glow; FX.rev = rev; FX.int = int
}
