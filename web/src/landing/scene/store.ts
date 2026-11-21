import * as THREE from "three"

/** Shared, mutable scene state. Written by scroll (GSAP ScrollTrigger), read every frame by the 3D rig. */
export const S = {
  t: 0, // global scene time: scene index + local progress (0..6)
  q: [0, 0, 0, 0, 0, 0] as number[], // per-scene pinned progress (0..1)
  portrait: false,
  reduced: false,
  intro: 0, // 0→1 hero camera dolly-in after first frame
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
  { x: 0, d: 8.8 },
  { x: 8.4, d: 15.5 },
  { x: 15.4, d: 8.4 },
  { x: 21.4, d: 9.8 },
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
  { t: 5.0, cam: [-0.2, 2.1, 5.2], look: [-1.0, 0, 0.1], sx: 0.3, sy: -0.15 },
  { t: 6, cam: [-0.2, 2.1, 5.2], look: [-1.0, 0, 0.1], sx: 0.3, sy: -0.15 },
]
// Portrait phones: the board is rolled to run top→bottom, text sits above, image is pushed down.
const PORTRAIT_SY: [number, number][] = [[0, 0.24], [0.9, 0.24], [1.0, 0.26], [2.0, 0.26], [2.4, 0.2], [2.85, 0.1], [3.0, 0.24], [3.85, 0.24], [4.0, 0.26], [5.0, 0.26], [5.7, 0.3], [6, 0.32]]

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

/* Portrait phones: board runs top→bottom (camera roll), seen from above/in front; USB sits at the bottom. [t, lookX, D, lookZ] */
const PK: [number, number, number, number][] = [
  [0, -0.5, 22, 0], [0.85, -1.0, 19, 0], [1.0, -0.6, 21, 0],
  [1.3, -0.6, 20, 0], [1.5, -2.4, 14, 0], [1.7, -1.2, 15.5, 0], [1.9, 0.6, 17, 0],
  [2.4, 0.4, 24, 0], [2.85, 0, 20, 0],
]
const P_HW = [18, 26, 17, 20]
const PK2: [number, number, number, number][] = [
  [4.0, -1.5, 18, 0], [4.12, -2.4, 14, 0], [4.4, -1.4, 15, 0], [4.7, 0.4, 16, 0], [4.85, -0.6, 13, 0.5], [5.0, -0.9, 22, 0], [6, -0.9, 22, 0],
]
const PN = new THREE.Vector3(-0.28, 0.84, 0.46).normalize()
function portraitPose(t: number) {
  let lx: number, D: number, lz: number, ly = 0
  if (t >= 3 && t <= 3.85) {
    const u = stepEase(clamp((t - 3) / 0.85) * 3), i = Math.floor(u), f = u - i, A = STOPS[i], B = STOPS[Math.min(3, i + 1)]
    lx = A.x + (B.x - A.x) * f; D = P_HW[i] + (P_HW[Math.min(3, i + 1)] - P_HW[i]) * f; lz = 0; ly = ROW_Y
  } else {
    const arr = t < 3 ? PK : PK2
    let j = 0
    while (j < arr.length - 2 && t > arr[j + 1][0]) j++
    const a = arr[j], b = arr[j + 1], u = sm(clamp((t - a[0]) / (b[0] - a[0])))
    lx = a[1] + (b[1] - a[1]) * u; D = a[2] + (b[2] - a[2]) * u; lz = a[3] + (b[3] - a[3]) * u
    if (t > 2.3 && t < 3) { ly = -14 * sm(clamp((t - 2.5) / 0.35)) }
    else if (t >= 3.85 && t < 4.0) { const u2 = sm(clamp((t - 3.85) / 0.15)); lx = STOPS[3].x + (a[1] - STOPS[3].x) * u2; ly = ROW_Y * (1 - u2); D = P_HW[3] + (D - P_HW[3]) * u2 }
  }
  const look: V3 = [lx, ly, lz]
  const cam: V3 = [lx + PN.x * D, ly + PN.y * D, lz + PN.z * D]
  return { cam, look }
}

export function pose(t: number) {
  if (S.portrait) {
    const pp = portraitPose(t)
    let j = 0
    while (j < PORTRAIT_SY.length - 2 && t > PORTRAIT_SY[j + 1][0]) j++
    const [t0, v0] = PORTRAIT_SY[j], [t1, v1] = PORTRAIT_SY[j + 1]
    return { cam: pp.cam, look: pp.look, sx: 0, sy: v0 + (v1 - v0) * sm(clamp((t - t0) / (t1 - t0))) }
  }
  const k = lerpKey(t)
  if (t > 3 && t < 3.85) {
    const u = stepEase(clamp((t - 3) / 0.85) * 3)
    const i = Math.floor(u), f = u - i, A = STOPS[i], Bn = STOPS[Math.min(3, i + 1)]
    const x = A.x + (Bn.x - A.x) * f, d = A.d + (Bn.d - A.d) * f
    k.cam = [x - 0.6, ROW_Y + d * 0.42, d]
    k.look = [x, ROW_Y, 0]
  }
  return { cam: k.cam, look: k.look, sx: k.sx, sy: k.sy }
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
