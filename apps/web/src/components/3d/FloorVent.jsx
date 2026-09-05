import React, { useMemo } from 'react'
import * as THREE from 'three'
import { getVentGrilleTexture } from './textures'

export default function FloorVent({ position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const ventTexture = useMemo(() => getVentGrilleTexture(), [])

  return (
    <group position={position} rotation={rotation}>
      {/* Outer brushed aluminum mounting rim (lies completely flat on the floor) */}
      <mesh position={[0, 0.004, 0]} receiveShadow>
        <boxGeometry args={[0.6, 0.008, 0.6]} />
        <meshStandardMaterial
          color="#94a3b8"
          roughness={0.4}
          metalness={0.6}
        />
      </mesh>

      {/* Recessed dark ventilation plenum well */}
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.54, 0.54]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>

      {/* Perforated airflow grille panel (flat horizontal surface) */}
      <mesh position={[0, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[0.55, 0.55]} />
        <meshStandardMaterial
          map={ventTexture}
          roughness={0.3}
          metalness={0.7}
          transparent
          opacity={0.92}
        />
      </mesh>
    </group>
  )
}
