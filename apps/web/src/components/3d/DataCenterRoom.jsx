import React, { useMemo } from 'react'
import * as THREE from 'three'
import ServerRack from './ServerRack'
import CRACUnit from './CRACUnit'
import CeilingLight from './CeilingLight'
import FloorVent from './FloorVent'
import CableTray from './CableTray'
import AirflowPath from './AirflowPath'
import { getFloorTileTexture } from './textures'
import { useSimulationState } from '../../state/simulationStore'

/**
 * DataCenterRoom integrates the physical 3D environment with live simulation telemetry.
 */
export default function DataCenterRoom({ onAssetError }) {
  const {
    racks,
    cracs,
    viewMode,
    selectedRackId,
    hoveredRackId,
    selectedCracId,
    hoveredCracId,
  } = useSimulationState()

  const floorTexture = useMemo(() => {
    try {
      const tex = getFloorTileTexture()
      tex.repeat.set(23, 16)
      return tex
    } catch (err) {
      console.error('Floor tile texture failure:', err)
      if (onAssetError) onAssetError(`Direct floor texture failure: ${err.message}`)
      throw err
    }
  }, [onAssetError])

  const roomWidth = 14 // X: -7 to +7
  const roomDepth = 10 // Z: -5 to +5
  const roomHeight = 3.6 // Y: 0 to 3.6

  return (
    <group>
      {/* ============================================================ */}
      {/* 1. FLOOR (Industrial Light-Gray Raised Access Tiles)         */}
      {/* ============================================================ */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[roomWidth, roomDepth]} />
        <meshStandardMaterial
          map={floorTexture}
          roughness={0.45}
          metalness={0.15}
        />
      </mesh>

      {/* Safety Walkway Line along the front boundary */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, roomDepth / 2 - 0.1]}
      >
        <planeGeometry args={[roomWidth - 0.4, 0.08]} />
        <meshStandardMaterial
          color="#ca8a04"
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>

      {/* ============================================================ */}
      {/* 2. THREE SOLID WALLS (Industrial Light-Gray / Slate-300)     */}
      {/* ============================================================ */}
      {/* Back Wall (Z = -5m) */}
      <group position={[0, roomHeight / 2, -roomDepth / 2]}>
        <mesh receiveShadow>
          <boxGeometry args={[roomWidth, roomHeight, 0.2]} />
          <meshStandardMaterial
            color="#cbd5e1"
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>

        {/* Industrial Slate Baseboard */}
        <mesh position={[0, -roomHeight / 2 + 0.08, 0.11]}>
          <boxGeometry args={[roomWidth, 0.16, 0.02]} />
          <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.4} />
        </mesh>

        {/* Architectural Reveal Seams */}
        {[-4.5, -2.2, 2.2, 4.5].map((sx, i) => (
          <mesh key={i} position={[sx, 0, 0.105]}>
            <boxGeometry args={[0.015, roomHeight, 0.01]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.6} />
          </mesh>
        ))}

        {/* --- DOUBLE EMERGENCY EXIT DOOR IN BACKGROUND --- */}
        <group position={[0, -roomHeight / 2 + 1.25, 0.11]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2.1, 2.5, 0.04]} />
            <meshStandardMaterial color="#64748b" roughness={0.4} metalness={0.5} />
          </mesh>

          {/* Left Door Leaf */}
          <mesh position={[-0.49, 0, 0.01]} castShadow receiveShadow>
            <boxGeometry args={[0.96, 2.4, 0.03]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.2} />
          </mesh>

          {/* Right Door Leaf */}
          <mesh position={[0.49, 0, 0.01]} castShadow receiveShadow>
            <boxGeometry args={[0.96, 2.4, 0.03]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.2} />
          </mesh>

          {/* Vision Glass Windows */}
          {[-0.49, 0.49].map((gx, i) => (
            <mesh key={i} position={[gx, 0.35, 0.026]}>
              <planeGeometry args={[0.22, 0.7]} />
              <meshStandardMaterial
                color="#0f172a"
                roughness={0.1}
                metalness={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}

          {/* Stainless Steel Panic Crash Bars */}
          {[-0.49, 0.49].map((bx, i) => (
            <mesh key={i} position={[bx, -0.15, 0.045]} castShadow>
              <boxGeometry args={[0.78, 0.045, 0.035]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.25} metalness={0.85} />
            </mesh>
          ))}

          {/* Illuminated Green Emergency EXIT Sign Above Door */}
          <group position={[0, 1.45, 0.03]}>
            <mesh castShadow>
              <boxGeometry args={[0.55, 0.22, 0.03]} />
              <meshStandardMaterial color="#14532d" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.018]}>
              <planeGeometry args={[0.48, 0.16]} />
              <meshStandardMaterial
                color="#22c55e"
                emissive="#16a34a"
                emissiveIntensity={1.2}
              />
            </mesh>
          </group>
        </group>

        {/* Facility Electrical Breaker Cabinet */}
        <group position={[-4.6, 0.15, 0.15]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.2, 1.7, 0.2]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[-0.4, 0.6, 0.11]}>
            <sphereGeometry args={[0.016, 8, 8]} />
            <meshBasicMaterial color="#22c55e" />
          </mesh>
          <mesh position={[-0.3, 0.6, 0.11]}>
            <sphereGeometry args={[0.016, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>
      </group>

      {/* Left Wall (X = -7m) */}
      <group position={[-roomWidth / 2, roomHeight / 2, 0]}>
        <mesh receiveShadow>
          <boxGeometry args={[0.2, roomHeight, roomDepth]} />
          <meshStandardMaterial
            color="#cbd5e1"
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
        <mesh position={[0.11, -roomHeight / 2 + 0.08, 0]}>
          <boxGeometry args={[0.02, 0.16, roomDepth]} />
          <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0.12, 1.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, roomDepth, 12]} />
          <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.8} />
        </mesh>
      </group>

      {/* Right Wall (X = +7m) */}
      <group position={[roomWidth / 2, roomHeight / 2, 0]}>
        <mesh receiveShadow>
          <boxGeometry args={[0.2, roomHeight, roomDepth]} />
          <meshStandardMaterial
            color="#cbd5e1"
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
        <mesh position={[-0.11, -roomHeight / 2 + 0.08, 0]}>
          <boxGeometry args={[0.02, 0.16, roomDepth]} />
          <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[-0.12, 1.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, roomDepth, 12]} />
          <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.8} />
        </mesh>
      </group>

      {/* ============================================================ */}
      {/* 3. CEILING (Industrial Modular Drop Ceiling)                 */}
      {/* ============================================================ */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, roomHeight, 0]}
        receiveShadow
      >
        <planeGeometry args={[roomWidth, roomDepth]} />
        <meshStandardMaterial
          color="#d1d5db"
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Modular Ceiling T-Grid Rails */}
      {[-4, -2, 0, 2, 4].map((tx, i) => (
        <mesh key={i} position={[tx, roomHeight - 0.005, 0]}>
          <boxGeometry args={[0.02, 0.01, roomDepth]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.5} />
        </mesh>
      ))}
      {[-3, -1.5, 0, 1.5, 3].map((tz, i) => (
        <mesh key={i} position={[0, roomHeight - 0.005, tz]}>
          <boxGeometry args={[roomWidth, 0.01, 0.02]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.5} />
        </mesh>
      ))}

      {/* ============================================================ */}
      {/* 4. SIX SERVER RACKS (Driven by Simulation State)             */}
      {/* ============================================================ */}
      {racks.map((rack, idx) => (
        <ServerRack
          key={rack.id}
          data={rack}
          viewMode={viewMode}
          isSelected={selectedRackId === rack.id}
          isHovered={hoveredRackId === rack.id}
          selectedCracId={selectedCracId}
          seed={idx + 1}
        />
      ))}

      {/* ============================================================ */}
      {/* 5. COLD & HOT AISLE FLOOR BOUNDARY MARKINGS                  */}
      {/* ============================================================ */}
      {/* Cold Aisle Demarcations (Cyan boundaries along center aisle) */}
      {[-1.25, 1.25].map((bx, i) => (
        <mesh
          key={`cold-edge-${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[bx, 0.002, 0]}
        >
          <planeGeometry args={[0.04, 7.6]} />
          <meshBasicMaterial
            color="#06b6d4"
            transparent
            opacity={0.4}
          />
        </mesh>
      ))}

      {/* Hot Aisle Demarcations (Warm amber boundaries behind racks) */}
      {[-2.45, 2.45].map((bx, i) => (
        <mesh
          key={`hot-edge-${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[bx, 0.002, 0]}
        >
          <planeGeometry args={[0.04, 7.6]} />
          <meshBasicMaterial
            color="#f97316"
            transparent
            opacity={0.35}
          />
        </mesh>
      ))}

      {/* ============================================================ */}
      {/* 6. RAISED-FLOOR VENTILATION GRILLES (Center Cold Aisle)      */}
      {/* ============================================================ */}
      {[-3.0, -1.8, -0.6, 0.6, 1.8, 3.0].map((vz, idx) => (
        <group key={idx}>
          <FloorVent position={[-0.4, 0, vz]} />
          <FloorVent position={[0.4, 0, vz]} />
        </group>
      ))}

      {/* ============================================================ */}
      {/* 7. TWO CRAC UNITS (Driven by Simulation State)               */}
      {/* ============================================================ */}
      {cracs.map((crac) => (
        <CRACUnit
          key={crac.id}
          data={crac}
          isSelected={selectedCracId === crac.id}
          isHovered={hoveredCracId === crac.id}
          selectedRackId={selectedRackId}
        />
      ))}

      {/* ============================================================ */}
      {/* 8. REAL-TIME CLOSED-LOOP COOLING AIRFLOW SPLINES             */}
      {/* ============================================================ */}
      <AirflowPath
        selectedRack={racks.find((r) => r.id === selectedRackId)}
        cracs={cracs}
      />

      {/* ============================================================ */}
      {/* 9. PARALLEL HORIZONTAL OVERHEAD CABLE TRAYS                  */}
      {/* ============================================================ */}
      <CableTray
        position={[-1.8, 3.25, 0]}
        length={8.0}
        width={0.45}
        ceilingY={3.6}
        dropDirection={-1}
        rackDrops={[-2.4, 0, 2.4]}
        rackTopY={2.15}
      />
      <CableTray
        position={[1.8, 3.25, 0]}
        length={8.0}
        width={0.45}
        ceilingY={3.6}
        dropDirection={1}
        rackDrops={[-2.4, 0, 2.4]}
        rackTopY={2.15}
      />

      {/* ============================================================ */}
      {/* 10. CEILING LIGHT FIXTURES (Recessed Daylight LED Troffers)  */}
      {/* ============================================================ */}
      <CeilingLight position={[0, 3.58, -3.0]} intensity={5.0} />
      <CeilingLight position={[0, 3.58, -1.0]} intensity={5.0} />
      <CeilingLight position={[0, 3.58, 1.0]} intensity={5.0} />
      <CeilingLight position={[0, 3.58, 3.0]} intensity={5.0} />

      <CeilingLight position={[-4.5, 3.58, -2.0]} intensity={4.5} />
      <CeilingLight position={[-4.5, 3.58, 2.0]} intensity={4.5} />

      <CeilingLight position={[4.5, 3.58, -2.0]} intensity={4.5} />
      <CeilingLight position={[4.5, 3.58, 2.0]} intensity={4.5} />
    </group>
  )
}
