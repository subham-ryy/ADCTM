import React, { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * ServerUnitStack renders the 14 server slots inside the 42U rack:
 * - Active Compute & Storage servers with mounting ears, bezels, and LEDs
 * - Solid matte blanking panels for airflow containment
 * - Highly optimized using InstancedMesh (4 draw calls total)
 *
 * @param {number} workload - Current rack workload % (controls LED pulsing rate)
 * @param {number} seed - Variation seed
 */
export default function ServerUnitStack({ workload = 50, seed = 1 }) {
  const chassisInstRef = useRef()
  const bezelInstRef = useRef()
  const earsInstRef = useRef()
  const ledsInstRef = useRef()

  // 14 server unit positions with varied server types and blanking panels
  const serverSlots = useMemo(() => {
    const slots = []
    let currentY = 0.16
    const plan = [
      { u: 2, type: 'storage' },
      { u: 2, type: 'storage' },
      { u: 1, type: 'compute' },
      { u: 1, type: 'compute' },
      { u: 1, type: 'blank' }, // 1U blanking panel
      { u: 2, type: 'compute' },
      { u: 1, type: 'compute' },
      { u: 1, type: 'storage' },
      { u: 1, type: 'blank' }, // 1U blanking panel
      { u: 2, type: 'compute' },
      { u: 1, type: 'compute' },
      { u: 2, type: 'storage' },
      { u: 1, type: 'blank' }, // 1U blanking panel
      { u: 1, type: 'compute' },
    ]

    plan.forEach((item, idx) => {
      const uHeight = item.u * 0.044
      const y = currentY + uHeight / 2
      slots.push({
        y,
        uHeight,
        type: item.type,
        phase: (seed * 11 + idx * 3.7) % (Math.PI * 2),
      })
      currentY += uHeight + 0.005
    })
    return slots
  }, [seed])

  const activeServers = useMemo(
    () => serverSlots.filter((s) => s.type !== 'blank'),
    [serverSlots]
  )

  const count = serverSlots.length
  const activeCount = activeServers.length

  // Pre-compute instance transformation matrices
  useEffect(() => {
    if (!chassisInstRef.current) return

    const dummy = new THREE.Object3D()

    // 1. Chassis / Blanking Panel bodies
    serverSlots.forEach((slot, i) => {
      dummy.position.set(0, slot.y, -0.41 + 0.38)
      dummy.scale.set(0.46, slot.uHeight - 0.004, 0.8)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      chassisInstRef.current.setMatrixAt(i, dummy.matrix)
    })
    chassisInstRef.current.instanceMatrix.needsUpdate = true

    // 2. Bezel / Faceplate instances
    serverSlots.forEach((slot, i) => {
      dummy.position.set(0, slot.y, 0.385)
      dummy.scale.set(0.44, slot.uHeight - 0.006, 0.012)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      bezelInstRef.current.setMatrixAt(i, dummy.matrix)
    })
    bezelInstRef.current.instanceMatrix.needsUpdate = true

    // 3. Mounting Ears instances (Left & Right pairs for active servers)
    activeServers.forEach((slot, i) => {
      // Left ear
      dummy.position.set(-0.23, slot.y, 0.388)
      dummy.scale.set(0.02, slot.uHeight - 0.006, 0.008)
      dummy.updateMatrix()
      earsInstRef.current.setMatrixAt(i * 2, dummy.matrix)

      // Right ear
      dummy.position.set(0.23, slot.y, 0.388)
      dummy.scale.set(0.02, slot.uHeight - 0.006, 0.008)
      dummy.updateMatrix()
      earsInstRef.current.setMatrixAt(i * 2 + 1, dummy.matrix)
    })
    earsInstRef.current.instanceMatrix.needsUpdate = true

    // 4. Status LEDs (3 LEDs per active server)
    activeServers.forEach((slot, i) => {
      // Power LED (Green)
      dummy.position.set(-0.19, slot.y + 0.006, 0.395)
      dummy.scale.set(0.003, 0.003, 0.003)
      dummy.updateMatrix()
      ledsInstRef.current.setMatrixAt(i * 3, dummy.matrix)
      ledsInstRef.current.setColorAt(i * 3, new THREE.Color('#22c55e'))

      // Network Activity LED (Cyan)
      dummy.position.set(-0.178, slot.y + 0.006, 0.395)
      dummy.updateMatrix()
      ledsInstRef.current.setMatrixAt(i * 3 + 1, dummy.matrix)
      ledsInstRef.current.setColorAt(i * 3 + 1, new THREE.Color('#38bdf8'))

      // Disk Activity LED (Amber/Blue)
      dummy.position.set(-0.166, slot.y + 0.006, 0.395)
      dummy.updateMatrix()
      ledsInstRef.current.setMatrixAt(i * 3 + 2, dummy.matrix)
      ledsInstRef.current.setColorAt(
        i * 3 + 2,
        new THREE.Color(slot.type === 'storage' ? '#f59e0b' : '#38bdf8')
      )
    })
    ledsInstRef.current.instanceMatrix.needsUpdate = true
    if (ledsInstRef.current.instanceColor) {
      ledsInstRef.current.instanceColor.needsUpdate = true
    }
  }, [serverSlots, activeServers])

  // Workload Visualization: Animate the server LEDs
  const netColor = useMemo(() => new THREE.Color('#38bdf8'), [])
  const dimColor = useMemo(() => new THREE.Color('#0c2d48'), [])

  useFrame(({ clock }) => {
    if (!ledsInstRef.current || !ledsInstRef.current.instanceColor) return

    const t = clock.getElapsedTime()
    // Workload speed multiplier: high workload = faster pulse & activity
    const speedMult = 3.5 + (workload / 100) * 11.0

    activeServers.forEach((slot, i) => {
      const netIdx = i * 3 + 1
      const pulse = Math.sin(t * speedMult + slot.phase)
      const isActive = pulse > 0.05
      ledsInstRef.current.setColorAt(netIdx, isActive ? netColor : dimColor)
    })

    ledsInstRef.current.instanceColor.needsUpdate = true
  })

  return (
    <group>
      {/* 1. Instanced Server Chassis */}
      <instancedMesh
        ref={chassisInstRef}
        args={[undefined, undefined, count]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#22272e" roughness={0.4} metalness={0.65} />
      </instancedMesh>

      {/* 2. Instanced Front Faceplates & Blanking Panels */}
      <instancedMesh
        ref={bezelInstRef}
        args={[undefined, undefined, count]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#1a1e24" roughness={0.45} metalness={0.55} />
      </instancedMesh>

      {/* 3. Instanced Mounting Ears */}
      <instancedMesh
        ref={earsInstRef}
        args={[undefined, undefined, activeCount * 2]}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#64748b" roughness={0.25} metalness={0.85} />
      </instancedMesh>

      {/* 4. Instanced Status LEDs */}
      <instancedMesh
        ref={ledsInstRef}
        args={[undefined, undefined, activeCount * 3]}
      >
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
