import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelemetryAdapter, adaptBackendFrame } from '../liveTelemetry'
import { decisionFor, recentActivity, thermalBands } from '../../components/console/presentation'

function wire(step = 1) {
  return { step, timestamp: 1000, temperatures: [22, 23, 24, 25, 26], workloads: [.3, .5, .4, .2, .4],
    cooling: [0, .2, .3, .4, .5], cooling_capacity: [1, 1, 1, .6, 1], ambient_temp: 30,
    power: { it_power_kw: 18, cooling_power_kw: 4, overhead_kw: .9, total_power_kw: 22.9 },
    pue: 1.272222, cumulative_pue: 1.25, energy: { total_facility_energy_kwh: 3.7 },
    sla: { sla_uptime_pct: 100, operational_violations: 0, emergency_violations: 0 }, risk: 'NORMAL', max_temp: 26,
    controller_action: { cooling: [0, .2, .3, .8, .5], from_zone: 3, to_zone: 1, move_fraction: .1 },
    applied_action: { cooling: [0, .2, .3, .4, .5], from_zone: 3, to_zone: 1, move_fraction: .1 },
    shield_info: { corrections_applied: 1, zone_corrections: ['none', 'none', 'none', 'floored_low', 'none'], move_rejected: false },
    migration: { from_zone: 3, to_zone: 1, amount: .025 }, events: ['MIGRATION: Zone 3 -> Zone 1 (0.0250)'], done: false }
}
const frame = (step = 1, id = 'a') => adaptBackendFrame(wire(step), id, 'running', 'cooling_failure', 'joint_rl')
const instances = []
function adapter(mode = 'live') { const a = new TelemetryAdapter({ mode, autoConnect: false }); instances.push(a); return a }
afterEach(() => { instances.splice(0).forEach((a) => a.destroy()); vi.restoreAllMocks(); vi.useRealTimers() })

describe('Backend telemetry fidelity', () => {
  it('maps all five cooling units to stable zone ids, including a derated unit', () => {
    const f = frame()
    expect(f.cooling_units).toHaveLength(5)
    expect(f.cooling_units[3]).toMatchObject({ zone_id: 'zone-04', available_capacity: .6, status: 'DERATED' })
    expect(f.zones[0].cooling).toBe(0)
    expect(f.metrics.pue).toBe(wire().pue)
    expect(f.risk).toBe('NORMAL')
  })
  it('keeps migration units as utilization and exposes the true source/destination', () => {
    expect(frame().actions.workload_moves[0]).toMatchObject({ from_zone: 'zone-04', to_zone: 'zone-02', amount: .025, amount_unit: 'utilization' })
    expect(recentActivity([frame()])[0].text).toContain('2.5 percentage points')
  })
  it('recognizes correction counts and separates proposed from applied cooling', () => {
    const f = frame()
    expect(f.safety.override_active).toBe(true)
    expect(f.actions.proposed_cooling[3]).toBe(.8)
    expect(f.actions.applied_cooling[3]).toBe(.4)
    expect(f.safety.reasons).toEqual(['Zone D: overcool protection'])
  })
  it('never substitutes placeholder power, PUE, or zone measurements', () => {
    const d = wire(); d.power = {}; delete d.pue
    const f = adaptBackendFrame(d)
    expect(f.metrics.pue).toBeNull()
    expect(f.metrics.total_power_kw).toBeNull()
    expect(f.zones[0].it_power_kw).toBeNull()
    expect(f.zones[0].cooling_effect_kw).toBeNull()
    expect(adaptBackendFrame({ step: 1 })).toBeNull()
  })
  it('does not animate a rejected or absent migration', () => {
    const d = wire(); d.migration = null; d.shield_info.move_rejected = true
    expect(adaptBackendFrame(d).actions.workload_moves).toEqual([])
    expect(adaptBackendFrame(d).safety.move_rejected).toBe(true)
  })
  it('uses backend thresholds and limits temperature deltas to one run', () => {
    const config = { thresholds: { target_temp_high: 27, operational_max_temperature_c: 35, critical_temp: 40, emergency_max_temperature_c: 45 } }
    expect(thermalBands(config).map((b) => b.max)).toEqual([27, 35, 40, 45, Infinity])
    expect(decisionFor(frame(2), frame(1, 'different')).thermalDelta).toBeNull()
    const f = frame(2); f.metrics.max_temperature_c = 25
    expect(decisionFor(f, frame(1)).thermalDelta).toBe(-1)
  })
})

describe('Run lifecycle and connection recovery', () => {
  it('clears chart history when adopting a second run and rejects retired-run frames', () => {
    const a = adapter()
    a.adoptRun({ run_id: 'a', status: 'running', scenario: 'normal', controller: 'joint_rl', telemetry: wire(200) })
    a.adoptRun({ run_id: 'b', status: 'created', scenario: 'ambient_heat', controller: 'rule_based', telemetry: null })
    expect(a.frameHistory).toEqual([]); expect(a.currentFrame).toBeNull()
    expect(a.applyFrame(frame(201, 'a'))).toBe(false)
    a.handleMessage({ type: 'telemetry', run_id: 'b', data: wire(1) })
    expect(a.currentFrame.scenario).toBe('HEATWAVE')
    expect(a.currentFrame.controller).toBe('RULE_BASED')
    expect(a.frameHistory).toHaveLength(1)
  })
  it('handles websocket handshake, pause, and completion using authoritative run state', () => {
    const a = adapter()
    a.handleMessage({ type: 'connected', data: { run: { run_id: 'a', status: 'paused', controller: 'joint_rl', scenario: 'normal', telemetry: wire() } } })
    expect(a.currentFrame.run_state).toBe('PAUSED')
    a.handleMessage({ type: 'run_state', run_id: 'a', data: { status: 'running' } })
    a.handleMessage({ type: 'telemetry', run_id: 'a', data: { ...wire(2), done: true } })
    expect(a.currentFrame.run_state).toBe('COMPLETED')
    expect(a.run.status).toBe('completed')
  })
  it('rejects out-of-order frames and bounds history', () => {
    const a = adapter(); a.maxHistory = 3
    for (let i = 1; i <= 5; i++) a.applyFrame(frame(i))
    expect(a.applyFrame(frame(4))).toBe(false)
    expect(a.frameHistory.map((f) => f.sequence)).toEqual([3, 4, 5])
  })
  it('marks stale running telemetry and refetches a snapshot', () => {
    vi.useFakeTimers(); const a = adapter(); const fetch = vi.spyOn(a, 'fetchCurrentSnapshot').mockResolvedValue()
    a.connectionState = 'LIVE'; a.applyFrame(frame())
    vi.advanceTimersByTime(5001)
    expect(a.connectionState).toBe('STALE'); expect(fetch).toHaveBeenCalledOnce()
    expect(a.mode).toBe('live')
  })
  it('resnapshots on reconnect and never switches to fixtures', () => {
    vi.useFakeTimers(); const a = adapter()
    const snap = vi.spyOn(a, 'fetchCurrentSnapshot').mockResolvedValue()
    vi.spyOn(a, 'fetchConfig').mockResolvedValue(); const connect = vi.spyOn(a, 'connectWebSocket').mockImplementation(() => {})
    a.scheduleReconnect(); expect(a.connectionState).toBe('RECONNECTING')
    vi.advanceTimersByTime(1000); expect(snap).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce(); expect(a.mode).toBe('live')
  })
  it('exposes rejected commands and does not optimistically mutate a run', async () => {
    const a = adapter(); a.adoptRun({ run_id: 'a', status: 'running', scenario: 'normal', controller: 'joint_rl', telemetry: wire() })
    vi.spyOn(a, 'request').mockRejectedValue(new Error('Offline'))
    await expect(a.sendCommand({ command: 'pause' })).rejects.toThrow('Offline')
    expect(a.commandStatus.state).toBe('rejected'); expect(a.currentFrame.run_state).toBe('RUNNING')
  })
  it('sends the visible scenario settings and correct seed to the API', async () => {
    const a = adapter(); const request = vi.spyOn(a, 'request').mockResolvedValue({ run_id: 'b', status: 'created', scenario: 'cooling_failure', controller: 'joint_rl', telemetry: null })
    const custom = { zone_index: 3, trigger_step: 12, reduced_capacity: .6 }
    await a.startNewRun({ scenario: 'FAILURE', controller: 'JOINT_RL', seed: 42, step_rate_hz: .5, custom_failure: custom })
    expect(request).toHaveBeenCalledWith('/runs', expect.objectContaining({ scenario: 'cooling_failure', seed: 42, step_rate_hz: .5, custom_failure: custom }))
  })
})
