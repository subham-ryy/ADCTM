import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

import DataCenterRoom from './DataCenterRoom'
import CameraController from './CameraController'
import ViewToggle from '../ui/ViewToggle'
import InspectionPanel from '../ui/InspectionPanel'
import CausalChainOverlay from '../ui/CausalChainOverlay'
import { useSimulationState } from '../../state/simulationStore'

export default function DigitalTwinView({ isFixtureMode = false, onFallback }) {
  const simState = useSimulationState()

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 3D View Mode Selector */}
      <ViewToggle />

      {/* 3D Inspection Flyout */}
      <InspectionPanel />

      {/* Causal Chain Overlay (Isolated strictly to fixture mode) */}
      {isFixtureMode && simState?.causalMode && <CausalChainOverlay />}

      {/* 3D Navigation Footer */}
      <footer
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          borderRadius: '6px',
          padding: '6px 14px',
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#cbd5e1',
          pointerEvents: 'none',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span>Click Rack / CRAC to inspect &nbsp;|&nbsp; WASD: Walk &nbsp;|&nbsp; Drag: Orbit &nbsp;|&nbsp; Scroll: Zoom</span>
      </footer>

      {/* 3D WebGL Canvas */}
      <Canvas
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.9,
        }}
        camera={{
          fov: 48,
          position: [0.65, 1.85, 5.8],
          near: 0.1,
          far: 60,
        }}
        onCreated={({ gl }) => {
          if (gl?.domElement) {
            gl.domElement.addEventListener(
              'webglcontextlost',
              (event) => {
                event.preventDefault()
                console.warn('WebGL context lost! Explicit fallback to 2D heatmap.')
                if (onFallback) onFallback('WebGL context lost')
              },
              false
            )
          }
        }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Soft Ambient Fill */}
        <hemisphereLight skyColor="#ffffff" groundColor="#475569" intensity={0.65} />
        <ambientLight intensity={0.25} color="#ffffff" />

        {/* Directional Key Light with Soft Shadows */}
        <directionalLight
          position={[3, 14, 4]}
          intensity={0.9}
          color="#ffffff"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0001}
          shadow-normalBias={0.02}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
          shadow-camera-near={0.5}
          shadow-camera-far={25}
        />

        {/* 3D Data Center Room */}
        <Suspense fallback={null}>
          <DataCenterRoom onAssetError={onFallback} />
        </Suspense>

        {/* Deterministic Camera Controller */}
        <CameraController />
      </Canvas>
    </div>
  )
}
