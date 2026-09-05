import React from 'react'
import { useSimulationState, simulationStore } from '../../state/simulationStore'

const MODES = [
  { id: 'REALISTIC', label: 'REALISTIC', color: '#38bdf8' },
  { id: 'TEMPERATURE', label: 'TEMPERATURE', color: '#f97316' },
  { id: 'WORKLOAD', label: 'WORKLOAD', color: '#818cf8' },
  { id: 'POWER', label: 'POWER', color: '#10b981' },
]

export default function ViewToggle() {
  const { viewMode } = useSimulationState()

  return (
    <div
      style={{
        position: 'absolute',
        top: 86,
        right: 20,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.92)',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        borderRadius: '8px',
        padding: '4px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        gap: '2px',
      }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '10px',
          fontWeight: 700,
          color: '#64748b',
          letterSpacing: '1px',
          padding: '0 10px',
          textTransform: 'uppercase',
        }}
      >
        VIEW:
      </div>

      {MODES.map((m) => {
        const isActive = viewMode === m.id
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => simulationStore.setViewMode(m.id)}
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: isActive ? 700 : 500,
              letterSpacing: '0.5px',
              padding: '6px 14px',
              borderRadius: '5px',
              border: isActive
                ? `1px solid ${m.color}`
                : '1px solid transparent',
              background: isActive
                ? 'rgba(30, 41, 59, 0.9)'
                : 'transparent',
              color: isActive ? m.color : '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
