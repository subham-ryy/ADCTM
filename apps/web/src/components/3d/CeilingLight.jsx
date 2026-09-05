import React from 'react'
import * as THREE from 'three'

/**
 * CeilingLight represents an industrial recessed LED troffer fixture
 * Completely flat recessed ceiling troffer with no vertical hanging geometry.
 *
 * @param {Array} position - [x, y, z] position
 * @param {Array} rotation - [rx, ry, rz] rotation
 * @param {number} intensity - Downward fill point light intensity
 */
export default function CeilingLight({
  position = [0, 3.6, 0],
  rotation = [0, 0, 0],
  intensity = 4.0,
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Outer brushed aluminum troffer housing frame (flat against ceiling) */}
      <mesh position={[0, 0.015, 0]}>
        <boxGeometry args={[0.48, 0.03, 1.62]} />
        <meshStandardMaterial
          color="#94a3b8"
          roughness={0.4}
          metalness={0.6}
        />
      </mesh>

      {/* Recessed reflector cavity */}
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[0.42, 0.02, 1.54]} />
        <meshStandardMaterial
          color="#e2e8f0"
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>

      {/* Emissive LED acrylic diffuser lens (Thin horizontal panel, flat against ceiling) */}
      <mesh position={[0, -0.003, 0]}>
        <boxGeometry args={[0.38, 0.004, 1.48]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.85}
          roughness={0.2}
        />
      </mesh>

      {/* Gentle downward fill light */}
      <pointLight
        position={[0, -0.15, 0]}
        intensity={intensity}
        distance={6}
        decay={1.5}
        color="#f8fafc"
      />
    </group>
  )
}
