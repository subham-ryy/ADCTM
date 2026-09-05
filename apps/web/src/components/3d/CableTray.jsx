import React, { useMemo } from 'react'
import * as THREE from 'three'

/**
 * CableTray represents an authentic overhead industrial wire-mesh ladder cable pathway.
 * Features:
 * - Galvanized metallic basket tray with longitudinal rails and cross rungs.
 * - Suspended from ceiling via distinct threaded drop rods and unistrut trapeze brackets.
 * - Realistic bundled flexible cables (Cat6 blue data, fiber yellow, black power) using TubeGeometry.
 * - Natural catenary sag and subtle lateral wave across support spans.
 * - Periodic structured cabling velcro ties.
 * - Clean curved cable drops branching down into the top-rear of server racks.
 *
 * @param {Array} position - [x, y, z] center position
 * @param {number} length - Span length along Z axis (meters)
 * @param {number} width - Tray width (meters, default 0.45m)
 * @param {number} ceilingY - Ceiling height to anchor suspension rods (default 3.6m)
 * @param {number} dropDirection - -1 for Row A (drops toward -X rear), +1 for Row B (drops toward +X rear)
 * @param {Array} rackDrops - Array of Z coordinates for rack drops (e.g. [-2.4, 0, 2.4])
 * @param {number} rackTopY - World Y coordinate of the server rack roof (default 2.15m)
 */
export default function CableTray({
  position = [0, 3.25, 0],
  length = 8,
  width = 0.45,
  ceilingY = 3.6,
  dropDirection = -1,
  rackDrops = [-2.4, 0, 2.4],
  rackTopY = 2.15,
}) {
  const [posX, posY, posZ] = position
  const halfLength = length / 2
  const rungSpacing = 0.35
  const rungCount = Math.floor(length / rungSpacing)

  // Suspension rod height: spans from tray up to ceiling
  const rodHeight = Math.max(0.1, ceilingY - posY)
  const rodCenterY = rodHeight / 2

  // Relative drop delta Y down to the rack top
  const dropDeltaY = rackTopY - posY // e.g. 2.15 - 3.25 = -1.10m
  const dropTargetX = dropDirection * (width / 2 + 0.14) // Aligns with rear top cable cutout of the rack

  // =========================================================================
  // 1. GENERATE REALISTIC FLEXIBLE HORIZONTAL RUN CABLES (TubeGeometry)
  // =========================================================================
  const horizontalCables = useMemo(() => {
    // 7 sample nodes along Z span to model natural catenary sag and subtle weaving
    const zNodes = [
      -halfLength + 0.1,
      -halfLength * 0.65,
      -halfLength * 0.32,
      0,
      halfLength * 0.32,
      halfLength * 0.65,
      halfLength - 0.1,
    ]

    // Helper to generate a curved CatmullRom spline with subtle sag & lateral wave
    const createSpline = (baseX, baseY, radius, sagAmp, waveAmp, phase) => {
      const points = zNodes.map((z, idx) => {
        // Natural catenary sag between supports: dips every ~1.6m
        const sag = Math.sin((z + halfLength) * 2.0 + phase) * sagAmp
        const wave = Math.cos((z + halfLength) * 1.5 + phase) * waveAmp
        return new THREE.Vector3(baseX + wave, baseY - Math.abs(sag), z)
      })
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25)
      return { curve, radius }
    }

    // A. BLUE HIGH-DENSITY Cat6 DATA CABLE BUNDLE (4 distinct thin cables)
    const blueCables = [
      createSpline(-0.13, 0.012, 0.0075, 0.006, 0.005, 0.0),
      createSpline(-0.10, 0.004, 0.0070, 0.007, 0.004, 1.2),
      createSpline(-0.07, 0.009, 0.0075, 0.005, 0.006, 2.4),
      createSpline(-0.10, 0.016, 0.0070, 0.006, 0.005, 3.6),
    ]

    // B. YELLOW SINGLE-MODE OPTICAL FIBER TRUNK BUNDLE (2 thin cables)
    const yellowCables = [
      createSpline(-0.01, 0.006, 0.0060, 0.005, 0.004, 0.8),
      createSpline(0.025, 0.009, 0.0060, 0.005, 0.005, 1.9),
    ]

    // C. DARK INDUSTRIAL POWER / UTILITY BUNDLE (2 cables)
    const darkCables = [
      createSpline(0.09, 0.008, 0.010, 0.004, 0.003, 0.4),
      createSpline(0.13, 0.006, 0.010, 0.005, 0.004, 1.6),
    ]

    return { blueCables, yellowCables, darkCables }
  }, [halfLength])

  // =========================================================================
  // 2. GENERATE REALISTIC COMPACT CURVED DROPS TO SERVER RACKS
  // =========================================================================
  const rackDropBundles = useMemo(() => {
    return rackDrops.map((rackZ) => {
      // Create a smooth, authentic vertical drop without any overshoot:
      // Flows out of tray over waterfall bracket -> drops down vertical ladder -> enters rack top brush
      const createDropCurve = (zOffset) => {
        const p0 = new THREE.Vector3(
          dropDirection * (width / 2 - 0.05),
          0.012,
          rackZ - 0.18 + zOffset
        )
        const p1 = new THREE.Vector3(
          dropDirection * (width / 2 - 0.01),
          0.005,
          rackZ - 0.08 + zOffset
        )
        const p2 = new THREE.Vector3(
          dropDirection * (width / 2 + 0.04),
          -0.06,
          rackZ + zOffset
        )
        const p3 = new THREE.Vector3(
          dropTargetX,
          -0.55,
          rackZ + zOffset
        )
        const p4 = new THREE.Vector3(
          dropTargetX,
          dropDeltaY,
          rackZ + zOffset
        )

        return new THREE.CatmullRomCurve3(
          [p0, p1, p2, p3, p4],
          false,
          'catmullrom',
          0.15
        )
      }

      // 2 Blue Data drops (network connections)
      const blueDrop1 = createDropCurve(-0.030)
      const blueDrop2 = createDropCurve(-0.010)

      // 1 Yellow Fiber drop (optical trunk)
      const yellowDrop = createDropCurve(0.012)

      // 1 Heavy Black Power whip (dropping directly toward rear PDU strip)
      const powerDrop = createDropCurve(0.032)

      return {
        rackZ,
        blueDrops: [blueDrop1, blueDrop2],
        yellowDrop,
        powerDrop,
      }
    })
  }, [rackDrops, dropDirection, width, dropTargetX, dropDeltaY])

  // Periodic structured cabling velcro ties along the tray
  const velcroTiePositions = useMemo(() => {
    const ties = []
    const spacing = 0.8
    for (let z = -halfLength + 0.4; z <= halfLength - 0.4; z += spacing) {
      ties.push(z)
    }
    return ties
  }, [halfLength])

  return (
    <group position={position}>
      {/* ============================================================ */}
      {/* 1. INDUSTRIAL WIRE-MESH TRAY METALLIC STRUCTURE              */}
      {/* ============================================================ */}
      {/* Left & Right Longitudinal Side Rails (Dark Galvanized Steel) */}
      <mesh position={[-width / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.018, 0.05, length]} />
        <meshStandardMaterial color="#475569" roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[width / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.018, 0.05, length]} />
        <meshStandardMaterial color="#475569" roughness={0.35} metalness={0.8} />
      </mesh>

      {/* Cross Rungs (Welded at bottom of tray) */}
      {Array.from({ length: rungCount }).map((_, i) => {
        const z = -halfLength + i * rungSpacing + rungSpacing / 2
        return (
          <mesh key={i} position={[0, -0.022, z]} receiveShadow>
            <boxGeometry args={[width - 0.01, 0.006, 0.015]} />
            <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.75} />
          </mesh>
        )
      })}

      {/* Bottom Longitudinal Wire Mesh Runners */}
      {[-0.14, -0.05, 0.05, 0.14].map((wx, wi) => (
        <mesh
          key={wi}
          position={[wx, -0.02, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <cylinderGeometry args={[0.0025, 0.0025, length, 6]} />
          <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.75} />
        </mesh>
      ))}

      {/* ============================================================ */}
      {/* 2. CEILING SUSPENSION UNISTRUT TRAPEZES & THREADED DROP RODS */}
      {/* ============================================================ */}
      {[-halfLength + 0.6, -halfLength / 2 + 0.3, 0, halfLength / 2 - 0.3, halfLength - 0.6].map(
        (sz, idx) => (
          <group key={idx} position={[0, 0, sz]}>
            {/* Unistrut horizontal trapeze support under the tray */}
            <mesh position={[0, -0.032, 0]} castShadow receiveShadow>
              <boxGeometry args={[width + 0.1, 0.016, 0.026]} />
              <meshStandardMaterial color="#334155" roughness={0.35} metalness={0.85} />
            </mesh>

            {/* Left & Right thin galvanized threaded drop rods up to ceiling */}
            {[-width / 2 - 0.035, width / 2 + 0.035].map((rx, ri) => (
              <group key={ri} position={[rx, 0, 0]}>
                {/* Thin threaded drop rod */}
                <mesh position={[0, rodCenterY, 0]}>
                  <cylinderGeometry args={[0.004, 0.004, rodHeight, 6]} />
                  <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.85} />
                </mesh>
                {/* Trapeze locking hex nut */}
                <mesh position={[0, -0.03, 0]}>
                  <cylinderGeometry args={[0.008, 0.008, 0.012, 6]} />
                  <meshStandardMaterial color="#64748b" roughness={0.3} metalness={0.9} />
                </mesh>
                {/* Ceiling anchoring plate */}
                <mesh position={[0, rodHeight, 0]}>
                  <boxGeometry args={[0.04, 0.006, 0.04]} />
                  <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.75} />
                </mesh>
              </group>
            ))}
          </group>
        )
      )}

      {/* ============================================================ */}
      {/* 3. REALISTIC FLEXIBLE HORIZONTAL RUN CABLES (TubeGeometry)   */}
      {/* ============================================================ */}
      {/* A. Blue Cat6 Network Data Cables (Matte deep enterprise blue) */}
      {horizontalCables.blueCables.map(({ curve, radius }, idx) => (
        <mesh key={`blue-horiz-${idx}`} castShadow receiveShadow>
          <tubeGeometry args={[curve, 32, radius, 6, false]} />
          <meshStandardMaterial
            color="#1d4ed8"
            roughness={0.45}
            metalness={0.1}
          />
        </mesh>
      ))}

      {/* B. Yellow Single-Mode Fiber Optic Trunk (Matte optic yellow) */}
      {horizontalCables.yellowCables.map(({ curve, radius }, idx) => (
        <mesh key={`yellow-horiz-${idx}`} castShadow receiveShadow>
          <tubeGeometry args={[curve, 32, radius, 6, false]} />
          <meshStandardMaterial
            color="#eab308"
            roughness={0.45}
            metalness={0.1}
          />
        </mesh>
      ))}

      {/* C. Black Heavy Utility / AC Power Cables (Matte rubberized black) */}
      {horizontalCables.darkCables.map(({ curve, radius }, idx) => (
        <mesh key={`dark-horiz-${idx}`} castShadow receiveShadow>
          <tubeGeometry args={[curve, 32, radius, 6, false]} />
          <meshStandardMaterial
            color="#1e293b"
            roughness={0.65}
            metalness={0.12}
          />
        </mesh>
      ))}

      {/* D. Structured Cabling Velcro Bundle Ties */}
      {velcroTiePositions.map((tz, idx) => (
        <group key={`tie-${idx}`} position={[0, 0.008, tz]}>
          {/* Blue Bundle Strap */}
          <mesh position={[-0.10, 0, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.015, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
          {/* Yellow Bundle Strap */}
          <mesh position={[0.01, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.015, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
          {/* Dark Power Bundle Strap */}
          <mesh position={[0.11, 0, 0]}>
            <cylinderGeometry args={[0.026, 0.026, 0.015, 8]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* ============================================================ */}
      {/* 4. REALISTIC COMPACT CURVED DROPS TO SERVER RACKS            */}
      {/* ============================================================ */}
      {rackDropBundles.map(({ rackZ, blueDrops, yellowDrop, powerDrop }, bIdx) => (
        <group key={`drop-bundle-${bIdx}`}>
          {/* Tray Waterfall Exit Bracket (Guides cable bend radius smoothly) */}
          <mesh
            position={[dropDirection * (width / 2 + 0.02), -0.015, rackZ - 0.04]}
            rotation={[0, 0, dropDirection * 0.35]}
          >
            <boxGeometry args={[0.05, 0.012, 0.18]} />
            <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.75} />
          </mesh>

          {/* Vertical Drop Ladder Guide (Slotted cable ladder supporting the drop) */}
          <group position={[dropTargetX + dropDirection * 0.015, dropDeltaY / 2, rackZ]}>
            {/* Left and right rails */}
            {[-0.07, 0.07].map((lz, li) => (
              <mesh key={li} position={[0, 0, lz]}>
                <boxGeometry args={[0.012, Math.abs(dropDeltaY), 0.012]} />
                <meshStandardMaterial color="#334155" roughness={0.35} metalness={0.8} />
              </mesh>
            ))}
            {/* Small rungs along the vertical ladder */}
            {[-0.4, -0.2, 0, 0.2, 0.4].map((ry, ri) => (
              <mesh key={ri} position={[0, ry, 0]}>
                <boxGeometry args={[0.01, 0.008, 0.14]} />
                <meshStandardMaterial color="#334155" roughness={0.35} metalness={0.8} />
              </mesh>
            ))}
          </group>

          {/* Velcro Straps along the vertical drop */}
          {[-0.35, -0.75].map((sy, si) => (
            <mesh key={si} position={[dropTargetX, sy, rackZ]}>
              <boxGeometry args={[0.04, 0.015, 0.12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.8} />
            </mesh>
          ))}

          {/* Top-Rear Rack Cable Entry Brush Plate */}
          <mesh position={[dropTargetX, dropDeltaY + 0.005, rackZ]}>
            <boxGeometry args={[0.10, 0.015, 0.18]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.6} />
          </mesh>

          {/* Curved Flexible Drop Cables (TubeGeometry along CatmullRom splines) */}
          {/* Blue Data Drops */}
          {blueDrops.map((dropCurve, dIdx) => (
            <mesh key={`drop-blue-${dIdx}`} castShadow>
              <tubeGeometry args={[dropCurve, 16, 0.007, 6, false]} />
              <meshStandardMaterial color="#1d4ed8" roughness={0.45} metalness={0.1} />
            </mesh>
          ))}

          {/* Yellow Fiber Drop */}
          <mesh castShadow>
            <tubeGeometry args={[yellowDrop, 16, 0.006, 6, false]} />
            <meshStandardMaterial color="#eab308" roughness={0.45} metalness={0.1} />
          </mesh>

          {/* Black Power Whip Drop */}
          <mesh castShadow>
            <tubeGeometry args={[powerDrop, 16, 0.0095, 6, false]} />
            <meshStandardMaterial color="#1e293b" roughness={0.65} metalness={0.12} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
