import { memo, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import * as THREE from 'three'
import { fmt, pct, tempColor, ZONE_LAYOUT, zoneName } from '../console/presentation'
import RoomArchitecture, { Block, Blocks, Cable, Sign } from './RoomArchitecture'
import { getMeshPerforatedTexture } from './textures'

// Two display cabinets per zone, not ten independent simulated racks.
// All readings and actuators retain the five canonical backend IDs.
const ROOM_ZONES = ZONE_LAYOUT.map((zone, i) => ({ ...zone, position: [(-3.8 + (i % 3) * 3), 0, i < 3 ? -2.6 : 1.6] }))
const instanceTransform = new THREE.Object3D()
const packetPosition = new THREE.Vector3()
const CABLE_COLORS = ['#1876df', '#238edb', '#efae2b', '#e47531', '#35adb5']
const SERVER_ROWS = Array.from({ length: 18 }, (_, i) => [0, .3 + i * .119, .607])
const DRIVE_BAYS = Array.from({ length: 18 * 4 }, (_, i) => [-.27 + (i % 4) * .153, .3 + Math.floor(i / 4) * .119, .636])
const DRIVE_HANDLES = DRIVE_BAYS.map(([x, y, z]) => [x + .045, y, z + .01])
const LED_POSITIONS = Array.from({ length: 18 * 2 }, (_, i) => [.322 + (i % 2) * .028, .3 + Math.floor(i / 2) * .119, .65])
const DOOR_RAILS = [-.424, .424].map((x) => [x, 1.34, .68])

// Bake the static cabinet contact shadow once, not on every telemetry frame.
const GroundShadow = memo(function GroundShadow() {
  return <ContactShadows position={[0, .035, .5]} opacity={.35} scale={[14, 12]} blur={2.6} far={3.2} resolution={512} color="#112536" frames={1} />
})

function StudioReflections() {
  const getThree = useThree((state) => state.get)
  useEffect(() => {
    const { gl, scene } = getThree()
    // Locally generated soft-box reflections: no HDR download or runtime network dependency.
    const generator = new THREE.PMREMGenerator(gl)
    const studio = new RoomEnvironment()
    const target = generator.fromScene(studio, .04)
    const previous = scene.environment
    scene.environment = target.texture; scene.environmentIntensity = .38
    studio.dispose(); generator.dispose()
    return () => { scene.environment = previous; target.dispose() }
  }, [getThree])
  return null
}

function Cabinet({ offset, zone, data, color, selected, reduceMotion }) {
  const statusMaterial = useRef()
  const meshTexture = useMemo(() => getMeshPerforatedTexture(), [])
  useEffect(() => () => meshTexture.dispose(), [meshTexture])
  useFrame(({ clock }) => {
    if (statusMaterial.current) statusMaterial.current.emissiveIntensity = reduceMotion ? .65 : .5 + (data?.utilization || 0) * (.7 + Math.sin(clock.elapsedTime * 3 + offset * 3) * .3)
  })
  return <group position={[offset, 0, 0]}>
    <Block position={[0, .07, 0]} size={[.95, .14, 1.3]} color="#172432" castShadow />
    <Block position={[0, 1.35, 0]} size={[.9, 2.55, 1.2]} color="#14212d" metalness={.68} roughness={.31} castShadow />
    <mesh position={[0, 1.34, .611]}><planeGeometry args={[.79, 2.32]} /><meshStandardMaterial map={meshTexture} color="#acb5bf" roughness={.5} metalness={.5} /></mesh>
    <Blocks positions={SERVER_ROWS} size={[.77, .104, .045]} color="#344957" metalness={.7} />
    <Blocks positions={DRIVE_BAYS} size={[.13, .062, .024]} color="#101a23" />
    <Blocks positions={DRIVE_HANDLES} size={[.025, .04, .017]} color="#617986" />
    <Blocks positions={LED_POSITIONS} size={[.012, .009, .014]} color={Number.isFinite(data?.utilization) ? '#50dfd3' : '#4f6370'} emissive="#20c9c0" intensity={Number.isFinite(data?.utilization) ? .6 + data.utilization * .6 : 0} />
    <Blocks positions={DOOR_RAILS} size={[.045, 2.43, .055]} color="#586e7c" metalness={.82} />
    <Block position={[0, 2.51, .664]} size={[.87, .115, .075]} color="#233b51" />
    <Sign text={`${zone.letter} / ${offset < 0 ? '01' : '02'}`} position={[-.18, 2.515, .705]} width={.37} height={.079} bg="#233b51" />
    <Block position={[.235, 2.51, .71]} size={[.23, .016, .008]} color={color} emissive={color} intensity={1.3} />
    <Block position={[.373, 1.31, .722]} size={[.029, .28, .055]} color="#ced7df" metalness={.9} roughness={.2} />
    <Block position={[0, 2.67, 0]} size={[.96, .13, 1.25]} color="#405664" metalness={.7} roughness={.28} />
    <Block position={[0, 2.745, 0]} size={[.64, .012, .86]} color="#121e2a" />
    <Blocks positions={Array.from({ length: 14 }, (_, i) => [-.28 + i * .043, 2.758, 0])} size={[.012, .009, .77]} color="#748c9b" />
    <Block position={[.456, 1.36, -.02]} size={[.023, 2.32, 1.01]} color="#263948" metalness={.65} />
    <Blocks positions={Array.from({ length: 17 }, (_, i) => [.471, .39 + i * .075, 0])} size={[.012, .014, .74]} color="#0c1924" />
    <Block position={[0, 1.35, -.612]} size={[.79, 2.28, .025]} color="#253543" />
    <Blocks positions={Array.from({ length: 24 }, (_, i) => [0, .29 + i * .09, -.634])} size={[.7, .025, .018]} color="#0a1722" />
    <mesh position={[-.428, 1.32, .716]}><boxGeometry args={[.014, 2.29, .015]} /><meshStandardMaterial ref={statusMaterial} color={color} emissive={color} emissiveIntensity={.7} /></mesh>
    <Block position={[0, .15, .655]} size={[.83, .022, .025]} color={selected ? '#b9fff0' : '#269baa'} emissive={selected ? '#90ffe7' : '#168b9b'} intensity={selected ? 1.3 : .45} />
    <Blocks positions={[[-.34, .027, .48], [.34, .027, .48], [-.34, .027, -.48], [.34, .027, -.48]]} size={[.08, .05, .08]} color="#758b9c" />
  </group>
}

function CoolingFan({ y, command, reduceMotion }) {
  const rotor = useRef()
  useFrame((_, delta) => { if (rotor.current && !reduceMotion && Number.isFinite(command)) rotor.current.rotation.z -= delta * command * 6 })
  return <group position={[0, y, .625]}>
    <mesh><circleGeometry args={[.185, 24]} /><meshStandardMaterial color="#102331" /></mesh>
    <group ref={rotor}>{[0, 1, 2, 3, 4].map((i) => <group key={i} rotation={[0, 0, i * Math.PI * 2 / 5]}><Block position={[.079, 0, .016]} size={[.16, .054, .019]} color="#7e9bac" metalness={.65} rotation={[0, 0, .28]} /></group>)}</group>
    <mesh position={[0, 0, .05]}><circleGeometry args={[.042, 12]} /><meshStandardMaterial color="#b0c6d0" metalness={.7} /></mesh>
    <mesh position={[0, 0, .057]}><ringGeometry args={[.186, .202, 32]} /><meshStandardMaterial color="#9eb5c4" metalness={.8} /></mesh>
    <Blocks positions={Array.from({ length: 9 }, (_, i) => [0, -.152 + i * .038, .069])} size={[.34, .008, .009]} color="#3e5d70" />
  </group>
}

function CoolingUnit({ zone, data, reduceMotion }) {
  const derated = Number.isFinite(data?.capacity) && data.capacity < 1
  const status = derated ? '#ffc15d' : Number.isFinite(data?.cooling) ? '#43daed' : '#738898'
  return <group position={[1.31, 0, -.02]}>
    <Block position={[0, 1.33, 0]} size={[.59, 2.63, 1.12]} color="#c1ced4" metalness={.48} roughness={.31} castShadow />
    <Block position={[0, 1.3, .569]} size={[.51, 2.42, .024]} color="#a3b7c2" metalness={.45} />
    <Block position={[0, 1.28, .593]} size={[.43, 1.97, .018]} color="#284659" />
    {[.6, 1.12, 1.64].map((y) => <CoolingFan key={y} y={y} command={data?.cooling} reduceMotion={reduceMotion} />)}
    <Sign text={`COOL / ${zone.letter}`} position={[0, 2.46, .595]} width={.43} height={.1} bg="#345368" />
    <Sign text={pct(data?.cooling)} subtext="APPLIED COOLING" position={[0, 2.17, .615]} width={.4} height={.15} bg="#102b3d" color={status} />
    <Block position={[0, 2.7, 0]} size={[.62, .11, 1.17]} color="#608496" />
    <Block position={[.304, 1.34, 0]} size={[.018, 2.36, .98]} color="#9cafbc" metalness={.6} />
    <Blocks positions={Array.from({ length: 24 }, (_, i) => [.319, .34 + i * .038, -.04])} size={[.012, .014, .73]} color="#364d5e" />
    <Block position={[.32, 2.41, 0]} size={[.015, .095, .93]} color="#237ca6" />
    <Block position={[.329, 1.65, .35]} size={[.022, .25, .028]} color="#d0dce4" metalness={.85} />
    <Sign text="PRECISION COOLING" position={[.323, 2.18, 0]} rotation={[0, Math.PI / 2, 0]} width={.81} height={.12} bg="#3d6074" />
    <Block position={[0, 2.775, .18]} size={[.32, .045, .1]} color={status} emissive={status} intensity={derated ? 1.8 : .8} />
    <Block position={[0, .14, .614]} size={[.47, .04, .025]} color={status} emissive={status} intensity={.8} />
    {derated && <Html position={[0, 2.99, 0]} center zIndexRange={[8, 0]}><span className="room-fault-tag">{zone.letter} · {pct(data.capacity)} CAPACITY</span></Html>}
  </group>
}

function CableDrops({ zone, value }) {
  const paths = useMemo(() => CABLE_COLORS.map((color, i) => ({ color, points: [[-.6 + i * .08, 3.44, -.2 + i * .08], [-.61 + i * .08, 3.2, -.23], [-.54 + i * .065, 3.05, -.42], [-.53 + i * .055, 2.8, -.45], [-.53 + i * .055, 2.68, -.38]] })), [])
  return <group>
    {paths.map((path, i) => <Cable key={i} {...path} radius={.019} />)}
    <Block position={[-.41, 3.06, -.43]} size={[.43, .032, .04]} color="#b4bec5" />
    <Block position={[-.4, 2.87, -.45]} size={[.35, .035, .04]} color="#b4bec5" />
    <Block position={[.25, 3.03, 0]} size={[1.4, .025, .035]} color="#6d8390" />
    <Sign text={`${zone.letter} / ${value}`} position={[.19, 2.93, .37]} width={1.12} height={.23} bg="#126e92" />
  </group>
}

function AirParticles({ cooling, reduceMotion }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    for (let i = 0; i < 16; i++) {
      const p = reduceMotion ? i / 16 : (clock.elapsedTime * (cooling || 0) * .2 + i / 16) % 1
      instanceTransform.position.set(-.85 + (i % 6) * .35, .13 + p * 1.9, .94 - p * .22)
      instanceTransform.scale.set(.012, .065, .012); instanceTransform.updateMatrix(); ref.current.setMatrixAt(i, instanceTransform.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  })
  if (!Number.isFinite(cooling) || cooling <= .005) return null
  return <instancedMesh ref={ref} args={[undefined, undefined, 16]} frustumCulled={false}><boxGeometry /><meshBasicMaterial color="#8be6ff" transparent opacity={Math.min(.55, cooling * .65)} depthWrite={false} /></instancedMesh>
}

function ZoneGroup({ zone, data, selected, onSelect, config, layer, reduceMotion }) {
  const color = layer === 'load' && Number.isFinite(data?.utilization) ? '#bfa6ff' : tempColor(data?.temperature_c, config)
  const value = layer === 'load' ? pct(data?.utilization) : `${fmt(data?.temperature_c)}°C`
  const patchCords = useMemo(() => ['#3b9cea', '#e7ad2a', '#33b0c3'].map((cordColor, i) => ({ color: cordColor, points: [[.92, 2.39, -.25 + i * .15], [.98, 2.58, -.25 + i * .15], [1.04, 2.75, -.35 + i * .15], [1.12, 3.2, -.42 + i * .07], [1.26 + i * .065, 3.44, -.15]] })), [])
  return <group position={zone.position}>
    <group onClick={(e) => { e.stopPropagation(); onSelect(zone.id) }} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = 'auto' }}>
      <Cabinet offset={-.49} zone={zone} data={data} color={color} selected={selected} reduceMotion={reduceMotion} />
      <Cabinet offset={.49} zone={zone} data={data} color={color} selected={selected} reduceMotion={reduceMotion} />
      <CoolingUnit zone={zone} data={data} reduceMotion={reduceMotion} />
      <CableDrops zone={zone} value={value} />
      {patchCords.map((cord, i) => <Cable key={i} {...cord} radius={.018} />)}
    </group>
    {selected && <>
      <Html position={[.22, 3.21, .65]} center zIndexRange={[12, 0]}><button className="rack-label selected" onClick={() => onSelect(null)} aria-label={`Close ${zone.name} in 3D`}><span>{zone.name.toUpperCase()}<small>{layer === 'load' ? 'WORKLOAD' : 'TEMPERATURE'}</small></span><strong style={{ color }}>{layer === 'load' ? pct(data?.utilization) : `${fmt(data?.temperature_c)}°C`}</strong></button></Html>
      <Block position={[.29, .037, .71]} size={[2.65, .018, .055]} color="#aaffeb" emissive="#6bf8d6" intensity={1.6} />
    </>}
    <Sign text={`ZONE ${zone.letter}`} position={[.2, .028, 1.14]} width={1.3} height={.28} rotation={[-Math.PI / 2, 0, 0]} bg="#455e70" />
    <AirParticles cooling={data?.cooling} reduceMotion={reduceMotion} />
  </group>
}

function Transfer({ move, step, reduceMotion }) {
  const packet = useRef(), elapsed = useRef(0)
  const curve = useMemo(() => {
    const from = ROOM_ZONES.find((z) => z.id === move.from_zone)?.position, to = ROOM_ZONES.find((z) => z.id === move.to_zone)?.position
    if (!from || !to) return null
    return new THREE.QuadraticBezierCurve3(new THREE.Vector3(from[0], 2.79, from[2] + .64), new THREE.Vector3((from[0] + to[0]) / 2, 3.95, (from[2] + to[2]) / 2 + .64), new THREE.Vector3(to[0], 2.79, to[2] + .64))
  }, [move.from_zone, move.to_zone])
  const geometry = useMemo(() => curve ? new THREE.TubeGeometry(curve, 36, .018, 6, false) : null, [curve])
  useEffect(() => { elapsed.current = 0; return () => geometry?.dispose() }, [step, geometry])
  useFrame((_, delta) => {
    if (!curve || !packet.current) return
    if (!reduceMotion) elapsed.current += delta
    for (let i = 0; i < 3; i++) {
      const p = reduceMotion ? .25 + i * .25 : Math.min(1, Math.max(0, elapsed.current / 2.5 - i * .11))
      curve.getPoint(p, packetPosition); instanceTransform.position.copy(packetPosition); instanceTransform.scale.setScalar(p >= 1 ? 0 : .058)
      instanceTransform.updateMatrix(); packet.current.setMatrixAt(i, instanceTransform.matrix)
    }
    packet.current.instanceMatrix.needsUpdate = true
  })
  if (!curve) return null
  return <group>
    <mesh geometry={geometry}><meshBasicMaterial color="#c5a2ff" transparent opacity={.9} depthWrite={false} /></mesh>
    <instancedMesh ref={packet} args={[undefined, undefined, 3]} frustumCulled={false}><sphereGeometry args={[1, 10, 8]} /><meshBasicMaterial color="#f5ebff" toneMapped={false} /></instancedMesh>
    <Html position={curve.getPoint(.5).add(new THREE.Vector3(0, .22, 0)).toArray()} center zIndexRange={[10, 0]}><div className="transfer-label">{zoneName(move.from_zone)} → {zoneName(move.to_zone)}<small>Applied transfer · step {step}</small></div></Html>
  </group>
}

function CameraRig({ cameraKey }) {
  const ref = useRef()
  const { get, size } = useThree()
  const overview = cameraKey < 0
  useEffect(() => {
    const { camera } = get()
    const narrow = size.width / size.height < 1.2
    camera.fov = overview ? 44 : narrow ? 68 : 50
    if (overview) { camera.position.set(10.5, 10.8, 13.6); ref.current?.target.set(-.4, 1, -.1) }
    else { camera.position.set(5.3, 2.95, 4.65); ref.current?.target.set(-1.2, 1.6, -.9) }
    camera.updateProjectionMatrix(); ref.current?.update()
  }, [cameraKey, get, size.width, size.height, overview])
  return <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={.08} minDistance={overview ? 9 : 4} maxDistance={overview ? 27 : 10.1} minPolarAngle={overview ? .3 : 1.37} maxPolarAngle={overview ? 1.45 : 1.55} minAzimuthAngle={overview ? -Infinity : -.35} maxAzimuthAngle={overview ? Infinity : 1.1} enablePan={false} />
}

export default function FacilityView({ frame, history, config, selectedZone, onSelectZone, layer, cameraKey, reduceMotion, onFallback }) {
  const mounted = useRef(true)
  const latestTransfer = [...history].reverse().find((f) => f.run_id === frame?.run_id && f.actions?.workload_moves?.length && frame.sequence - f.sequence <= 5)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; document.body.style.cursor = 'auto' } }, [])
  return <Canvas dpr={[1, 1.5]} shadows camera={{ fov: 50, position: [5.3, 2.95, 4.65], near: .08, far: 65 }}
    gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .92, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (mounted.current) onFallback('Graphics context lost. Thermal plan remains available.') }, { once: true }) }}>
    <color attach="background" args={['#172a3b']} />
    <StudioReflections />
    <hemisphereLight args={['#d7efff', '#465f76', .7]} />
    <ambientLight intensity={.18} />
    <directionalLight position={[3, 7, 5]} color="#e7f1ff" intensity={1.65} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-normalBias={.035} shadow-bias={-.0001} />
    <directionalLight position={[-5, 3, -3]} intensity={.65} color="#b5daff" />
    <pointLight position={[-2.5, 3.7, -.7]} intensity={30} color="#62d5ff" distance={11} decay={2} />
    <pointLight position={[3, 3.8, 2.5]} intensity={24} color="#fff0d5" distance={12} decay={2} />
    <RoomArchitecture overview={cameraKey < 0} />
    {ROOM_ZONES.map((zone) => <ZoneGroup key={zone.id} zone={zone} data={frame?.zones.find((data) => data.id === zone.id)} selected={selectedZone === zone.id} onSelect={onSelectZone} config={config} layer={layer} reduceMotion={reduceMotion} />)}
    <GroundShadow />
    {latestTransfer?.actions.workload_moves.map((move, i) => <Transfer key={`${latestTransfer.run_id}-${latestTransfer.sequence}-${i}`} move={move} step={latestTransfer.sequence} reduceMotion={reduceMotion} />)}
    <CameraRig cameraKey={cameraKey} />
  </Canvas>
}
