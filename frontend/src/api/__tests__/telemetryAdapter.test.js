import { describe, it, expect } from 'vitest'
import {
  CONNECTION_STATES,
  RUN_STATES,
  isValidTelemetryFrame,
} from '../telemetryContract.js'
import { normalFixture } from '../fixtures/normal.js'
import { coolingFailureFixture } from '../fixtures/cooling_failure.js'

describe('Telemetry Contract & Frame Validation', () => {
  it('validates a canonical telemetry frame correctly', () => {
    expect(isValidTelemetryFrame(normalFixture)).toBe(true)
    expect(isValidTelemetryFrame(coolingFailureFixture)).toBe(true)
  })

  it('rejects invalid or missing frame structures', () => {
    expect(isValidTelemetryFrame(null)).toBe(false)
    expect(isValidTelemetryFrame({})).toBe(false)
    expect(isValidTelemetryFrame({ type: 'other' })).toBe(false)
    expect(isValidTelemetryFrame({ ...normalFixture, sequence: 'not-a-number' })).toBe(false)
    expect(isValidTelemetryFrame({ ...normalFixture, zones: [] })).toBe(false)
  })

  it('preserves distinct engineering units without mixing kW and kWh', () => {
    const { metrics } = normalFixture
    expect(metrics).toHaveProperty('it_power_kw')
    expect(metrics).toHaveProperty('cooling_power_kw')
    expect(metrics).toHaveProperty('total_power_kw')
    expect(metrics).toHaveProperty('energy_used_kwh')
    expect(metrics).toHaveProperty('max_temperature_c')
    expect(metrics).toHaveProperty('pue')
    expect(metrics).toHaveProperty('sla_percent')

    // Power is in kW, energy is in kWh
    expect(typeof metrics.it_power_kw).toBe('number')
    expect(typeof metrics.energy_used_kwh).toBe('number')
    expect(metrics.energy_used_kwh).toBeGreaterThan(0)
    expect(metrics.pue).toBeGreaterThanOrEqual(1.0)
  })
})

describe('TelemetryAdapter Sequence Ordering & History', () => {
  // We dynamically test the adapter class logic
  it('strictly enforces sequence ordering and rejects out-of-order frames', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    
    // Create base frame with sequence 1000
    const frameA = { ...normalFixture, sequence: 1000, timestamp: '2026-09-05T00:00:00Z' }
    const acceptedA = telemetryAdapter.applyFrame(frameA)
    expect(acceptedA).toBe(true)
    expect(telemetryAdapter.getState().frame.sequence).toBe(1000)

    // Attempt to apply an older frame with sequence 950 (out of order)
    const olderFrame = { ...normalFixture, sequence: 950, timestamp: '2026-09-05T00:00:01Z' }
    const acceptedOld = telemetryAdapter.applyFrame(olderFrame)
    expect(acceptedOld).toBe(false)
    // State must still hold sequence 1000!
    expect(telemetryAdapter.getState().frame.sequence).toBe(1000)

    // Attempt to apply same sequence (duplicate)
    const duplicateFrame = { ...normalFixture, sequence: 1000, timestamp: '2026-09-05T00:00:02Z' }
    const acceptedDup = telemetryAdapter.applyFrame(duplicateFrame)
    expect(acceptedDup).toBe(false)
    expect(telemetryAdapter.getState().frame.sequence).toBe(1000)

    // Newer frame with sequence 1001 must be accepted
    const newerFrame = { ...normalFixture, sequence: 1001, timestamp: '2026-09-05T00:00:03Z' }
    const acceptedNew = telemetryAdapter.applyFrame(newerFrame)
    expect(acceptedNew).toBe(true)
    expect(telemetryAdapter.getState().frame.sequence).toBe(1001)
  })
})

describe('Data Mode & Reconnect Safety Boundary', () => {
  it('never automatically falls back from live mode to fixture mode on disconnect', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    
    // Simulate live mode adapter behavior
    telemetryAdapter.mode = 'live'
    telemetryAdapter.connectionState = CONNECTION_STATES.LIVE

    // Trigger disconnect/reconnect sequence
    telemetryAdapter.scheduleReconnect()

    // Must transition to RECONNECTING or DISCONNECTED, NEVER to FIXTURE
    expect(telemetryAdapter.getState().connectionState).toBe(CONNECTION_STATES.RECONNECTING)
    expect(telemetryAdapter.getState().connectionState).not.toBe(CONNECTION_STATES.FIXTURE)

    // Reset back for test cleanliness
    telemetryAdapter.mode = 'fixture'
    telemetryAdapter.connectionState = CONNECTION_STATES.FIXTURE
  })
})

describe('Command Acknowledgement & Second Run Lifecycle', () => {
  it('transitions command status through pending -> accepted', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    
    const promise = telemetryAdapter.sendCommand({ action: 'SET_SCENARIO', scenario: 'PEAK' })
    expect(telemetryAdapter.getState().commandStatus.state).toBe('pending')

    await promise
    expect(telemetryAdapter.getState().commandStatus.state).toBe('accepted')
    expect(telemetryAdapter.getState().commandStatus.command.action).toBe('SET_SCENARIO')
  })

  it('allows starting a second scenario even when current run is completed or failed', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    
    // Simulate a failed run state
    telemetryAdapter.applyFrame({
      ...normalFixture,
      sequence: 2000,
      run_state: RUN_STATES.FAILED,
    })
    expect(telemetryAdapter.getState().frame.run_state).toBe(RUN_STATES.FAILED)

    // Starting a new run must succeed and transition state
    const result = await telemetryAdapter.startNewRun({ scenario: 'FAILURE', controller: 'JOINT_RL' })
    expect(result).toBeDefined()
    expect(telemetryAdapter.getState().commandStatus.state).toBe('accepted')
  })

  it('confirms CRAC TRIP command sends canonical scenario value FAILURE', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    const { SCENARIOS } = await import('../telemetryContract.js')

    expect(SCENARIOS.FAILURE).toBe('FAILURE')

    // Dispatch CRAC TRIP scenario command
    await telemetryAdapter.sendCommand({
      action: 'SET_SCENARIO',
      scenario: SCENARIOS.FAILURE,
    })

    const state = telemetryAdapter.getState()
    expect(state.commandStatus.command.scenario).toBe('FAILURE')
    expect(state.frame.scenario).toBe('FAILURE')
  })
})

describe('Configuration & Threshold Loading', () => {
  it('loads configuration fixture with thresholds and topology in fixture mode', async () => {
    const { telemetryAdapter } = await import('../telemetryAdapter.js')
    const state = telemetryAdapter.getState()

    expect(state.config).toBeDefined()
    expect(Array.isArray(state.config.temperature_thresholds)).toBe(true)
    expect(state.config.temperature_thresholds.length).toBeGreaterThan(0)
    expect(state.config.topology).toBeDefined()
    expect(state.config.topology.zones).toHaveLength(5)
    expect(state.config.topology.cooling_units).toHaveLength(2)
  })
})

describe('3D Fallback Boundary & Explicit Failure Handlers', () => {
  it('detects WebGL availability and handles fallback gracefully', async () => {
    const { isWebGLAvailable, default: ErrorBoundary3D } = await import('../../components/3d/ErrorBoundary3D.jsx')
    
    expect(typeof isWebGLAvailable).toBe('function')

    // Test getDerivedStateFromError
    const testError = new Error('WebGL context lost')
    const state = ErrorBoundary3D.getDerivedStateFromError(testError)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(testError)
    expect(state.reason).toContain('WebGL context lost')
  })

  it('simulationStore syncFromTelemetryFrame updates racks without recalculating physics', async () => {
    const { simulationStore } = await import('../../state/simulationStore.js')
    
    // Feed authoritative frame
    simulationStore.syncFromTelemetryFrame(normalFixture)
    const state = simulationStore.getState()
    
    // Facility PUE and rack temperatures should mirror frame directly
    expect(state.facility.pue).toBe(normalFixture.metrics.pue)
    expect(state.racks[0].temp).toBe(normalFixture.zones[0].temperature_c)
    expect(state.racks[0].itPower).toBe(normalFixture.zones[0].it_power_kw)
  })

  it('triggers direct asset loader error callbacks on load failures', async () => {
    const { loadSafeTexture, loadSafeGLTF } = await import('../../components/3d/assetLoader.js')
    
    expect(typeof loadSafeTexture).toBe('function')
    expect(typeof loadSafeGLTF).toBe('function')

    let fallbackTriggered = false
    let fallbackMsg = ''
    loadSafeGLTF(null, 'test.glb', null, (reason) => {
      fallbackTriggered = true
      fallbackMsg = reason
    })

    expect(fallbackTriggered).toBe(true)
    expect(fallbackMsg).toContain('GLTF loader instance unavailable')
  })
})


