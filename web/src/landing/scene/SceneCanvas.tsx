import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { BluePillBoard, Esp32Board, NanoBoard, UnoBoard } from "./boards"
import { FX, ROW_Y, S, STOPS, channels, pose } from "./store"

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = tex
    scene.environmentIntensity = 0.6
    return () => { scene.environment = null; tex.dispose(); pm.dispose() }
  }, [gl, scene])
  return null
}

function Rig() {
  const { camera, size, invalidate } = useThree()
  const cam = useRef(new THREE.Vector3(-0.2, 2.1, 5.2))
  const look = useRef(new THREE.Vector3(-1, 0, 0.1))
  const sh = useRef({ x: 0.17, y: 0 })
  const roll = useRef(0)
  const first = useRef(true)
  const rimA = useRef<THREE.DirectionalLight>(null)
  const rimB = useRef<THREE.DirectionalLight>(null)
  const clock = useRef(0)
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    clock.current += dt
    channels(clock.current)
    const p = pose(S.t)
    const aspect = size.width / size.height
    S.portrait = aspect < 0.9
    const k = S.portrait ? 1 : aspect < 1.4 ? 1 + (1.4 - aspect) * 0.5 : 1
    const L = new THREE.Vector3(...p.look)
    const C = new THREE.Vector3(...p.cam).sub(L).multiplyScalar(k).add(L)
    const f = first.current ? 1 : 1 - Math.exp(-dt * (S.reduced ? 60 : 5.5))
    first.current = false
    cam.current.lerp(C, f); look.current.lerp(L, f)
    sh.current.x += (p.sx - sh.current.x) * f; sh.current.y += (p.sy - sh.current.y) * f
    roll.current += ((S.portrait ? -Math.PI / 2 : 0) - roll.current) * f
    const pc = camera as THREE.PerspectiveCamera
    pc.position.copy(cam.current)
    pc.up.set(Math.sin(-roll.current), Math.cos(roll.current), 0)
    pc.lookAt(look.current)
    pc.fov = S.portrait ? 30 : 30
    pc.setViewOffset(size.width, size.height, -sh.current.x * size.width, -sh.current.y * size.height, size.width, size.height)
    pc.updateProjectionMatrix()
    // blue grazing light follows signal activity
    const act = Math.max(0.35, FX.glow, FX.a > 0 && FX.a < 1.05 ? 0.9 : 0, FX.b > 0 && FX.b < 1.05 ? 0.9 : 0)
    if (rimA.current) rimA.current.intensity = 1.1 + act * 2.4
    if (rimB.current) rimB.current.intensity = 0.6 + act * 1.2
    if (S.reduced) invalidate()
  })
  return null
}

export default function SceneCanvas({ onReady }: { onReady: () => void }) {
  const low = useMemo(() => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4, [])
  return (
    <Canvas
      className="lp-canvas"
      dpr={low ? [1, 1.4] : [1, 1.8]}
      gl={{ antialias: !low, alpha: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 30, near: 0.1, far: 400, position: [-0.2, 2.1, 5.2] }}
      onCreated={() => requestAnimationFrame(() => onReady())}
      frameloop={S.reduced ? "demand" : "always"}
    >
      <Env />
      <Rig />
      <ambientLight intensity={0.12} />
      <directionalLight position={[3, 6, 4]} intensity={1.9} color="#f4f6fb" />
      <directionalLight position={[-6, 3, 5]} intensity={0.7} color="#cfd9ee" />
      <directionalLight position={[-5, 1.2, -4]} intensity={2.2} color="#3185ff" />
      <directionalLight position={[6, 1, -3]} intensity={0.9} color="#7fb0ff" />
      <Hero />
      <Shelf />
    </Canvas>
  )
}

function Hero() { return <group><Esp32Board live /></group> }

function Shelf() {
  const g = useRef<THREE.Group>(null)
  useFrame(() => { if (g.current) g.current.visible = S.t > 2.3 && S.t < 4.35 })
  return (
    <group ref={g} position={[0, ROW_Y, 0]} visible={false}>
      <group position={[STOPS[0].x, 0, 0]} rotation={[0, -0.28, 0]}><Esp32Board live={false} /></group>
      <group position={[STOPS[1].x, 0, 0]} rotation={[0, -0.28, 0]}><UnoBoard /></group>
      <group position={[STOPS[2].x, 0, 0]} rotation={[0, -0.28, 0]}><NanoBoard /></group>
      <group position={[STOPS[3].x, 0, 0]} rotation={[0, -0.28, 0]}><BluePillBoard /></group>
    </group>
  )
}
