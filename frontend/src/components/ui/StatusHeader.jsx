import React from 'react'
import { CONNECTION_STATES } from '../../api/telemetryContract.js'

export default function StatusHeader({
  telemetryState,
  activeView,
  onToggleView,
  enable3D = true,
}) {
  const { frame, connectionState, isFixtureMode } = telemetryState

  if (!frame) {
    return (
      <header
        className="status-header-loading"
        style={{
          position: 'absolute',
          top: 10,
          left: 14,
          right: 14,
          zIndex: 40,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          borderRadius: '8px',
          padding: '8px 16px',
          color: '#94a3b8',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8' }} />
          <span>ADCTM CONTROLLER &nbsp;|&nbsp; Connecting to telemetry stream...</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            data-testid="view-toggle-2d"
            onClick={() => onToggleView('2d')}
            style={{
              background: activeView === '2d' ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
              color: '#ffffff',
              border: activeView === '2d' ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            2D HEATMAP (P0)
          </button>
          {enable3D ? (
            <button
              data-testid="view-toggle-3d"
              onClick={() => onToggleView('3d')}
              style={{
                background: activeView === '3d' ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
                color: '#ffffff',
                border: activeView === '3d' ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '4px',
                padding: '4px 10px',
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              3D TWIN
            </button>
          ) : null}
        </div>
      </header>
    )
  }

  const { metrics, safety } = frame

  // Risk styling
  const riskColor =
    frame.safety?.override_active || frame.metrics?.max_temperature_c > 34
      ? '#ef4444'
      : frame.metrics?.max_temperature_c > 30
      ? '#f59e0b'
      : '#10b981'

  // Connection badge styling
  const connStyles = {
    [CONNECTION_STATES.LIVE]: { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', text: '#34d399', label: 'LIVE' },
    [CONNECTION_STATES.CONNECTING]: { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', text: '#fbbf24', label: 'CONNECTING' },
    [CONNECTION_STATES.RECONNECTING]: { bg: 'rgba(249, 115, 22, 0.2)', border: '#f97316', text: '#fb923c', label: 'RECONNECTING' },
    [CONNECTION_STATES.STALE]: { bg: 'rgba(234, 179, 8, 0.2)', border: '#eab308', text: '#fde047', label: 'STALE TELEMETRY' },
    [CONNECTION_STATES.DISCONNECTED]: { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#f87171', label: 'DISCONNECTED' },
    [CONNECTION_STATES.FIXTURE]: { bg: 'rgba(147, 51, 234, 0.2)', border: '#9333ea', text: '#c084fc', label: 'SIMULATED FIXTURE' },
  }[connectionState] || { bg: 'rgba(148, 163, 184, 0.2)', border: '#64748b', text: '#94a3b8', label: connectionState }

  // Run State badge color
  const runStateColor = {
    RUNNING: '#10b981',
    PAUSED: '#f59e0b',
    COMPLETED: '#3b82f6',
    FAILED: '#ef4444',
    IDLE: '#94a3b8',
  }[frame.run_state] || '#94a3b8'

  return (
    <header
      style={{
        position: 'absolute',
        top: 10,
        left: 14,
        right: 14,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* PERSISTENT FIXTURE BANNER (REQUIRED BY SPEC) */}
      {isFixtureMode && (
        <div
          data-testid="fixture-banner"
          style={{
            background: 'linear-gradient(90deg, #7e22ce, #9333ea)',
            color: '#ffffff',
            padding: '4px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '1px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(147, 51, 234, 0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚠️ SIMULATED FIXTURE</span>
            <span style={{ fontWeight: 400, opacity: 0.9 }}>
              — Operating against offline telemetry fixture. No live backend connected.
            </span>
          </div>
          <span style={{ fontSize: '10px', opacity: 0.8 }}>VITE_DATA_MODE=fixture</span>
        </div>
      )}

      {/* DISCONNECTED / STALE BANNER (IN LIVE MODE) */}
      {!isFixtureMode && connectionState !== CONNECTION_STATES.LIVE && (
        <div
          data-testid="connection-alert-banner"
          style={{
            background: connectionState === CONNECTION_STATES.STALE ? '#854d0e' : '#991b1b',
            color: '#ffffff',
            padding: '4px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            {connectionState === CONNECTION_STATES.STALE
              ? '⚠️ TELEMETRY STALE: No recent frames received. Showing last authoritative frame.'
              : `⚠️ BACKEND OFFLINE: ${connectionState}. Live mode will NEVER silently fall back to fixtures.`}
          </span>
          <span style={{ fontSize: '10px', opacity: 0.8 }}>Reconnecting with backoff...</span>
        </div>
      )}

      {/* MAIN TOP BAR */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.94)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '8px',
          padding: '8px 14px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Title & Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                backgroundColor: connStyles.border,
                boxShadow: `0 0 10px ${connStyles.border}`,
              }}
            />
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '1px',
                color: '#38bdf8',
              }}
            >
              ADCTM CONTROLLER
            </span>
          </div>

          {/* Connection state badge */}
          <span
            data-testid="connection-badge"
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'monospace',
              fontWeight: 700,
              background: connStyles.bg,
              border: `1px solid ${connStyles.border}`,
              color: connStyles.text,
            }}
          >
            {connStyles.label}
          </span>

          {/* Run state badge */}
          <span
            data-testid="run-state-badge"
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'monospace',
              fontWeight: 700,
              background: 'rgba(15, 23, 42, 0.8)',
              border: `1px solid ${runStateColor}`,
              color: runStateColor,
            }}
          >
            {frame.run_state}
          </span>

          {/* Scenario & Controller */}
          <div style={{ display: 'flex', gap: '6px', fontFamily: 'monospace', fontSize: '11px' }}>
            <span style={{ color: '#94a3b8' }}>SCENARIO:</span>
            <span style={{ color: '#f8fafc', fontWeight: 700 }}>{frame.scenario}</span>
            <span style={{ color: '#64748b' }}>|</span>
            <span style={{ color: '#94a3b8' }}>CTRL:</span>
            <span style={{ color: '#a78bfa', fontWeight: 700 }}>{frame.controller}</span>
          </div>
        </div>

        {/* Live Metrics Group */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#cbd5e1',
          }}
        >
          {/* PUE */}
          <div data-testid="metric-pue">
            <span style={{ color: '#94a3b8' }}>PUE: </span>
            <span style={{ fontWeight: 800, color: '#38bdf8', fontSize: '12px' }}>
              {metrics.pue.toFixed(2)}
            </span>
          </div>

          {/* Max Temp */}
          <div data-testid="metric-temp">
            <span style={{ color: '#94a3b8' }}>MAX TEMP: </span>
            <span style={{ fontWeight: 800, color: riskColor, fontSize: '12px' }}>
              {metrics.max_temperature_c.toFixed(1)}°C
            </span>
          </div>

          {/* IT Power */}
          <div data-testid="metric-it-power">
            <span style={{ color: '#94a3b8' }}>IT PWR: </span>
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              {metrics.it_power_kw.toFixed(1)} kW
            </span>
          </div>

          {/* Cooling Power */}
          <div data-testid="metric-cooling-power">
            <span style={{ color: '#94a3b8' }}>COOL PWR: </span>
            <span style={{ fontWeight: 700, color: '#67e8f9' }}>
              {metrics.cooling_power_kw.toFixed(1)} kW
            </span>
          </div>

          {/* Total Power */}
          <div data-testid="metric-total-power">
            <span style={{ color: '#94a3b8' }}>TOT PWR: </span>
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              {metrics.total_power_kw.toFixed(1)} kW
            </span>
          </div>

          {/* Energy Used (kWh) */}
          <div data-testid="metric-energy">
            <span style={{ color: '#94a3b8' }}>ENERGY: </span>
            <span style={{ fontWeight: 700, color: '#fde047' }}>
              {metrics.energy_used_kwh.toFixed(1)} kWh
            </span>
          </div>

          {/* SLA */}
          <div data-testid="metric-sla">
            <span style={{ color: '#94a3b8' }}>SLA: </span>
            <span style={{ fontWeight: 700, color: metrics.sla_percent >= 99 ? '#22c55e' : '#ef4444' }}>
              {metrics.sla_percent.toFixed(1)}%
            </span>
          </div>

          {/* Safety Override Alert */}
          {safety?.override_active && (
            <span
              data-testid="safety-override-badge"
              style={{
                background: '#dc2626',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 800,
                fontSize: '10px',
                animation: 'pulse 1.5s infinite',
              }}
            >
              ⚡ SAFETY SHIELD ACTIVE
            </span>
          )}
        </div>

        {/* View Switcher: 2D Heatmap (Guaranteed P0) vs 3D Digital Twin */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            data-testid="view-toggle-2d"
            onClick={() => onToggleView('2d')}
            style={{
              background: activeView === '2d' ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
              color: '#ffffff',
              border: activeView === '2d' ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '4px',
              padding: '4px 10px',
              fontFamily: 'monospace',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            2D HEATMAP (P0)
          </button>
          {enable3D ? (
            <button
              data-testid="view-toggle-3d"
              onClick={() => onToggleView('3d')}
              style={{
                background: activeView === '3d' ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
                color: '#ffffff',
                border: activeView === '3d' ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '4px',
                padding: '4px 10px',
                fontFamily: 'monospace',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              3D TWIN
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
