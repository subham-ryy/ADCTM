import React from 'react'
import { useSimulationState, simulationStore } from '../../state/simulationStore'

const SCENARIOS = [
  { id: 'NORMAL', label: 'NORMAL', tag: 'Baseline', color: '#22c55e' },
  { id: 'SPIKE', label: 'SPIKE', tag: 'Workload 95%', color: '#f59e0b' },
  { id: 'CRAC_FAIL', label: 'CRAC FAIL', tag: 'Compressor 0%', color: '#ef4444' },
  { id: 'AIRFLOW_BLOCK', label: 'BYPASS', tag: 'Airflow 60%', color: '#fb923c' },
  { id: 'RL_OPTIMIZE', label: 'RL AGENT', tag: 'Autonomous', color: '#38bdf8' },
]

export default function ScenarioBar() {
  const { activeScenario, causalMode } = useSimulationState()

  return (
    <nav
      aria-label="Simulation Scenarios"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 22,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(15, 23, 42, 0.92)',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        borderRadius: '8px',
        padding: '6px 10px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '10px',
          fontWeight: 700,
          color: '#94a3b8',
          letterSpacing: '1px',
          marginRight: '6px',
          textTransform: 'uppercase',
        }}
      >
        WHAT-IF SCENARIOS:
      </div>

      {SCENARIOS.map((sc) => {
        const isActive = !causalMode && activeScenario === sc.id

        return (
          <button
            key={sc.id}
            type="button"
            onClick={() => {
              simulationStore.setCausalMode(false)
              simulationStore.loadScenario(sc.id)
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '5px 11px',
              borderRadius: '5px',
              cursor: 'pointer',
              border: isActive
                ? `1px solid ${sc.color}`
                : '1px solid rgba(148, 163, 184, 0.15)',
              background: isActive
                ? `${sc.color}25`
                : 'rgba(30, 41, 59, 0.5)',
              color: isActive ? '#ffffff' : '#cbd5e1',
              transition: 'all 0.15s ease',
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 700,
                color: isActive ? sc.color : '#e2e8f0',
                letterSpacing: '0.5px',
              }}
            >
              {sc.label}
            </span>
            <span
              style={{
                fontSize: '9px',
                color: isActive ? '#f8fafc' : '#94a3b8',
                marginTop: '1px',
              }}
            >
              {sc.tag}
            </span>
          </button>
        )
      })}

      {/* Divider */}
      <div
        style={{
          width: '1px',
          height: '24px',
          background: 'rgba(148, 163, 184, 0.2)',
          margin: '0 4px',
        }}
      />

      {/* Causal Chain Story Mode Trigger Button */}
      <button
        type="button"
        onClick={() => simulationStore.setCausalMode(!causalMode)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '5px 12px',
          borderRadius: '5px',
          cursor: 'pointer',
          border: causalMode
            ? '1px solid #38bdf8'
            : '1px solid rgba(56, 189, 248, 0.4)',
          background: causalMode
            ? 'rgba(56, 189, 248, 0.25)'
            : 'rgba(14, 165, 233, 0.12)',
          color: '#ffffff',
          boxShadow: causalMode ? '0 0 12px rgba(56, 189, 248, 0.4)' : 'none',
          transition: 'all 0.15s ease',
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            fontWeight: 700,
            color: '#38bdf8',
            letterSpacing: '0.5px',
          }}
        >
          🌍 CAUSAL LOOP
        </span>
        <span
          style={{
            fontSize: '9px',
            color: '#94a3b8',
            marginTop: '1px',
          }}
        >
          10-Stage Event
        </span>
      </button>
    </nav>
  )
}
