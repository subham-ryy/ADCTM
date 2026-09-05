import React, { useState } from 'react'

export default function EventPanel({ frame, isFixtureMode = false }) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (!frame) return null

  const { events = [], actions = {}, safety = {}, cooling_units = [] } = frame

  // 1. Controller Applied Actions (strictly backend-provided)
  const appliedActions = []
  if (actions.workload_moves && actions.workload_moves.length > 0) {
    actions.workload_moves.forEach((move) => {
      appliedActions.push(
        `Migrated ${move.amount.toFixed(1)} kW IT load from ${move.from_zone} → ${move.to_zone}`
      )
    })
  }
  if (actions.applied_cooling && actions.applied_cooling.length > 0) {
    actions.applied_cooling.forEach((cmd, idx) => {
      const cuId = cooling_units[idx]?.id || `CRAC-${idx + 1}`
      appliedActions.push(`Applied cooling ${cuId.toUpperCase()} = ${(cmd * 100).toFixed(0)}%`)
    })
  }

  // 2. Backend-provided Events
  const backendEvents = events.map((ev) => ({
    code: ev.code,
    severity: ev.severity,
    message: ev.message,
  }))

  // 3. Safety status
  const safetyStatus = safety.override_active
    ? `SAFETY OVERRIDE: ${safety.reasons?.join('; ') || 'Active constraints enforced'}`
    : 'Safety shield nominal (no active overrides)'

  return (
    <div
      data-testid="event-panel"
      style={{
        position: 'absolute',
        bottom: 16,
        left: 14,
        zIndex: 35,
        width: '440px',
        maxWidth: 'calc(100vw - 28px)',
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '8px',
        padding: '10px 14px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
        fontFamily: 'monospace',
        fontSize: '11px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: isCollapsed ? 'none' : '1px solid rgba(148, 163, 184, 0.2)',
          paddingBottom: isCollapsed ? '0' : '6px',
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 800, color: '#38bdf8', letterSpacing: '0.5px' }}>
            {isFixtureMode ? 'FIXTURE EVENT LOG' : 'BACKEND EVENTS & APPLIED ACTIONS'}
          </span>
          <span style={{ color: '#64748b', fontSize: '10px' }}>
            SEQ #{frame.sequence}
          </span>
        </div>
        <span style={{ color: '#94a3b8', fontSize: '10px' }}>
          {isCollapsed ? '▲ EXPAND' : '▼ COLLAPSE'}
        </span>
      </div>

      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
          {/* Backend-provided Events */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '10px' }}>
              BACKEND EVENTS:
            </span>
            {backendEvents.length > 0 ? (
              backendEvents.map((ev, i) => {
                const color =
                  ev.severity === 'CRITICAL'
                    ? '#f87171'
                    : ev.severity === 'WARNING'
                    ? '#fbbf24'
                    : '#bae6fd'
                return (
                  <div key={i} style={{ color, paddingLeft: '6px' }}>
                    • <strong style={{ color: '#ffffff' }}>[{ev.code}]</strong> {ev.message}
                  </div>
                )
              })
            ) : (
              <span style={{ color: '#64748b', fontStyle: 'italic', paddingLeft: '6px' }}>
                No active events emitted in this frame.
              </span>
            )}
          </div>

          {/* Applied Actions (strictly received from frame.actions) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: '10px' }}>
              APPLIED ACTIONS:
            </span>
            {appliedActions.length > 0 ? (
              appliedActions.map((act, i) => (
                <div key={i} style={{ color: '#d8b4fe', paddingLeft: '6px' }}>
                  • {act}
                </div>
              ))
            ) : (
              <span style={{ color: '#64748b', fontStyle: 'italic', paddingLeft: '6px' }}>
                Steady-state hold (no active workload moves).
              </span>
            )}
          </div>

          {/* Safety Assessment */}
          <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid rgba(148, 163, 184, 0.15)', paddingTop: '4px' }}>
            <span style={{ color: safety.override_active ? '#ef4444' : '#10b981', fontWeight: 800 }}>
              SAFETY:
            </span>
            <span style={{ color: safety.override_active ? '#fca5a5' : '#86efac' }}>
              {safetyStatus}
            </span>
          </div>

          {/* Fixture-only summary line (strictly excluded in live mode per data integrity rules) */}
          {isFixtureMode && (
            <div style={{ fontSize: '10px', color: '#64748b', borderTop: '1px dashed rgba(148, 163, 184, 0.2)', paddingTop: '4px' }}>
              (Offline fixture preview — no live inference)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
