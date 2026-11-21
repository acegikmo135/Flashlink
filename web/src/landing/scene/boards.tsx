import { useFrame } from "@react-three/fiber"
import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { FX } from "./store"

/* All board geometry is authored in millimetres (board centre = origin, PCB top face at y = TOP) and the
   group is scaled by 0.1 so 1 world unit = 10 mm. Dimensions follow the real boards; fine detail is simplified. */
const TOP = 0.8
const GOLD = "#f0c878"
const BLUE = "#3185ff"

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas")
  cv.width = w; cv.height = h
  const ctx = cv.getContext("2d")!
  draw(ctx)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

type BxProps = { p: [number, number]; s: [number, number, number]; yb?: number; c?: string; m?: number; r?: number; e?: string; ei?: number; rotY?: number; name?: string }
function Bx({ p, s, yb = 0, c = "#0b0c0e", m = 0, r = 0.55, e, ei = 0, rotY = 0 }: BxProps) {
  return (
    <mesh position={[p[0], TOP + yb + s[1] / 2, p[1]]} rotation={[0, rotY, 0]}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} metalness={m} roughness={r} emissive={e ?? "#000"} emissiveIntensity={ei} />
    </mesh>
  )
}
function Cyl({ p, r, h, yb = 0, c = "#111", m = 0, rough = 0.5 }: { p: [number, number]; r: number; h: number; yb?: number; c?: string; m?: number; rough?: number }) {
  return (
    <mesh position={[p[0], TOP + yb + h / 2, p[1]]}>
      <cylinderGeometry args={[r, r, h, 28]} />
      <meshStandardMaterial color={c} metalness={m} roughness={rough} />
    </mesh>
  )
}

function Pcb({ w, d, color, holes = [], rad = 1.6 }: { w: number; d: number; color: string; holes?: [number, number][]; rad?: number }) {
  const geo = useMemo(() => {
    const sh = new THREE.Shape()
    const x = -w / 2, y = -d / 2
    sh.moveTo(x + rad, y); sh.lineTo(x + w - rad, y); sh.quadraticCurveTo(x + w, y, x + w, y + rad)
    sh.lineTo(x + w, y + d - rad); sh.quadraticCurveTo(x + w, y + d, x + w - rad, y + d)
    sh.lineTo(x + rad, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - rad)
    sh.lineTo(x, y + rad); sh.quadraticCurveTo(x, y, x + rad, y)
    holes.forEach(([hx, hz]) => { const h = new THREE.Path(); h.absarc(hx, -hz, 1.6, 0, Math.PI * 2, true); sh.holes.push(h) })
    const g = new THREE.ExtrudeGeometry(sh, { depth: TOP * 2, bevelEnabled: false, curveSegments: 10 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, -TOP, 0)
    return g
  }, [w, d, rad, holes])
  return (
    <mesh geometry={geo}>
      <meshPhysicalMaterial color={color} roughness={0.42} metalness={0.05} clearcoat={0.35} clearcoatRoughness={0.4} />
    </mesh>
  )
}

type Label = { x: number; z: number; t: string; size?: number; rot?: number; align?: CanvasTextAlign; col?: string }
function Silk({ w, d, labels, extra }: { w: number; d: number; labels: Label[]; extra?: (c: CanvasRenderingContext2D, px: (v: number) => number, X: (x: number) => number, Z: (z: number) => number) => void }) {
  const tex = useMemo(() => {
    const k = 26
    return canvasTex(Math.round(w * k), Math.round(d * k), (c) => {
      const X = (x: number) => (x + w / 2) * k, Z = (z: number) => (z + d / 2) * k
      extra?.(c, (v) => v * k, X, Z)
      labels.forEach((l) => {
        c.save(); c.translate(X(l.x), Z(l.z)); c.rotate(l.rot ?? 0)
        c.fillStyle = l.col ?? "rgba(236,238,242,0.88)"; c.font = `500 ${(l.size ?? 1.5) * k}px "Geist Mono Variable", ui-monospace, monospace`
        c.textAlign = l.align ?? "center"; c.textBaseline = "middle"; c.fillText(l.t, 0, 0); c.restore()
      })
    })
  }, [w, d, labels, extra])
  return (
    <mesh position={[0, TOP + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial map={tex} transparent roughness={0.7} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  )
}

function Tips({ pts, c = GOLD, h = 1.9, s = 0.46 }: { pts: [number, number][]; c?: string; h?: number; s?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    pts.forEach(([x, z], i) => { m.setPosition(x, TOP + h / 2, z); ref.current!.setMatrixAt(i, m) })
    ref.current!.instanceMatrix.needsUpdate = true
  }, [pts, h])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pts.length]}>
      <boxGeometry args={[s, h, s]} />
      <meshStandardMaterial color={c} metalness={1} roughness={0.18} envMapIntensity={1.6} />
    </instancedMesh>
  )
}

const row = (n: number, z: number, cx = 0, pitch = 2.54): [number, number][] => Array.from({ length: n }, (_, i) => [cx + (i - (n - 1) / 2) * pitch, z])

/* ---------- glow sprite ---------- */
let glowTex: THREE.Texture | null = null
function getGlow() {
  if (!glowTex) glowTex = canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, "rgba(120,180,255,1)"); g.addColorStop(0.25, "rgba(49,133,255,0.55)"); g.addColorStop(1, "rgba(49,133,255,0)")
    c.fillStyle = g; c.fillRect(0, 0, 128, 128)
  })
  return glowTex
}

/* ---------- signal ribbons (traces / cable) ---------- */
const sigMat = (rev: boolean) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uHead: { value: 0 }, uAmb: { value: 0 }, uInt: { value: 1 }, uRev: { value: rev ? 1 : 0 }, uCol: { value: new THREE.Color(BLUE) } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `varying vec2 vUv; uniform float uHead,uAmb,uInt,uRev; uniform vec3 uCol;
    void main(){ float x = mix(vUv.x, 1.0 - vUv.x, uRev); float d = uHead - x;
      float pulse = exp(-pow(abs(d) / 0.03, 2.0)) * step(-0.12, d);
      float tail = d > 0.0 ? 0.55 * exp(-d * 11.0) : 0.0;
      float held = (d > 0.0 && uHead > 1.0) ? uAmb : 0.0;
      float lit = (pulse + tail + held) * uInt * step(-0.5, uHead);
      gl_FragColor = vec4(uCol * lit * 1.6, clamp(lit, 0.0, 1.0)); }`,
})

function Ribbon({ curve, radius, ch, rev, segs = 220, glow = 6 }: { curve: THREE.Curve<THREE.Vector3>; radius: number; ch: "a" | "b" | "c"; rev?: boolean; segs?: number; glow?: number }) {
  const mat = useMemo(() => sigMat(!!rev), [rev])
  const geo = useMemo(() => new THREE.TubeGeometry(curve, segs, radius, 5, false), [curve, segs, radius])
  const spr = useRef<THREE.Sprite>(null)
  useFrame(() => {
    const head = FX[ch]
    mat.uniforms.uHead.value = head; mat.uniforms.uAmb.value = FX.amb; mat.uniforms.uInt.value = FX.int; mat.uniforms.uRev.value = FX.rev && ch !== "c" ? 1 : 0
    const s = spr.current
    if (s) {
      const u = FX.rev && ch !== "c" ? 1 - head : head
      const on = head > 0 && head <= 1.04 && FX.int > 0.02
      s.visible = on
      if (on) { const p = curve.getPointAt(Math.min(1, Math.max(0, u))); s.position.copy(p) }
    }
  })
  return (
    <>
      <mesh geometry={geo} material={mat} renderOrder={5} />
      <sprite ref={spr} scale={[glow, glow, 1]} renderOrder={6}>
        <spriteMaterial map={getGlow()} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.9} />
      </sprite>
    </>
  )
}

const poly = (pts: [number, number, number][]) => {
  const cp = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) cp.add(new THREE.LineCurve3(new THREE.Vector3(...pts[i]), new THREE.Vector3(...pts[i + 1])))
  return cp
}

/* ---------- LED ---------- */
function Led({ p, off = "#1b2f55", on = BLUE, drive, lit = false }: { p: [number, number]; off?: string; on?: string; drive?: () => number; lit?: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const spr = useRef<THREE.Sprite>(null)
  const light = useRef<THREE.PointLight>(null)
  useFrame(() => {
    const v = drive ? drive() : 0
    if (mat.current) { mat.current.emissiveIntensity = 0.15 + v * 5; mat.current.emissive.set(v > 0.02 ? on : off) }
    if (spr.current) { spr.current.visible = v > 0.02; spr.current.scale.setScalar(5 + v * 9); (spr.current.material as THREE.SpriteMaterial).opacity = v }
    if (light.current) light.current.intensity = lit ? v * 900 : 0
  })
  return (
    <group position={[p[0], TOP, p[1]]}>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[2, 0.7, 1.1]} />
        <meshStandardMaterial ref={mat} color="#23324f" roughness={0.25} emissive={off} emissiveIntensity={0.15} />
      </mesh>
      <sprite ref={spr} position={[0, 1.2, 0]} visible={false}>
        <spriteMaterial map={getGlow()} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight ref={light} position={[0, 3, 0]} color={on} distance={60} decay={2} intensity={0} />
    </group>
  )
}

/* ---------- small SMD scatter ---------- */
function Smd({ pts, s = [1.6, 0.6, 0.8], c = "#8a7a5c", m = 0.3 }: { pts: [number, number, number?][]; s?: [number, number, number]; c?: string; m?: number }) {
  return <>{pts.map(([x, z, r], i) => <Bx key={i} p={[x, z]} s={s} c={c} m={m} r={0.5} rotY={r ?? 0} />)}</>
}

/* ============================ ESP32 DevKit ============================ */
const ESP_L = ["EN", "VP", "VN", "34", "35", "32", "33", "25", "26", "27", "14", "12", "13", "GND", "VIN"]
const ESP_R = ["23", "22", "TX0", "RX0", "21", "19", "18", "5", "TX2", "RX2", "4", "2", "15", "GND", "3V3"]
const espLabels: Label[] = [
  ...ESP_L.map((t, i) => ({ x: 17.0 - i * 2.54 - 1.6, z: -8.7, t, size: 1.15, rot: -Math.PI / 2, align: "left" as const })),
  ...ESP_R.map((t, i) => ({ x: 17.0 - i * 2.54 - 1.6, z: 8.7, t, size: 1.15, rot: -Math.PI / 2, align: "right" as const })),
  { x: -21.6, z: -5.6, t: "BOOT", size: 1.2 }, { x: -21.6, z: 5.6, t: "EN", size: 1.2 },
  { x: -11, z: 0, t: "ESP32 DEVKIT", size: 1.5, col: "rgba(236,238,242,0.55)" },
]

export function Esp32Board({ live = true }: { live?: boolean }) {
  const traceB = useMemo(() => poly([[-21.4, TOP + 0.9, 0], [-18.5, TOP + 0.9, 0], [-16.4, TOP + 0.9, -2.4], [-10, TOP + 0.9, -2.4], [-6, TOP + 0.9, -5.2], [-2, TOP + 0.9, -5.2], [0.4, TOP + 0.9, -3.8]]), [])
  const traceC = useMemo(() => poly([[0.4, TOP + 0.9, 4.0], [-3, TOP + 0.9, 4.0], [-3, TOP + 0.9, 5.4], [-5.6, TOP + 0.9, 5.4]]), [])
  const cable = useMemo(() => {
    const y = TOP + 1.4
    return new THREE.CatmullRomCurve3([[-110, 42, -34], [-82, 22, -22], [-60, 9, -9], [-46, 3.5, -2.5], [-38.5, y + 0.3, -0.4], [-35.4, y, 0]].map((p) => new THREE.Vector3(...p)), false, "centripetal")
  }, [])
  const cableGeo = useMemo(() => new THREE.TubeGeometry(cable, 160, 1.5, 10, false), [cable])
  const silk = useMemo(() => espLabels, [])
  const shield = useMemo(() => canvasTex(1024, 920, (c) => {
    c.fillStyle = "#b8bcc4"; c.fillRect(0, 0, 1024, 920)
    for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.035)`; c.fillRect(Math.random() * 1024, Math.random() * 920, 1, 24) }
    c.fillStyle = "rgba(25,28,34,0.82)"; c.textAlign = "center"; c.textBaseline = "middle"
    c.font = "700 76px 'Geist Variable', sans-serif"; c.fillText("ESP32-WROOM-32", 512, 330)
    c.font = "500 44px 'Geist Mono Variable', monospace"; c.fillText("Espressif Systems", 512, 440)
    c.font = "500 36px 'Geist Mono Variable', monospace"; c.fillText("CE   FCC   IC", 512, 540)
  }), [])
  const ant = useMemo(() => canvasTex(512, 1024, (c) => {
    c.fillStyle = "#0c0d10"; c.fillRect(0, 0, 512, 1024)
    c.strokeStyle = "#caa95a"; c.lineWidth = 16; c.lineJoin = "miter"; c.beginPath()
    c.moveTo(430, 1000); c.lineTo(430, 840)
    for (let i = 0; i < 7; i++) { const y = 840 - i * 110; c.lineTo(i % 2 ? 90 : 430, y); c.lineTo(i % 2 ? 90 : 430, y - 110) }
    c.stroke()
  }), [])
  const pads = useMemo(() => [...Array.from({ length: 14 }, (_, i): [number, number] => [1.5 + i * 1.27, -9.2]), ...Array.from({ length: 14 }, (_, i): [number, number] => [1.5 + i * 1.27, 9.2])], [])
  return (
    <group scale={0.1}>
      <Pcb w={51.5} d={28.3} color="#10141b" />
      <Silk w={51.5} d={28.3} labels={silk} />
      <Tips pts={[...row(15, -11.43, -1.7), ...row(15, 11.43, -1.7)]} />
      {/* RF module */}
      <Bx p={[13, 0]} s={[25.5, 0.9, 18]} c="#0a0a0c" />
      <mesh position={[9.9, TOP + 0.9 + 1.2, 0]}>
        <boxGeometry args={[19.3, 2.4, 18]} />
        <meshStandardMaterial color="#c9ced6" metalness={1} roughness={0.28} />
      </mesh>
      <mesh position={[9.9, TOP + 0.9 + 2.41, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18.6, 17.3]} />
        <meshStandardMaterial map={shield} metalness={0.9} roughness={0.32} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh position={[22.65, TOP + 0.92, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <planeGeometry args={[18, 6.2]} />
        <meshStandardMaterial map={ant} roughness={0.5} metalness={0.4} />
      </mesh>
      <Tips pts={pads} s={0.5} h={0.8} />
      {/* USB micro-B receptacle */}
      <mesh position={[-23.9, TOP + 1.3, 0]}>
        <boxGeometry args={[5.6, 2.6, 7.5]} />
        <meshStandardMaterial color="#d3d7de" metalness={1} roughness={0.25} />
      </mesh>
      <mesh position={[-26.8, TOP + 1.3, 0]}><boxGeometry args={[0.4, 1.4, 5.6]} /><meshStandardMaterial color="#050506" roughness={0.9} /></mesh>
      {/* ICs & passives */}
      <Bx p={[-15, -0.4]} s={[5, 0.9, 5]} c="#0a0a0b" r={0.4} />
      <Bx p={[-12, 6.6]} s={[6.5, 1.8, 3.5]} c="#0a0a0b" r={0.4} />
      <Bx p={[-9.2, 6.6]} s={[3.2, 0.3, 3.4]} c="#b9bec7" m={1} r={0.3} />
      <Bx p={[-21.2, -9.3]} s={[6, 0.4, 3.6]} c="#c3c7ce" m={1} r={0.3} /><Cyl p={[-21.2, -9.3]} r={1.2} h={1.6} yb={0.4} c="#101114" />
      <Bx p={[-21.2, 9.3]} s={[6, 0.4, 3.6]} c="#c3c7ce" m={1} r={0.3} /><Cyl p={[-21.2, 9.3]} r={1.2} h={1.6} yb={0.4} c="#101114" />
      <Smd pts={[[-18.6, -3.7], [-18.6, 3.2], [-14.2, 4.6], [-12.4, -4.6], [-8.2, -2.4], [-5.2, 1.5], [-9.4, 2.4], [-3.6, -1.6, 0.0], [-2.4, 1.8], [-16.6, 5.4], [-7.4, -6.7]]} />
      <Smd pts={[[-4.6, 7], [-1.4, -7.2], [-17.6, -7], [-10.8, -7.4]]} s={[1.0, 0.5, 0.5]} c="#0c0c0e" m={0} />
      <Led p={[-9, -6.2]} off="#4a1612" on="#ff4b3a" drive={() => 0.12} />
      <Led p={[-6, 5.6]} drive={() => FX.led} lit />
      {live && (
        <>
          <Ribbon curve={traceB} radius={0.42} ch="b" segs={160} glow={9} />
          <Ribbon curve={traceC} radius={0.42} ch="c" segs={80} glow={9} />
          {/* USB cable + plug */}
          <mesh position={[-30.2, TOP + 1.3, 0]}><boxGeometry args={[7.2, 3.2, 9]} /><meshStandardMaterial color="#cfd3da" metalness={1} roughness={0.3} /></mesh>
          <mesh position={[-37.4, TOP + 1.3, 0]}><boxGeometry args={[10, 5.6, 9.4]} /><meshStandardMaterial color="#0c0d10" roughness={0.5} /></mesh>
          <mesh geometry={cableGeo}><meshStandardMaterial color="#0d0e11" roughness={0.6} /></mesh>
          <Ribbon curve={cable} radius={1.58} ch="a" segs={200} glow={16} />
        </>
      )}
    </group>
  )
}

/* ============================ Arduino Uno ============================ */
const unoLabels: Label[] = [
  { x: 8, z: -1.5, t: "ARDUINO UNO", size: 3.2 }, { x: 8, z: 3.2, t: "ATmega328P", size: 1.6, col: "rgba(236,238,242,0.5)" },
  { x: 18.2, z: -20.6, t: "DIGITAL (PWM ~)", size: 1.1 }, { x: 2.2, z: 20.8, t: "POWER", size: 1.1 }, { x: 22.6, z: 20.8, t: "ANALOG IN", size: 1.1 },
]
export function UnoBoard() {
  const holes = useMemo<[number, number][]>(() => [[-20.3, -24.15], [-19, 24.05], [31.8, -19.05], [31.8, 8.85]], [])
  return (
    <group scale={0.1}>
      <Pcb w={68.6} d={53.3} color="#082432" holes={holes} />
      <Silk w={68.6} d={53.3} labels={unoLabels} />
      <mesh position={[-32.3, TOP + 5.7, -12]}><boxGeometry args={[16, 11.4, 12]} /><meshStandardMaterial color="#c8ccd3" metalness={1} roughness={0.3} /></mesh>
      <Bx p={[-31.3, 16]} s={[14, 11, 9]} c="#0a0a0b" r={0.6} />
      <Bx p={[6, 10]} s={[35, 3.4, 7.6]} c="#0a0a0b" r={0.4} />
      <Cyl p={[-8, 10]} r={0.8} h={0.1} yb={3.4} c="#232428" />
      <Bx p={[-14, -9]} s={[11, 3.6, 4.5]} c="#c9cdd4" m={1} r={0.3} />
      <Bx p={[-23, -3]} s={[5, 0.9, 5]} c="#0a0a0b" r={0.4} />
      <Cyl p={[-22.5, 18]} r={3.2} h={5.5} c="#9aa0aa" m={1} rough={0.35} /><Cyl p={[-14.5, 18.4]} r={3.2} h={5.5} c="#9aa0aa" m={1} rough={0.35} />
      <Bx p={[-27, -21]} s={[6, 3.5, 6]} c="#b4b8c0" m={1} r={0.3} /><Cyl p={[-27, -21]} r={1.8} h={1.5} yb={3.5} c="#1a1b1e" />
      <Bx p={[-4, 22]} s={[6.5, 2, 3.5]} c="#0a0a0b" />
      {[[18.2, 10], [-6.4, 8], [2.25, 8], [22.6, 6]].map(([cx, n], i) => {
        const z = i < 2 ? -24.1 : 24.1
        return <group key={i}><Bx p={[cx, z]} s={[n * 2.54, 8.5, 2.54]} c="#0a0a0b" r={0.7} /><Tips pts={row(n, z, cx).map(([x, zz]) => [x, zz])} h={0.2} s={1.5} c="#000" /></group>
      })}
      <Bx p={[30, 0]} s={[7.6, 2.5, 5.1]} c="#0a0a0b" />
      <Tips pts={[...row(3, -1.27, 30).map(([x, z]) => [x, z] as [number, number]), ...row(3, 1.27, 30)]} h={4} />
      <Led p={[-4, -8]} off="#173b2a" on="#53ff9a" drive={() => 0} /><Led p={[-4, -5]} off="#4a1612" on="#ff4b3a" drive={() => 0.1} />
    </group>
  )
}

/* ============================ Arduino Nano ============================ */
export function NanoBoard() {
  const labels = useMemo<Label[]>(() => [{ x: 7, z: -3.1, t: "NANO", size: 2.4 }, { x: 7, z: 3.5, t: "V3.0", size: 1.2, col: "rgba(236,238,242,0.5)" }], [])
  return (
    <group scale={0.1}>
      <Pcb w={45} d={18} color="#081c3d" rad={1.2} />
      <Silk w={45} d={18} labels={labels} />
      <Tips pts={[...row(15, -7.62, 1.2), ...row(15, 7.62, 1.2)]} />
      <Tips pts={[...row(3, -1.27, 19.9).map(([x, z]) => [x, z] as [number, number]), ...row(3, 1.27, 19.9)]} h={1.6} s={0.6} />
      <mesh position={[-19.2, TOP + 2, 0]}><boxGeometry args={[8, 4, 7.6]} /><meshStandardMaterial color="#cfd3da" metalness={1} roughness={0.3} /></mesh>
      <Bx p={[6.5, 0]} s={[7, 1, 7]} c="#0a0a0b" r={0.4} /><Bx p={[-6.5, 0]} s={[10, 1.5, 4]} c="#0a0a0b" r={0.4} />
      <Bx p={[-1.5, 5.4]} s={[3.2, 0.9, 2.5]} c="#b9bec7" m={1} r={0.3} />
      <Bx p={[-12.5, 5]} s={[3.6, 1.4, 3.2]} c="#b4b8c0" m={1} r={0.3} />
      <Led p={[-4, -3.2]} off="#173b2a" on="#53ff9a" drive={() => 0} /><Led p={[-1.2, -3.2]} off="#4a1612" on="#ff4b3a" drive={() => 0.1} />
      <Smd pts={[[-10.5, -4.4], [-1, 3.2], [2.4, -4.4], [12, 4.6], [14.6, -4.6]]} s={[1.4, 0.5, 0.7]} />
    </group>
  )
}

/* ============================ STM32 Blue Pill ============================ */
export function BluePillBoard() {
  const labels = useMemo<Label[]>(() => [{ x: 4, z: -4.8, t: "STM32F103C8T6", size: 1.4, col: "rgba(236,238,242,0.55)" }, { x: 4, z: 5.4, t: "BLUE PILL", size: 1.8 }], [])
  return (
    <group scale={0.1}>
      <Pcb w={53} d={22.8} color="#0b2260" rad={1.4} />
      <Silk w={53} d={22.8} labels={labels} />
      <Tips pts={[...row(20, -10.16), ...row(20, 10.16)]} />
      <Tips pts={row(4, 0, 24.6).map(([x, z]) => [x, z] as [number, number])} />
      <mesh position={[-24.3, TOP + 1.3, 0]}><boxGeometry args={[5.6, 2.6, 7.5]} /><meshStandardMaterial color="#d3d7de" metalness={1} roughness={0.25} /></mesh>
      <Bx p={[3.5, 0]} s={[7, 1.4, 7]} c="#0a0a0b" r={0.4} />
      <Bx p={[-9, -1]} s={[4.9, 1.8, 3.6]} c="#c3c7ce" m={1} r={0.3} />
      <Cyl p={[-4.8, 5.8]} r={0.8} h={3} c="#c3c7ce" m={1} rough={0.3} />
      <Bx p={[-17.5, 7.4]} s={[3.4, 1.8, 3.4]} c="#b4b8c0" m={1} r={0.3} />
      <Bx p={[13.5, 0]} s={[6.2, 6, 2.6]} yb={0} c="#0a0a0b" />
      <Bx p={[13.5, -1.27]} s={[1.9, 5.8, 2]} yb={0} c="#9a8330" r={0.6} /><Bx p={[16.0, -1.27]} s={[1.9, 5.8, 2]} yb={0} c="#9a8330" r={0.6} />
      <Led p={[-11, -7.8]} off="#4a1612" on="#ff4b3a" drive={() => 0.1} /><Led p={[-3, 8.8]} off="#173b2a" on="#53ff9a" drive={() => 0} />
      <Smd pts={[[-13, 2], [-7, 4.6], [-1.2, -5.2], [9.6, 5.2], [10.8, -6.6]]} s={[1.4, 0.5, 0.7]} />
    </group>
  )
}
