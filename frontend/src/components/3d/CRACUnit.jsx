import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simulationStore, COOLING_TOPOLOGY } from '../../state/simulationStore'

/**
 * CRACUnit represents a Computer Room Air Conditioner with digital-twin telemetry.
 *
 * @param {Object} data - CRAC unit telemetry data from simulationStore:
 *   { id, name, position, rotation, capacity, power, status, airflow }
 * @param {boolean} isSelected - Whether this CRAC is selected
 * @param {boolean} isHovered - Whether this CRAC is hovered
 * @param {string|null} selectedRackId - Currently selected rack ID
 */
export default function CRACUnit({
  data,
  isSelected = false,
  isHovered = false,
  selectedRackId = null,
}) {
  const fan1Ref = useRef()
  const fan2Ref = useRef()

  const {
    id = 'CRAC-01',
    name = 'CRAC 01',
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    capacity = 80, // %
    power = 8.5, // kW
    status = 'ACTIVE',
    airflow = 7500, // CFM
  } = data || {}

  // Check if this CRAC is actively cooling the selected rack
  const isConnectedToSelectedRack = useMemo(() => {
    if (!selectedRackId) return false
    const connections = COOLING_TOPOLOGY[selectedRackId] || []
    return connections.some((c) => c.cracId === id)
  }, [selectedRackId, id])

  // Animate the top exhaust fan blades proportionally to cooling capacity
  useFrame((_, delta) => {
    // If failed, fan stops rotating
    if (status === 'FAILED') return

    // Speed scales from 0 to 12 rad/s based on capacity %
    const speed = (capacity / 100) * 10
    if (fan1Ref.current) fan1Ref.current.rotation.y += delta * speed
    if (fan2Ref.current) fan2Ref.current.rotation.y += delta * speed
  })

  // Industrial CRAC dimensions (meters)
  const width = 1.6
  const height = 2.45
  const depth = 0.95

  // Status indicator colors
  const statusColor = useMemo(() => {
    if (status === 'FAILED') return '#ef4444' // Red
    if (status === 'WARNING') return '#f59e0b' // Amber
    return '#22c55e' // Green
  }, [status])

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation()
        simulationStore.setSelectedCrac(id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        simulationStore.setHoveredCrac(id)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        simulationStore.setHoveredCrac(null)
        document.body.style.cursor = 'auto'
      }}
    >
      {/* 1. Base Mounting Plinth (Medium Slate) */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* 2. Main Industrial Enclosure Body (Clean Crisp Enterprise White) */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.1, depth]} />
        <meshStandardMaterial
          color="#f8fafc"
          roughness={0.25}
          metalness={0.08}
        />
      </mesh>

      {/* 3. Front Maintenance Door Seams (Left & Right Service Doors) */}
      <mesh position={[-0.39, height / 2, depth / 2 + 0.002]}>
        <boxGeometry args={[0.76, height - 0.22, 0.004]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.05} />
      </mesh>
      <mesh position={[0.39, height / 2, depth / 2 + 0.002]}>
        <boxGeometry args={[0.76, height - 0.22, 0.004]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.05} />
      </mesh>

      {/* Door Seam Divider */}
      <mesh position={[0, height / 2, depth / 2 + 0.003]}>
        <boxGeometry args={[0.008, height - 0.22, 0.003]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>

      {/* Stainless Steel Door Handles */}
      {[-0.04, 0.04].map((hx, i) => (
        <mesh key={i} position={[hx, 1.25, depth / 2 + 0.02]} castShadow>
          <boxGeometry args={[0.02, 0.14, 0.02]} />
          <meshStandardMaterial color="#64748b" roughness={0.25} metalness={0.85} />
        </mesh>
      ))}

      {/* 4. Lower Front Air Intake Grille (Horizontal Louvers) */}
      <group position={[0, 0.58, depth / 2 + 0.008]}>
        {/* Recessed dark interior cavity */}
        <mesh>
          <boxGeometry args={[width - 0.2, 0.78, 0.008]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        {/* Louver slats */}
        {Array.from({ length: 14 }).map((_, idx) => (
          <mesh key={idx} position={[0, -0.34 + idx * 0.052, 0.006]} castShadow>
            <boxGeometry args={[width - 0.24, 0.016, 0.012]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} metalness={0.6} />
          </mesh>
        ))}
      </group>

      {/* 5. Top Fan Cowls & Rotating Exhaust Fans */}
      {[-0.4, 0.4].map((fx, i) => (
        <group key={i} position={[fx, height, 0]}>
          {/* Fan Shroud Lip */}
          <mesh position={[0, 0.03, 0]} castShadow>
            <cylinderGeometry args={[0.34, 0.36, 0.06, 24]} />
            <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.6} />
          </mesh>
          {/* Fan Protective Wire Mesh Grill */}
          <mesh position={[0, 0.062, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.004, 24]} />
            <meshStandardMaterial
              color="#334155"
              wireframe
              roughness={0.4}
              metalness={0.8}
            />
          </mesh>
          {/* Rotating Fan Impeller */}
          <group ref={i === 0 ? fan1Ref : fan2Ref} position={[0, 0.035, 0]}>
            <mesh>
              <cylinderGeometry args={[0.08, 0.08, 0.02, 16]} />
              <meshStandardMaterial color="#1e293b" roughness={0.4} metalness={0.6} />
            </mesh>
            {/* 4 Fan Blades */}
            {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, bi) => (
              <mesh
                key={bi}
                rotation={[0.2, angle, 0]}
                position={[
                  Math.cos(angle) * 0.16,
                  0,
                  Math.sin(angle) * 0.16,
                ]}
              >
                <boxGeometry args={[0.18, 0.006, 0.07]} />
                <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.5} />
              </mesh>
            ))}
          </group>
        </group>
      ))}

      {/* 6. Digital Control Console / LCD Screen */}
      <group position={[0.42, 1.55, depth / 2 + 0.008]}>
        {/* Bezel */}
        <mesh castShadow>
          <boxGeometry args={[0.28, 0.2, 0.012]} />
          <meshStandardMaterial color="#1e293b" roughness={0.3} metalness={0.7} />
        </mesh>
        {/* LCD Screen Display */}
        <mesh position={[0, 0.01, 0.008]}>
          <planeGeometry args={[0.22, 0.12]} />
          <meshBasicMaterial color="#0284c7" />
        </mesh>
        {/* Live Status Indicator LED */}
        <mesh position={[-0.08, -0.065, 0.009]}>
          <sphereGeometry args={[0.006, 8, 8]} />
          <meshBasicMaterial color={statusColor} />
        </mesh>
        {/* Capacity Percentage Bar (Mini) */}
        <mesh position={[0.02, -0.065, 0.009]}>
          <boxGeometry args={[0.12 * (capacity / 100), 0.008, 0.002]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      </group>

      {/* 7. CRAC Unit Identifier Plate */}
      <group position={[-0.42, 2.05, depth / 2 + 0.008]}>
        <mesh>
          <boxGeometry args={[0.3, 0.06, 0.006]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.004]}>
          <boxGeometry args={[0.28, 0.01, 0.002]} />
          <meshBasicMaterial color={statusColor} />
        </mesh>
      </group>

      {/* 8. Directional Flow Markers */}
      {/* Downward Cold Air Discharge Indicator (Base Plenum) */}
      <group position={[0, 0.08, depth / 2 + 0.012]}>
        <mesh>
          <boxGeometry args={[0.42, 0.04, 0.004]} />
          <meshBasicMaterial color="#0284c7" />
        </mesh>
      </group>

      {/* Top Warm Air Return Indicator (Ceiling Intake) */}
      <group position={[0, height - 0.05, depth / 2 + 0.012]}>
        <mesh>
          <boxGeometry args={[0.42, 0.04, 0.004]} />
          <meshBasicMaterial color="#ea580c" />
        </mesh>
      </group>

      {/* 9. Selection, Hover & Active Coupling Highlight Halo */}
      {(isSelected || isHovered || isConnectedToSelectedRack) && (
        <group position={[0, height / 2, 0]}>
          <lineSegments>
            <edgesGeometry
              attach="geometry"
              args={[new THREE.BoxGeometry(width + 0.05, height + 0.05, depth + 0.05)]}
            />
            <lineBasicMaterial
              attach="material"
              color={
                isSelected
                  ? '#38bdf8'
                  : isConnectedToSelectedRack
                  ? '#06b6d4'
                  : '#60a5fa'
              }
              linewidth={2}
            />
          </lineSegments>

          {/* Underfloor coupling ring when connected to selected rack */}
          {isConnectedToSelectedRack && (
            <mesh position={[0, -height / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.6, 0.95, 32]} />
              <meshBasicMaterial
                color="#06b6d4"
                transparent
                opacity={0.4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>
      )}
    </group>
  )
}
