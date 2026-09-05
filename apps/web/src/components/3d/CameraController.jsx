import React, { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

/**
 * CameraController provides responsive, deterministic 3D navigation:
 * - WASD & Arrow Keys: Instant, deterministic forward/backward/strafe (NO drift, NO inertia)
 * - Movement is frame-rate independent and relative to current horizontal look direction
 * - Instant stop upon key release
 * - Bounded within data center room boundaries & obstacles
 * - OrbitControls for mouse interaction with damping disabled for snappy response
 */
export default function CameraController() {
  const { camera } = useThree()
  const controlsRef = useRef()
  const keysPressed = useRef(new Set())

  // Track keyboard events deterministically
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing inside input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const code = e.code
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowLeft',
          'ArrowDown',
          'ArrowRight',
        ].includes(code)
      ) {
        keysPressed.current.add(code)
        // Prevent default browser scrolling on arrow keys / space
        if (e.key.startsWith('Arrow')) {
          e.preventDefault()
        }
      }
    }

    const handleKeyUp = (e) => {
      keysPressed.current.delete(e.code)
    }

    // Clear all keys if window loses focus (prevents sticking keys)
    const handleBlur = () => {
      keysPressed.current.clear()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Helper to check if a point is inside an axis-aligned bounding box
  const isInsideBox = (pos, minX, maxX, minZ, maxZ) => {
    return (
      pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ
    )
  }

  // Frame update: immediate, deterministic translation without inertia
  useFrame((_, delta) => {
    const keys = keysPressed.current
    if (keys.size === 0) return

    // 1. Get horizontal forward direction (ignoring vertical tilt so W/S doesn't fly into floor/ceiling)
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 0.0001) return
    forward.normalize()

    // 2. Get horizontal right strafe direction
    const right = new THREE.Vector3()
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

    // 3. Accumulate movement intent
    const move = new THREE.Vector3(0, 0, 0)
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(forward)
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward)
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right)

    if (move.lengthSq() === 0) return
    move.normalize()

    // 4. Fixed responsive movement speed (5.5 meters per second)
    const SPEED = 5.5
    const dt = Math.min(delta, 0.05) // Cap delta to avoid large jump on sudden frame drop
    const step = move.multiplyScalar(SPEED * dt)

    // 5. Test desired new position with obstacle & wall collision
    const currentPos = camera.position.clone()
    const targetPos = currentPos.clone().add(step)

    // Room boundaries clamping
    const minRoomX = -6.1
    const maxRoomX = 6.1
    const minRoomZ = -4.3
    const maxRoomZ = 6.4

    // Test X movement independently (allows sliding along obstacles)
    let nextX = targetPos.x
    if (nextX < minRoomX) nextX = minRoomX
    if (nextX > maxRoomX) nextX = maxRoomX

    // Test Z movement independently
    let nextZ = targetPos.z
    if (nextZ < minRoomZ) nextZ = minRoomZ
    if (nextZ > maxRoomZ) nextZ = maxRoomZ

    // Obstacle avoidance for major solid objects
    // Rack Row A: X in [-2.35, -1.25], Z in [-3.1, 3.1]
    // Rack Row B: X in [1.25, 2.35], Z in [-3.1, 3.1]
    // CRAC Units: X in [-6.5, -5.3], Z in [-2.9, 2.9]
    const testPos = new THREE.Vector3(nextX, currentPos.y, nextZ)
    const inRackA = isInsideBox(testPos, -2.35, -1.25, -3.1, 3.1)
    const inRackB = isInsideBox(testPos, 1.25, 2.35, -3.1, 3.1)
    const inCRAC = isInsideBox(testPos, -6.5, -5.3, -2.9, 2.9)

    if (inRackA || inRackB || inCRAC) {
      // Try sliding only along X
      const testXOnly = new THREE.Vector3(nextX, currentPos.y, currentPos.z)
      const xBlocked =
        isInsideBox(testXOnly, -2.35, -1.25, -3.1, 3.1) ||
        isInsideBox(testXOnly, 1.25, 2.35, -3.1, 3.1) ||
        isInsideBox(testXOnly, -6.5, -5.3, -2.9, 2.9)

      // Try sliding only along Z
      const testZOnly = new THREE.Vector3(currentPos.x, currentPos.y, nextZ)
      const zBlocked =
        isInsideBox(testZOnly, -2.35, -1.25, -3.1, 3.1) ||
        isInsideBox(testZOnly, 1.25, 2.35, -3.1, 3.1) ||
        isInsideBox(testZOnly, -6.5, -5.3, -2.9, 2.9)

      if (!xBlocked) {
        nextZ = currentPos.z
      } else if (!zBlocked) {
        nextX = currentPos.x
      } else {
        // Fully blocked in both directions
        nextX = currentPos.x
        nextZ = currentPos.z
      }
    }

    // Keep camera above floor
    const finalPos = new THREE.Vector3(
      nextX,
      Math.max(1.3, Math.min(3.4, currentPos.y)),
      nextZ
    )

    // Compute actual delta applied
    const actualDelta = finalPos.clone().sub(currentPos)

    // Apply translation to camera AND OrbitControls target to keep orbit center in sync
    camera.position.add(actualDelta)
    if (controlsRef.current) {
      controlsRef.current.target.add(actualDelta)
      controlsRef.current.update()
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={false} // NO floaty lag or inertia
      rotateSpeed={1.0}
      panSpeed={1.0}
      zoomSpeed={1.1}
      target={[-0.15, 1.25, -0.2]}
      minDistance={0.8}
      maxDistance={18}
      maxPolarAngle={Math.PI / 2 - 0.03}
      minPolarAngle={0.05}
    />
  )
}
