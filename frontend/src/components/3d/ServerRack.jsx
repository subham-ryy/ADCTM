import React, { useMemo } from 'react'
import * as THREE from 'three'
import ServerUnitStack from './ServerUnitStack'
import { getMeshPerforatedTexture } from './textures'
import {
  simulationStore,
  getTemperatureColor,
  getWorkloadColor,
  getPowerColor,
  getHealthColor,
  COOLING_TOPOLOGY,
} from '../../state/simulationStore'

/**
 * ServerRack represents a 42U industrial data-center server cabinet with digital-twin telemetry.
 *
 * Physical airflow design:
 * - FRONT OF RACK = COLD AIR INTAKE (Subtle cyan intake branding)
 * - BACK OF RACK = HOT AIR EXHAUST (Warm exhaust louvers)
 * - REAR VERTICAL PDU STRIP (Power distribution unit with status LEDs)
 * - Connected CRAC feedback & dynamic thermal beacons
 */
export default function ServerRack({
  data,
  viewMode = 'REALISTIC',
  isSelected = false,
  isHovered = false,
  selectedCracId = null,
  seed = 1,
}) {
  const meshTexture = useMemo(() => getMeshPerforatedTexture(), [])

  const {
    id = 'RACK-01',
    name = 'RACK-01',
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    temp = 25.0,
    workload = 50,
    itPower = 6.0,
    health = 95,
    status = 'NORMAL',
    airflow = 'NORMAL',
  } = data || {}

  // 42U Rack dimensions (meters)
  const width = 0.8
  const height = 2.15
  const depth = 1.05

  // Compute status colors
  const tempColor = useMemo(() => getTemperatureColor(temp), [temp])
  const workloadColor = useMemo(() => getWorkloadColor(workload), [workload])
  const powerColor = useMemo(() => getPowerColor(itPower), [itPower])
  const healthColor = useMemo(() => getHealthColor(health), [health])

  // Check if this rack is connected to currently selected CRAC
  const isConnectedToSelectedCrac = useMemo(() => {
    if (!selectedCracId) return false
    const connections = COOLING_TOPOLOGY[id] || []
    return connections.some((c) => c.cracId === selectedCracId)
  }, [selectedCracId, id])

  // Active beacon color according to view mode
  const activeModeColor = useMemo(() => {
    if (viewMode === 'TEMPERATURE') return tempColor
    if (viewMode === 'WORKLOAD') return workloadColor
    if (viewMode === 'POWER') return powerColor
    return isSelected ? '#38bdf8' : isConnectedToSelectedCrac ? '#06b6d4' : isHovered ? '#60a5fa' : tempColor
  }, [viewMode, tempColor, workloadColor, powerColor, isSelected, isConnectedToSelectedCrac, isHovered])

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation()
        simulationStore.setSelectedRack(id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        simulationStore.setHoveredRack(id)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        simulationStore.setHoveredRack(null)
        document.body.style.cursor = 'auto'
      }}
    >
      {/* 1. Base Plinth */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.08, depth]} />
        <meshStandardMaterial color="#1e232a" roughness={0.6} metalness={0.4} />
      </mesh>

      {/* 2. Top Roof Panel with Exhaust Cutouts */}
      <mesh position={[0, height - 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.06, depth]} />
        <meshStandardMaterial color="#1e232a" roughness={0.6} metalness={0.4} />
      </mesh>

      {/* Top Roof Exhaust Grilles */}
      {[-0.22, 0.22].map((zOff, i) => (
        <mesh key={i} position={[0, height + 0.002, zOff]}>
          <cylinderGeometry args={[0.15, 0.15, 0.006, 16]} />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.5} />
        </mesh>
      ))}

      {/* 3. Four Heavy-Duty Corner Posts */}
      {[-width / 2 + 0.03, width / 2 - 0.03].map((x, xi) =>
        [-depth / 2 + 0.03, depth / 2 - 0.03].map((z, zi) => (
          <mesh
            key={`${xi}-${zi}`}
            position={[x, height / 2, z]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.06, height, 0.06]} />
            <meshStandardMaterial
              color="#22272e"
              roughness={0.5}
              metalness={0.5}
            />
          </mesh>
        ))
      )}

      {/* 4. Dual-Section Side Panels with Latch */}
      {[-width / 2 + 0.005, width / 2 - 0.005].map((x, idx) => (
        <group key={idx} position={[x, height / 2, 0]}>
          <mesh position={[0, (height - 0.16) / 4 + 0.01, 0]} receiveShadow>
            <boxGeometry args={[0.01, (height - 0.16) / 2 - 0.02, depth - 0.1]} />
            <meshStandardMaterial
              color="#262c35"
              roughness={0.6}
              metalness={0.3}
            />
          </mesh>
          <mesh position={[0, -(height - 0.16) / 4 - 0.01, 0]} receiveShadow>
            <boxGeometry args={[0.01, (height - 0.16) / 2 - 0.02, depth - 0.1]} />
            <meshStandardMaterial
              color="#262c35"
              roughness={0.6}
              metalness={0.3}
            />
          </mesh>
          <mesh position={[idx === 0 ? -0.003 : 0.003, 0, 0]}>
            <boxGeometry args={[0.008, 0.03, depth - 0.08]} />
            <meshStandardMaterial color="#1a1e24" roughness={0.5} metalness={0.6} />
          </mesh>
          <mesh position={[idx === 0 ? -0.006 : 0.006, 0, 0]}>
            <boxGeometry args={[0.004, 0.08, 0.04]} />
            <meshStandardMaterial color="#64748b" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      ))}

      {/* 5. BACK OF RACK: HOT AIR EXHAUST PANEL */}
      <group position={[0, height / 2, -depth / 2 + 0.01]}>
        {/* Solid perimeter frame */}
        <mesh receiveShadow>
          <boxGeometry args={[width - 0.08, height - 0.16, 0.015]} />
          <meshStandardMaterial color="#1e232a" roughness={0.6} metalness={0.4} />
        </mesh>

        {/* Hot Exhaust Louver Vents (Amber/Warm visual indication) */}
        {[-0.5, -0.2, 0.1, 0.4, 0.7].map((ly, li) => (
          <mesh key={li} position={[0, ly, -0.01]}>
            <boxGeometry args={[width - 0.2, 0.14, 0.006]} />
            <meshStandardMaterial color="#2d1d18" roughness={0.6} />
          </mesh>
        ))}

        {/* Rear Exhaust Warning Accent Bar */}
        <mesh position={[0, (height - 0.16) / 2 - 0.03, -0.01]}>
          <boxGeometry args={[0.3, 0.012, 0.002]} />
          <meshBasicMaterial color="#f97316" />
        </mesh>
      </group>

      {/* 6. VERTICAL PDU STRIP (Mounted along rear corner post) */}
      <group position={[width / 2 - 0.045, height / 2, -depth / 2 + 0.08]}>
        {/* PDU Housing */}
        <mesh castShadow>
          <boxGeometry args={[0.03, height - 0.35, 0.04]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.6} />
        </mesh>
        {/* PDU Receptacle status LEDs (Green active power indicators) */}
        {[-0.6, -0.3, 0, 0.3, 0.6].map((py, pi) => (
          <mesh key={pi} position={[0.016, py, 0]}>
            <sphereGeometry args={[0.003, 6, 6]} />
            <meshBasicMaterial color="#22c55e" />
          </mesh>
        ))}
      </group>

      {/* 7. FRONT OF RACK: COLD AIR INTAKE & DOOR FRAME */}
      <group position={[0, height / 2, depth / 2 - 0.01]}>
        {/* Left/Right Frame Rails */}
        <mesh position={[-width / 2 + 0.04, 0, 0]} castShadow>
          <boxGeometry args={[0.05, height - 0.16, 0.02]} />
          <meshStandardMaterial color="#1a1e24" roughness={0.5} metalness={0.5} />
        </mesh>
        <mesh position={[width / 2 - 0.04, 0, 0]} castShadow>
          <boxGeometry args={[0.05, height - 0.16, 0.02]} />
          <meshStandardMaterial color="#1a1e24" roughness={0.5} metalness={0.5} />
        </mesh>

        {/* Top/Bottom Door Rails */}
        <mesh position={[0, (height - 0.16) / 2 - 0.025, 0]} castShadow>
          <boxGeometry args={[width - 0.08, 0.05, 0.02]} />
          <meshStandardMaterial color="#1a1e24" roughness={0.5} metalness={0.5} />
        </mesh>
        <mesh position={[0, -(height - 0.16) / 2 + 0.025, 0]} castShadow>
          <boxGeometry args={[width - 0.08, 0.05, 0.02]} />
          <meshStandardMaterial color="#1a1e24" roughness={0.5} metalness={0.5} />
        </mesh>

        {/* Cold Air Intake Indicator Stripe (Subtle Cyan accent at bottom of front door) */}
        <mesh position={[0, -(height - 0.16) / 2 + 0.055, 0.011]}>
          <boxGeometry args={[width - 0.16, 0.006, 0.002]} />
          <meshBasicMaterial color="#06b6d4" />
        </mesh>

        {/* Perforated mesh door with localized view-mode tint */}
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[width - 0.12, height - 0.22]} />
          <meshStandardMaterial
            map={meshTexture}
            transparent
            opacity={viewMode === 'TEMPERATURE' ? 0.32 : 0.14}
            color={viewMode === 'TEMPERATURE' ? tempColor : '#ffffff'}
            roughness={0.3}
            metalness={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Stainless Steel Door Handle */}
        <mesh position={[width / 2 - 0.04, 0, 0.018]} castShadow>
          <boxGeometry args={[0.02, 0.18, 0.015]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.25} metalness={0.85} />
        </mesh>

        {/* Workload Indicator Column (Visible in WORKLOAD view mode) */}
        {viewMode === 'WORKLOAD' && (
          <group position={[width / 2 - 0.04, 0, 0.022]}>
            <mesh>
              <boxGeometry args={[0.01, height - 0.3, 0.004]} />
              <meshBasicMaterial color="#0f172a" />
            </mesh>
            <mesh
              position={[
                0,
                -((height - 0.3) / 2) + ((height - 0.3) * (workload / 100)) / 2,
                0.002,
              ]}
            >
              <boxGeometry
                args={[0.008, (height - 0.3) * (workload / 100), 0.004]}
              />
              <meshBasicMaterial color={workloadColor} />
            </mesh>
          </group>
        )}
      </group>

      {/* 8. Internal 19" EIA Vertical Mounting Rails */}
      {[-0.24, 0.24].map((rx, ri) => (
        <mesh key={ri} position={[rx, height / 2, 0.38]}>
          <boxGeometry args={[0.02, height - 0.2, 0.02]} />
          <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.8} />
        </mesh>
      ))}

      {/* 9. Instanced Server Chassis, Blanking Panels & Workload LEDs */}
      <ServerUnitStack workload={workload} seed={seed} />

      {/* 10. Top Telemetry ID Badge & Status Light Bar */}
      <group position={[0, height - 0.07, depth / 2 - 0.005]}>
        {/* Nameplate Backing */}
        <mesh>
          <boxGeometry args={[0.3, 0.05, 0.01]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.5} />
        </mesh>

        {/* Dynamic Status / Temperature Beacon Bar */}
        <mesh position={[0, 0.014, 0.006]}>
          <boxGeometry args={[0.26, 0.008, 0.002]} />
          <meshBasicMaterial color={activeModeColor} />
        </mesh>

        {/* Airflow Restriction Warning Indicator */}
        {airflow === 'RESTRICTED' && (
          <mesh position={[0, -0.014, 0.006]}>
            <boxGeometry args={[0.18, 0.006, 0.002]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        )}
      </group>

      {/* 11. Selection & Hover Halo Highlight */}
      {(isSelected || isConnectedToSelectedCrac || isHovered) && (
        <group position={[0, height / 2, 0]}>
          <lineSegments>
            <edgesGeometry
              attach="geometry"
              args={[new THREE.BoxGeometry(width + 0.04, height + 0.04, depth + 0.04)]}
            />
            <lineBasicMaterial
              attach="material"
              color={
                isSelected
                  ? '#38bdf8'
                  : isConnectedToSelectedCrac
                  ? '#06b6d4'
                  : '#60a5fa'
              }
              linewidth={2}
            />
          </lineSegments>

          {/* Under-rack glow ring when selected */}
          {isSelected && (
            <mesh position={[0, -height / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.4, 0.65, 32]} />
              <meshBasicMaterial
                color="#38bdf8"
                transparent
                opacity={0.4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>
      )}

      {/* 12. Floating Metric Tag in specialized view modes */}
      {viewMode !== 'REALISTIC' && (
        <group position={[0, height + 0.22, 0]}>
          <mesh>
            <boxGeometry args={[0.48, 0.16, 0.04]} />
            <meshStandardMaterial
              color="#0f172a"
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>
          <mesh position={[0, 0, 0.021]}>
            <planeGeometry args={[0.44, 0.12]} />
            <meshBasicMaterial
              color={
                viewMode === 'TEMPERATURE'
                  ? tempColor
                  : viewMode === 'WORKLOAD'
                  ? workloadColor
                  : powerColor
              }
            />
          </mesh>
        </group>
      )}
    </group>
  )
}
