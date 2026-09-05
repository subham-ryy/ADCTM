import React, { useState } from 'react'
import { SCENARIOS, CONTROLLERS, RUN_STATES } from '../../api/telemetryContract.js'

export default function RunScenarioControls({
  telemetryState,
  onSendCommand,
  onStartNewRun,
}) {
  const { frame, commandStatus } = telemetryState
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS.NORMAL)
  const selectedController = CONTROLLERS.JOINT_RL

  const isRunning = frame?.run_state === RUN_STATES.RUNNING
  const isPaused = frame?.run_state === RUN_STATES.PAUSED
  const isTerminated =
    frame?.run_state === RUN_STATES.COMPLETED ||
    frame?.run_state === RUN_STATES.FAILED

  const handlePauseResume = async () => {
    if (isRunning) {
      await onSendCommand({ action: 'PAUSE' })
    } else if (isPaused) {
      await onSendCommand({ action: 'RESUME' })
    }
  }

  const handleScenarioChange = async (scenario) => {
    setSelectedScenario(scenario)
    await onSendCommand({ action: 'SET_SCENARIO', scenario })
  }

  const handleStartSecondRun = async () => {
    await onStartNewRun({
      scenario: selectedScenario,
      controller: selectedController,
    })
  }

  const statusBadge = {
    idle: { label: 'READY', bg: 'rgba(51, 65, 85, 0.5)', text: '#94a3b8' },
    pending: { label: 'PENDING...', bg: 'rgba(234, 179, 8, 0.2)', text: '#fde047' },
    accepted: { label: 'ACCEPTED ✓', bg: 'rgba(34, 197, 94, 0.2)', text: '#4ade80' },
    rejected: { label: 'REJECTED ✗', bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171' },
  }[commandStatus?.state] || { label: 'IDLE', bg: 'transparent', text: '#94a3b8' }

  return (
    <div
      data-testid="run-scenario-controls"
      style={{
        position: 'absolute',
        top: 86,
        left: 14,
        zIndex: 35,
        background: 'rgba(15, 23, 42, 0.94)',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '8px',
        padding: '10px 14px',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '480px',
        fontFamily: 'monospace',
      }}
    >
      {/* Title & Command Ack indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.5px' }}>
          RUN & SCENARIO CONTROLLER
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: '#64748b' }}>CMD:</span>
          <span
            data-testid="command-status-badge"
            style={{
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 700,
              background: statusBadge.bg,
              color: statusBadge.text,
            }}
          >
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* Scenario Buttons */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {Object.values(SCENARIOS).map((sc) => {
          const isActive = frame?.scenario === sc
          return (
            <button
              key={sc}
              data-testid={`scenario-btn-${sc}`}
              disabled={commandStatus?.state === 'pending'}
              onClick={() => handleScenarioChange(sc)}
              style={{
                background: isActive ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
                color: isActive ? '#ffffff' : '#cbd5e1',
                border: isActive ? '1px solid #38bdf8' : '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '4px',
                padding: '5px 10px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: commandStatus?.state === 'pending' ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {sc === 'FAILURE' ? '⚡ CRAC TRIP' : sc}
            </button>
          )
        })}
      </div>

      {/* Primary Execution Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
        {/* Pause / Resume Button */}
        <button
          data-testid="pause-resume-btn"
          disabled={isTerminated || commandStatus?.state === 'pending'}
          onClick={handlePauseResume}
          style={{
            flex: 1,
            background: isPaused ? '#10b981' : isRunning ? '#f59e0b' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 800,
            cursor: isTerminated || commandStatus?.state === 'pending' ? 'not-allowed' : 'pointer',
            opacity: isTerminated ? 0.5 : 1,
          }}
        >
          {isPaused ? '▶ RESUME RUN' : isRunning ? '⏸ PAUSE' : 'RUN'}
        </button>

        {/* Start Second Run / Reset Button — ALWAYS ENABLED EVEN WHEN COMPLETED OR FAILED */}
        <button
          data-testid="start-second-run-btn"
          disabled={commandStatus?.state === 'pending'}
          onClick={handleStartSecondRun}
          style={{
            flex: 1.2,
            background: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 800,
            cursor: commandStatus?.state === 'pending' ? 'not-allowed' : 'pointer',
          }}
        >
          {isTerminated ? '🔄 START NEW RUN' : '⚡ RESTART RUN'}
        </button>
      </div>

      {/* Error display if command was rejected */}
      {commandStatus?.state === 'rejected' && (
        <div
          data-testid="command-error-msg"
          style={{
            fontSize: '10px',
            color: '#f87171',
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          Command Rejected: {commandStatus.error || 'Backend communication error'}
        </div>
      )}
    </div>
  )
}
