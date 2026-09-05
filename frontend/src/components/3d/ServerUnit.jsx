import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * ServerUnit represents an individual 1U, 2U or 3U rackmount server chassis
 * @param {Array} position - [x, y, z] position inside the rack
 * @param {number} uHeight - Height in rack units (1, 2, or 3)
 * @param {string} type - 'compute' | 'storage' | 'blank'
 * @param {number} seed - Random seed for varied LED blink offsets
 */
export default function ServerUnit({
  position = [0, 0, 0],
  uHeight = 1,
  type = 'compute',
  seed = 0,
}) {
  const height = uHeight * 0.042
  const width = 0.48
  const depth = 0.82

  const ledMeshRef = useRef()
  const blinkPhase1 = useMemo(() => (seed * 1.37) % (Math.PI * 2), [seed])

  useFrame(({ clock }) => {
    if (ledMeshRef.current && type !== 'blank') {
      const t = clock.getElapsedTime() * 5 + blinkPhase1
      const brightness = Math.sin(t) * Math.cos(t * 1.7) > 0.1 ? 1 : 0.25
      ledMeshRef.current.material.opacity = brightness
    }
  })

  if (type === 'blank') {
    // Blanking panel with subtle ventilation ribs
    return (
      <group position={position}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height - 0.002, 0.015]} />
          <meshStandardMaterial color="#2d333b" roughness={0.6} metalness={0.4} />
        </mesh>
      </group>
    )
  }

  return (
    <group position={position}>
      {/* 1. Main Server Chassis body */}
      <mesh position={[0, 0, -depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.02, height - 0.004, depth]} />
        <meshStandardMaterial color="#22272e" roughness={0.35} metalness={0.7} />
      </mesh>

      {/* 2. Front Faceplate / Bezel (Dark Charcoal with clear edges) */}
      <mesh position={[0, 0, 0.005]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.004, 0.015]} />
        <meshStandardMaterial color="#1c2128" roughness={0.4} metalness={0.6} />
      </mesh>

      {/* 3. Left and Right Brushed Aluminum Mounting Ears */}
      <mesh position={[-width / 2 + 0.012, 0, 0.008]} castShadow>
        <boxGeometry args={[0.024, height - 0.006, 0.008]} />
        <meshStandardMaterial color="#64748b" roughness={0.25} metalness={0.85} />
      </mesh>
      <mesh position={[width / 2 - 0.012, 0, 0.008]} castShadow>
        <boxGeometry args={[0.024, height - 0.006, 0.008]} />
        <meshStandardMaterial color="#64748b" roughness={0.25} metalness={0.85} />
      </mesh>

      {/* Rack Screws */}
      {[-width / 2 + 0.012, width / 2 - 0.012].map((sx, i) => (
        <mesh key={i} position={[sx, 0, 0.013]}>
          <cylinderGeometry args={[0.0035, 0.0035, 0.002, 8]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.2} metalness={0.9} />
        </mesh>
      ))}

      {/* 4. Drive Caddies or Compute Air Vents */}
      {type === 'storage' ? (
        // Array of 4 storage drive sleds with silver latches
        [-0.15, -0.05, 0.05, 0.15].map((xOffset, i) => (
          <group key={i} position={[xOffset, 0, 0.013]}>
            {/* Drive Sled Face */}
            <mesh castShadow>
              <boxGeometry args={[0.088, height - 0.012, 0.004]} />
              <meshStandardMaterial color="#2d333b" roughness={0.4} metalness={0.6} />
            </mesh>
            {/* Silver release latch handle */}
            <mesh position={[0, 0, 0.003]}>
              <boxGeometry args={[0.065, 0.006, 0.003]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.25} metalness={0.9} />
            </mesh>
          </group>
        ))
      ) : (
        // 1U Compute Server: Louvers & Drive bays
        <group position={[0.02, 0, 0.013]}>
          <mesh castShadow>
            <boxGeometry args={[0.3, height - 0.01, 0.003]} />
            <meshStandardMaterial color="#22272e" roughness={0.5} metalness={0.5} />
          </mesh>
          {/* Horizontal vent lines */}
          <mesh position={[0, 0, 0.002]}>
            <boxGeometry args={[0.28, 0.003, 0.002]} />
            <meshStandardMaterial color="#0f141c" roughness={0.5} metalness={0.4} />
          </mesh>
        </group>
      )}

      {/* 5. Status Indicators / Brightly Visible LEDs */}
      {/* Power LED (Vibrant Green) */}
      <mesh position={[-width / 2 + 0.04, 0.006, 0.014]}>
        <sphereGeometry args={[0.0028, 8, 8]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>

      {/* Network Activity LED (Cyan Pulsing) */}
      <mesh ref={ledMeshRef} position={[-width / 2 + 0.05, 0.006, 0.014]}>
        <sphereGeometry args={[0.0028, 8, 8]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={1} />
      </mesh>

      {/* Disk Activity LED (Amber) */}
      <mesh position={[-width / 2 + 0.06, 0.006, 0.014]}>
        <sphereGeometry args={[0.0025, 8, 8]} />
        <meshBasicMaterial
          color={seed % 2 === 0 ? '#f59e0b' : '#38bdf8'}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Asset ID Tag (Silver/White) */}
      <mesh position={[-width / 2 + 0.05, -0.007, 0.013]}>
        <boxGeometry args={[0.025, 0.005, 0.001]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.8} />
      </mesh>
    </group>
  )
}
