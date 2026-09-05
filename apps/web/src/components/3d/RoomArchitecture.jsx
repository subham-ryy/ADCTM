import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getFloorTileTexture, getVentGrilleTexture } from './textures'

const box = new THREE.BoxGeometry(1, 1, 1)
const transform = new THREE.Object3D()

// Repeated hardware is instanced. Architecture is decorative, never simulation state.
export function Blocks({ positions, size, color, emissive = '#000000', intensity = 0, metalness = .45 }) {
  const ref = useRef()
  useLayoutEffect(() => {
    positions.forEach((position, i) => {
      transform.position.set(...position); transform.rotation.set(0, 0, 0); transform.scale.set(...size)
      transform.updateMatrix(); ref.current.setMatrixAt(i, transform.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [positions, size])
  return <instancedMesh ref={ref} args={[box, undefined, positions.length]} receiveShadow>
    <meshStandardMaterial color={color} roughness={.43} metalness={metalness} emissive={emissive} emissiveIntensity={intensity} />
  </instancedMesh>
}

export function Block({ position, size, color = '#25323e', metalness = .35, roughness = .45, emissive = '#000000', intensity = 0, castShadow = false, ...props }) {
  return <mesh position={position} scale={size} geometry={box} castShadow={castShadow} receiveShadow {...props}>
    <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} emissive={emissive} emissiveIntensity={intensity} />
  </mesh>
}

export function Sign({ text, subtext = '', position, width = 2, height = .5, rotation = [0, 0, 0], color = '#e6f6ff', bg = '#10283d' }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256
    const ctx = canvas.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1024, 256)
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.font = '600 79px Segoe UI'; ctx.fillText(text, 42, subtext ? 95 : 128)
    if (subtext) { ctx.fillStyle = '#9cb7c9'; ctx.font = '32px Segoe UI'; ctx.fillText(subtext, 45, 188) }
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; return result
  }, [text, subtext, color, bg])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={position} rotation={rotation}><planeGeometry args={[width, height]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
}

export function Cable({ points, color, radius = .02 }) {
  const geometry = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, radius, 5, false), [points, radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry}><meshStandardMaterial color={color} roughness={.55} metalness={.1} /></mesh>
}

function RaisedFloor() {
  const [floor, vent] = useMemo(() => {
    const f = getFloorTileTexture(); f.colorSpace = THREE.SRGBColorSpace; f.repeat.set(20, 17); f.anisotropy = 8
    const v = getVentGrilleTexture(); v.colorSpace = THREE.SRGBColorSpace; v.anisotropy = 8
    return [f, v]
  }, [])
  useEffect(() => () => { floor.dispose(); vent.dispose() }, [floor, vent])
  return <>
    <Block position={[0, -.16, .55]} size={[14.4, .3, 11.9]} color="#354858" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .001, .55]} receiveShadow><planeGeometry args={[14.4, 11.9]} /><meshStandardMaterial map={floor} roughness={.36} metalness={.16} /></mesh>
    {/* Painted circulation markings and actual raised-floor grille geometry. */}
    <Block position={[0, .008, -.38]} size={[13.3, .01, 1.3]} color="#1b7994" roughness={.62} metalness={.05} />
    {[-1.05, .29].map((z) => <Block key={z} position={[0, .016, z]} size={[13.3, .008, .035]} color="#64dceb" metalness={0} />)}
    <Sign text="COLD AISLE  /  01" position={[4.8, .025, -.4]} width={2.3} height={.38} rotation={[-Math.PI / 2, 0, 0]} bg="#1b7994" />
    {[-4.6, -3.8, -1.7, -.9, 1.2, 2].flatMap((x) => [-1.2, 2.68].map((z) => <mesh key={`${x}-${z}`} position={[x, .023, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[.67, .67]} /><meshStandardMaterial map={vent} roughness={.44} metalness={.5} /></mesh>))}
    {[-3.95, 3.45].map((z) => <Block key={z} position={[-1.3, .013, z]} size={[9.8, .012, .06]} color="#e3ab30" metalness={0} />)}
    <Sign text="SERVICE CLEARANCE" position={[3.8, .023, 3.5]} width={2.35} height={.34} rotation={[-Math.PI / 2, 0, 0]} bg="#d6a035" color="#202d38" />
  </>
}

function CableTray({ z }) {
  const rungs = useMemo(() => Array.from({ length: 35 }, (_, i) => [-5.65 + i * .32, 3.38, z]), [z])
  return <group>
    {[-.32, .32].map((offset) => <Block key={offset} position={[-.2, 3.4, z + offset]} size={[11.2, .16, .045]} color="#d4a438" metalness={.48} />)}
    <Blocks positions={rungs} size={[.045, .035, .62]} color="#cda549" />
    {['#147aca', '#238bcc', '#f4b423', '#e27629', '#205ad0', '#33b6be'].map((color, i) => <Block key={i} position={[-.2, 3.44, z - .24 + i * .095]} size={[11.12, .035, .036]} color={color} metalness={.06} roughness={.7} />)}
    {[-5.1, -1.9, 1.3, 4.5].map((x) => <group key={x}>
      {[-.38, .38].map((offset) => <Block key={offset} position={[x, 3.85, z + offset]} size={[.025, .9, .025]} color="#9dafb7" metalness={.8} />)}
      <Block position={[x, 3.34, z]} size={[.065, .065, .91]} color="#a1b1b8" metalness={.8} />
    </group>)}
  </group>
}

function Ceiling({ overview }) {
  return <group>
    {!overview && <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 4.42, .55]}><planeGeometry args={[14.4, 11.9]} /><meshStandardMaterial color="#bec8ce" roughness={.9} metalness={.05} /></mesh>}
    {[-4.8, -1.8, 1.2, 4.2].map((x) => <Block key={x} position={[x, 4.29, .5]} size={[.09, .18, 11.7]} color="#445d70" metalness={.6} />)}
    {[-4.5, -.2, 4.05].map((z) => <group key={z}>
      <Block position={[0, 4.31, z]} size={[14.1, .13, .09]} color="#516675" metalness={.65} />
      {[-3.4, 1.1, 4.7].map((x) => <group key={x}>
        <Block position={[x, 4.16, z]} size={[2.6, .11, .62]} color="#5f727e" metalness={.65} />
        <Block position={[x, 4.095, z]} size={[2.44, .012, .47]} color="#e6f5ff" emissive="#d3eeff" intensity={2.3} />
      </group>)}
    </group>)}
    <CableTray z={-2.6} /><CableTray z={1.6} />
    {/* Large service duct, insulated pipes and the blue network spine. */}
    <Block position={[-6.3, 3.91, .35]} size={[.68, .45, 10.6]} color="#a6b4bb" metalness={.72} roughness={.32} />
    <Blocks positions={Array.from({ length: 13 }, (_, i) => [-6.3, 3.91, -4.6 + i * .8])} size={[.715, .48, .027]} color="#6f8796" />
    {[5.55, 5.83].map((x, i) => <group key={x}><Block position={[x, 3.93, .3]} size={[.12, .12, 10.8]} color={i ? '#c55336' : '#3575a9'} /><Blocks positions={[-4, -1, 2, 5].map((z) => [x, 3.93, z])} size={[.16, .17, .07]} color="#b1bdc5" /></group>)}
    <Block position={[-5.48, 3.58, -.5]} size={[.3, .12, 9.2]} color="#1866a4" />
  </group>
}

function RoomArchitecture({ overview }) {
  return <group>
    <RaisedFloor />
    <Block position={[0, 2.2, -5.4]} size={[14.4, 4.4, .2]} color="#aabac6" metalness={.15} roughness={.72} />
    <Block position={[-7.2, 2.2, .55]} size={[.2, 4.4, 11.9]} color="#718898" metalness={.1} roughness={.7} />
    {!overview && <>
      <Block position={[7.2, 2.2, .55]} size={[.2, 4.4, 11.9]} color="#becbd1" metalness={.1} roughness={.7} />
      <Block position={[0, 4.11, 6.5]} size={[14.4, .6, .2]} color="#819aaa" />
      {[-6.7, 6.7].map((x) => <Block key={x} position={[x, 2, 6.5]} size={[1, 4, .2]} color="#94a8b5" />)}
    </>}
    <Block position={[0, .26, -5.26]} size={[14.2, .5, .07]} color="#304e65" />
    <Block position={[-7.06, .26, .55]} size={[.07, .5, 11.7]} color="#304e65" />
    <Block position={[0, 2.71, -5.26]} size={[14.2, .025, .02]} color="#308cc0" />
    <Blocks positions={Array.from({ length: 12 }, (_, i) => [-6.55 + i * 1.2, 2.17, -5.27])} size={[.025, 4.15, .035]} color="#7e929f" />
    <Blocks positions={Array.from({ length: 10 }, (_, i) => [-7.06, 2.17, -4.7 + i * 1.13])} size={[.025, 4.15, .035]} color="#587589" />
    <Block position={[0, 3.86, -5.26]} size={[14.1, .065, .03]} color="#66dfff" emissive="#29bdeb" intensity={1.4} />
    <Sign text="ADCTM / COMPUTE HALL" subtext="AUTONOMOUS THERMAL + WORKLOAD CONTROL" position={[-2.6, 3.14, -5.275]} width={5.8} height={.8} bg="#243f54" />
    <Sign text="01" position={[-6.05, 3.16, -5.26]} width={.82} height={.6} bg="#1885b0" />
    {/* Closed service door, with a window, jambs, access reader and exit fixture. */}
    <Block position={[5.6, 1.38, -5.22]} size={[1.65, 2.78, .12]} color="#41596b" />
    <Block position={[5.6, 1.38, -5.13]} size={[1.48, 2.63, .075]} color="#b1c1cc" metalness={.6} />
    <Block position={[5.6, 1.82, -5.08]} size={[1.01, .98, .04]} color="#173f59" metalness={.7} roughness={.1} />
    <Block position={[5.07, 1.08, -4.99]} size={[.035, .31, .07]} color="#d2dce3" metalness={.9} />
    <Sign text="EXIT →" position={[5.6, 2.96, -5.23]} width={.76} height={.22} bg="#176750" />
    <Block position={[4.6, 1.34, -5.22]} size={[.15, .28, .09]} color="#213647" />
    <Block position={[4.6, 1.4, -5.162]} size={[.09, .055, .013]} color="#68d9dd" emissive="#39e4f0" intensity={1.1} />
    {/* Wall-mounted service distribution panels. No decorative numeric telemetry. */}
    {[2.2, 3.23].map((x, i) => <group key={x}>
      <Block position={[x, 1.29, -5.03]} size={[.82, 2.2, .43]} color="#758b9b" metalness={.6} />
      <Block position={[x, 1.29, -4.799]} size={[.74, 2.06, .025]} color="#b5c2c9" metalness={.4} />
      <Sign text={i ? 'PDU / B' : 'PDU / A'} position={[x, 2.02, -4.775]} width={.59} height={.13} />
      <Block position={[x + .22, 1.24, -4.768]} size={[.025, .23, .04]} color="#213647" />
      <Blocks positions={Array.from({ length: 13 }, (_, k) => [x, .4 + k * .027, -4.771])} size={[.55, .012, .015]} color="#3d5363" />
      <Block position={[x, 2.72, -5.02]} size={[.11, .68, .1]} color={i ? '#3185b6' : '#e0a42e'} />
    </group>)}
    <Ceiling overview={overview} />
  </group>
}

export default memo(RoomArchitecture)
