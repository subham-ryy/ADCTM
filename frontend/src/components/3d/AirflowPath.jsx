import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { COOLING_TOPOLOGY } from '../../state/simulationStore'

/**
 * AirflowPath renders a lightweight, hardware-accelerated animated airflow path
 * showing the closed-loop cooling cycle:
 * CRAC Supply -> Underfloor Plenum -> Cold Aisle -> Rack Front (Cold Intake)
 * -> Server Load (Heat) -> Rack Rear (Hot Exhaust) -> Hot Aisle -> Ceiling Return -> CRAC
 *
 * Uses InstancedMesh for moving airflow pulses (zero heavy particles, 60 FPS guaranteed).
 */
export default function AirflowPath({ selectedRack, cracs }) {
  const supplyInstRef = useRef()
  const returnInstRef = useRef()

  // Build the airflow spline curves for each contributing CRAC
  const airflowTracks = useMemo(() => {
    if (!selectedRack) return []
    const connections = COOLING_TOPOLOGY[selectedRack.id] || []

    const tracks = []
    const [rx, ry, rz] = selectedRack.position
    // Determine rack front and rear in world coordinates:
    // Left row (rx < 0, rotated +PI/2): front faces +X (towards X=0), rear faces -X (towards -X)
    // Right row (rx > 0, rotated -PI/2): front faces -X (towards X=0), rear faces +X (towards +X)
    const frontX = rx < 0 ? rx + 0.55 : rx - 0.55
    const rearX = rx < 0 ? rx - 0.55 : rx + 0.55

    connections.forEach(({ cracId }) => {
      const crac = cracs.find((c) => c.id === cracId)
      if (!crac || crac.status === 'FAILED') return

      const [cx, cy, cz] = crac.position

      // 1. Supply Air Path (Cold): CRAC base -> underfloor -> cold aisle -> rack front
      const supplyPoints = [
        new THREE.Vector3(cx + 0.6, 0.35, cz),
        new THREE.Vector3(cx + 2.0, 0.08, (cz + rz) / 2),
        new THREE.Vector3(0, 0.12, rz), // cold aisle center vent
        new THREE.Vector3(frontX, 1.0, rz), // rack front cold intake
      ]
      const supplyCurve = new THREE.CatmullRomCurve3(supplyPoints)

      // 2. Return Air Path (Hot): Rack rear exhaust -> hot aisle -> ceiling -> CRAC top
      const returnPoints = [
        new THREE.Vector3(rearX, 1.2, rz), // rack rear hot exhaust
        new THREE.Vector3(rearX, 2.7, rz), // hot air rises in hot aisle
        new THREE.Vector3(cx + 1.5, 3.1, (cz + rz) / 2), // ceiling return pathway
        new THREE.Vector3(cx + 0.3, 2.5, cz), // CRAC top return intake
      ]
      const returnCurve = new THREE.CatmullRomCurve3(returnPoints)

      tracks.push({
        cracId,
        supplyCurve,
        returnCurve,
      })
    })

    return tracks
  }, [selectedRack, cracs])

  // Number of flow indicator markers along each curve
  const markersPerTrack = 8
  const totalSupplyMarkers = airflowTracks.length * markersPerTrack
  const totalReturnMarkers = airflowTracks.length * markersPerTrack

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 0.45 // smooth steady airflow speed
    const dummy = new THREE.Object3D()

    // Animate Supply (Cold Blue) markers
    if (supplyInstRef.current && totalSupplyMarkers > 0) {
      let instIdx = 0
      airflowTracks.forEach(({ supplyCurve }) => {
        for (let i = 0; i < markersPerTrack; i++) {
          // Calculate parametric position u in [0, 1]
          const offset = i / markersPerTrack
          const u = (t + offset) % 1.0
          const pos = supplyCurve.getPointAt(u)
          const tangent = supplyCurve.getTangentAt(u)

          dummy.position.copy(pos)
          dummy.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            tangent
          )
          dummy.scale.set(0.04, 0.04, 0.12)
          dummy.updateMatrix()
          supplyInstRef.current.setMatrixAt(instIdx, dummy.matrix)
          instIdx++
        }
      })
      supplyInstRef.current.instanceMatrix.needsUpdate = true
    }

    // Animate Return (Warm Orange) markers
    if (returnInstRef.current && totalReturnMarkers > 0) {
      let instIdx = 0
      airflowTracks.forEach(({ returnCurve }) => {
        for (let i = 0; i < markersPerTrack; i++) {
          const offset = i / markersPerTrack
          const u = (t + offset) % 1.0
          const pos = returnCurve.getPointAt(u)
          const tangent = returnCurve.getTangentAt(u)

          dummy.position.copy(pos)
          dummy.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            tangent
          )
          dummy.scale.set(0.04, 0.04, 0.12)
          dummy.updateMatrix()
          returnInstRef.current.setMatrixAt(instIdx, dummy.matrix)
          instIdx++
        }
      })
      returnInstRef.current.instanceMatrix.needsUpdate = true
    }
  })

  if (airflowTracks.length === 0) return null

  return (
    <group>
      {/* 1. Subtle Static Airflow Track Guidelines */}
      {airflowTracks.map(({ cracId, supplyCurve, returnCurve }, idx) => {
        const supplyPoints = supplyCurve.getPoints(32)
        const returnPoints = returnCurve.getPoints(32)

        const supplyGeo = new THREE.BufferGeometry().setFromPoints(supplyPoints)
        const returnGeo = new THREE.BufferGeometry().setFromPoints(returnPoints)

        return (
          <group key={`${cracId}-${idx}`}>
            {/* Cold Supply Air Guideline */}
            <line geometry={supplyGeo}>
              <lineBasicMaterial
                color="#06b6d4"
                transparent
                opacity={0.35}
                linewidth={1.5}
              />
            </line>
            {/* Hot Return Air Guideline */}
            <line geometry={returnGeo}>
              <lineBasicMaterial
                color="#f97316"
                transparent
                opacity={0.35}
                linewidth={1.5}
              />
            </line>
          </group>
        )
      })}

      {/* 2. Instanced Cold Supply Stream Markers (Cyan) */}
      {totalSupplyMarkers > 0 && (
        <instancedMesh
          ref={supplyInstRef}
          args={[undefined, undefined, totalSupplyMarkers]}
        >
          <coneGeometry args={[1, 2, 8]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.85}
          />
        </instancedMesh>
      )}

      {/* 3. Instanced Hot Return Stream Markers (Orange) */}
      {totalReturnMarkers > 0 && (
        <instancedMesh
          ref={returnInstRef}
          args={[undefined, undefined, totalReturnMarkers]}
        >
          <coneGeometry args={[1, 2, 8]} />
          <meshBasicMaterial
            color="#fb923c"
            transparent
            opacity={0.85}
          />
        </instancedMesh>
      )}
    </group>
  )
}
