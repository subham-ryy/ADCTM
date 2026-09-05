import React, { useEffect } from 'react'
import {
  useSimulationState,
  simulationStore,
  CAUSAL_STEPS,
  getTemperatureColor,
} from '../../state/simulationStore'

/**
 * CausalChainOverlay visualizes the complete end-to-end operational loop:
 * REAL-WORLD EVENT -> USERS -> REQUESTS -> SERVER LOAD -> POWER -> HEAT -> TEMPERATURE -> RL AGENT -> COOLING OPTIMIZED -> TEMPERATURE STABILIZES
 */
export default function CausalChainOverlay() {
  const {
    causalMode,
    causalStep,
    causalPlaying,
    racks,
    facility,
  } = useSimulationState()

  // Auto-play timer when in playing mode
  useEffect(() => {
    if (!causalMode || !causalPlaying) return

    const interval = setInterval(() => {
      simulationStore.nextCausalStep()
    }, 3200)

    return () => clearInterval(interval)
  }, [causalMode, causalPlaying])

  if (!causalMode) return null

  const currentStep = CAUSAL_STEPS[causalStep] || CAUSAL_STEPS[0]
  const peakTemp = Math.max(...racks.map((r) => r.temp)).toFixed(1)
  const avgWorkload = Math.round(
    racks.reduce((acc, r) => acc + r.workload, 0) / (racks.length || 1)
  )

  return (
    <aside
      aria-label="Causal Event Simulation Timeline"
      style={{
        position: 'absolute',
        bottom: 50,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        width: 'min(1180px, 94vw)',
        background: 'rgba(15, 23, 42, 0.96)',
        border: `1px solid ${currentStep.color}60`,
        borderRadius: '12px',
        padding: '14px 20px',
        backdropFilter: 'blur(20px)',
        boxShadow: `0 20px 48px rgba(0, 0, 0, 0.65), 0 0 24px ${currentStep.color}25`,
        color: '#e2e8f0',
        fontFamily: 'sans-serif',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
    >
      {/* 1. Header Bar: Title, Stage Badge & Playback Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          paddingBottom: '10px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: currentStep.color,
              boxShadow: `0 0 8px ${currentStep.color}`,
            }}
          />
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '13px',
              fontWeight: 700,
              color: '#38bdf8',
              letterSpacing: '0.8px',
            }}
          >
            AUTONOMOUS TWIN // END-TO-END CAUSAL ENGINE
          </span>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              background: `${currentStep.color}20`,
              color: currentStep.color,
              border: `1px solid ${currentStep.color}60`,
            }}
          >
            STAGE {currentStep.step + 1} OF 10
          </span>
        </div>

        {/* Playback Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => simulationStore.prevCausalStep()}
            style={{
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '5px',
              padding: '4px 10px',
              color: '#cbd5e1',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ◀ PREV
          </button>

          <button
            type="button"
            onClick={() => simulationStore.toggleCausalPlayback()}
            style={{
              background: causalPlaying
                ? 'rgba(245, 158, 11, 0.2)'
                : 'rgba(56, 189, 248, 0.2)',
              border: causalPlaying
                ? '1px solid #f59e0b'
                : '1px solid #38bdf8',
              borderRadius: '5px',
              padding: '4px 14px',
              color: causalPlaying ? '#fbbf24' : '#38bdf8',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {causalPlaying ? '⏸ PAUSE LOOP' : '▶ AUTO-PLAY'}
          </button>

          <button
            type="button"
            onClick={() => simulationStore.nextCausalStep()}
            style={{
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '5px',
              padding: '4px 10px',
              color: '#cbd5e1',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            NEXT ▶
          </button>

          <button
            type="button"
            onClick={() => simulationStore.setCausalMode(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '16px',
              cursor: 'pointer',
              marginLeft: '6px',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 2. Horizontal 10-Stage Visual Causal Stepper */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: '4px',
          marginBottom: '12px',
        }}
      >
        {CAUSAL_STEPS.map((s, idx) => {
          const isActive = idx === causalStep
          const isPassed = idx < causalStep

          return (
            <button
              key={s.step}
              type="button"
              onClick={() => simulationStore.setCausalStep(idx)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '6px 2px',
                borderRadius: '6px',
                cursor: 'pointer',
                border: isActive
                  ? `1px solid ${s.color}`
                  : isPassed
                  ? '1px solid rgba(148, 163, 184, 0.3)'
                  : '1px solid rgba(148, 163, 184, 0.1)',
                background: isActive
                  ? `${s.color}25`
                  : isPassed
                  ? 'rgba(30, 41, 59, 0.6)'
                  : 'rgba(15, 23, 42, 0.5)',
                transition: 'all 0.2s ease',
              }}
            >
              <span style={{ fontSize: '15px' }}>{s.icon}</span>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: isActive ? s.color : isPassed ? '#cbd5e1' : '#64748b',
                  marginTop: '4px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {s.title.split(' ')[0]}
              </span>
            </button>
          )
        })}
      </div>

      {/* 3. Live Active Stage Detail & Physics Synchronization */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: '16px',
          background: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: '8px',
          padding: '12px 16px',
        }}
      >
        {/* Left: Stage Narrative & Action Summary */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>{currentStep.icon}</span>
            <div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: currentStep.color,
                }}
              >
                {currentStep.title}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                {currentStep.subtitle}
              </div>
            </div>
          </div>

          <p
            style={{
              fontSize: '12px',
              color: '#cbd5e1',
              lineHeight: '1.45',
              marginTop: '8px',
              marginBottom: 0,
            }}
          >
            {currentStep.detail}
          </p>
        </div>

        {/* Right: Live Telemetry Metrics Chips */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px',
            alignContent: 'center',
          }}
        >
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              padding: '6px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(148, 163, 184, 0.1)',
            }}
          >
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>USERS / INGRESS</div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: 700,
                color: '#38bdf8',
                marginTop: '2px',
              }}
            >
              {currentStep.users}
            </div>
            <div style={{ fontSize: '9px', color: '#64748b' }}>
              {currentStep.requests}
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              padding: '6px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(148, 163, 184, 0.1)',
            }}
          >
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>IT POWER / LOAD</div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: 700,
                color: '#f8fafc',
                marginTop: '2px',
              }}
            >
              {facility.totalItPower.toFixed(1)} kW
            </div>
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>
              Avg Load: {avgWorkload}%
            </div>
          </div>

          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              padding: '6px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(148, 163, 184, 0.1)',
            }}
          >
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>PEAK TEMP / PUE</div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: 700,
                color: getTemperatureColor(Number(peakTemp)),
                marginTop: '2px',
              }}
            >
              {peakTemp}°C
            </div>
            <div style={{ fontSize: '9px', color: '#38bdf8' }}>
              PUE: {facility.pue.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}