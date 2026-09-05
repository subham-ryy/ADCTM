import { useSyncExternalStore } from 'react'
import { CONNECTION_STATES, isValidTelemetryFrame } from './telemetryContract.js'
import { getFixture, configFixture } from './fixtures/index.js'

const MODE = import.meta.env.VITE_DATA_MODE || 'live'
const API = import.meta.env.VITE_API_BASE_URL || ''
const WS = import.meta.env.VITE_WS_URL || (typeof location !== 'undefined' ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/stream` : '')
const number = (value) => Number.isFinite(value) ? value : null
export const zoneId = (i) => `zone-${String(i + 1).padStart(2, '0')}`
export const scenarioName = (v = '') => ({ COOLING_FAILURE: 'FAILURE', PEAK_LOAD: 'PEAK', AMBIENT_HEAT: 'HEATWAVE' }[v.toUpperCase()] || v.toUpperCase())

// Transport adaptation only. Unreported measurements stay unavailable; no browser physics.
export function adaptBackendFrame(data, runId = 'current', runState = 'RUNNING', scenario = 'NORMAL', controller = 'JOINT_RL') {
  if (!data || typeof data !== 'object') return null
  if (data.type === 'telemetry.frame') return data
  if (!Array.isArray(data.temperatures) || data.temperatures.length !== 5 || !data.temperatures.every(Number.isFinite) ||
      !Array.isArray(data.workloads) || data.workloads.length !== 5 || !data.workloads.every(Number.isFinite) || !Number.isFinite(data.step)) return null
  const shield = data.shield_info || {}
  const cooling = data.applied_action?.cooling || data.cooling || []
  const capacity = data.cooling_capacity || []
  const move = data.migration
  const power = data.power || {}
  const sla = data.sla || {}
  return {
    type: 'telemetry.frame', schema_version: '1.0.0', run_id: runId,
    sequence: data.step, timestamp: Number.isFinite(data.timestamp) ? new Date(data.timestamp * 1000).toISOString() : null,
    simulation_time_s: data.step * 300, run_state: data.done ? 'COMPLETED' : runState.toUpperCase(),
    scenario: scenarioName(scenario), controller: controller.toUpperCase(),
    ambient_temp: number(data.ambient_temp), risk: data.risk || 'UNAVAILABLE',
    metrics: {
      pue: number(data.pue), cumulative_pue: number(data.cumulative_pue),
      it_power_kw: number(power.it_power_kw), cooling_power_kw: number(power.cooling_power_kw),
      other_power_kw: number(power.overhead_kw), total_power_kw: number(power.total_power_kw),
      energy_used_kwh: number(data.energy?.total_facility_energy_kwh),
      max_temperature_c: number(data.max_temp), sla_percent: number(sla.sla_uptime_pct),
      sla_violations: number(sla.operational_violations), emergency_violations: number(sla.emergency_violations),
    },
    zones: data.temperatures.map((t, i) => ({
      id: zoneId(i), label: `Zone ${String.fromCharCode(65 + i)}`, temperature_c: t,
      utilization: number(data.workloads[i]), cooling: number(cooling[i]), capacity: number(capacity[i]),
      it_power_kw: null, cooling_effect_kw: null, risk: null,
    })),
    cooling_units: capacity.map((cap, i) => ({
      id: `cooling-${i + 1}`, zone_id: zoneId(i), label: `Cooling ${String.fromCharCode(65 + i)}`,
      command: number(cooling[i]), available_capacity: number(cap),
      status: cap === 0 ? 'FAILED' : cap < 1 ? 'DERATED' : 'AVAILABLE',
    })),
    actions: {
      proposed_cooling: data.controller_action?.cooling || [], applied_cooling: cooling,
      proposed_move: data.controller_action || null,
      workload_moves: move && move.amount > 0 && move.from_zone !== move.to_zone ? [{
        from_zone: zoneId(move.from_zone), to_zone: zoneId(move.to_zone), amount: move.amount,
        amount_unit: 'utilization', source_fraction: number(data.applied_action?.move_fraction),
      }] : [],
    },
    safety: {
      override_active: (shield.corrections_applied || 0) > 0,
      corrections_applied: shield.corrections_applied || 0,
      zone_corrections: shield.zone_corrections || [], move_rejected: !!shield.move_rejected,
      reasons: (shield.zone_corrections || []).flatMap((s, i) => s === 'none' ? [] : [`Zone ${String.fromCharCode(65 + i)}: ${s === 'capped_high' ? 'emergency cooling' : s === 'floored_low' ? 'overcool protection' : s}`]),
    },
    events: (data.events || []).map((e, i) => ({
      code: `${data.step}-${i}`, severity: e.startsWith('FAILURE') ? 'WARNING' : 'INFO', message: e,
    })),
  }
}

export class TelemetryAdapter {
  constructor({ mode = MODE, autoConnect = true } = {}) {
    this.mode = mode === 'live' ? 'live' : 'fixture'
    this.connectionState = this.mode === 'live' ? CONNECTION_STATES.CONNECTING : CONNECTION_STATES.FIXTURE
    this.currentFrame = null
    this.run = null
    this.lastSequence = -1
    this.frameHistory = []
    this.maxHistory = 288
    this.config = this.mode === 'fixture' ? configFixture : null
    this.commandStatus = { state: 'idle', error: null }
    this.benchmarkData = { state: 'unavailable', results: null }
    this.listeners = new Set()
    this.reconnectAttempts = 0
    this.isDestroyed = false
    this.retiredRuns = new Set()
    this.snapshotEpoch = 0
    this.updateSnapshot()
    if (autoConnect) {
      if (this.mode === 'fixture') this.initFixtureMode()
      else this.initLiveConnection()
    }
  }
  updateSnapshot() {
    this.cachedSnapshot = { mode: this.mode, isFixtureMode: this.mode === 'fixture', connectionState: this.connectionState,
      frame: this.currentFrame, run: this.run, history: this.frameHistory, config: this.config,
      commandStatus: this.commandStatus, benchmarkData: this.benchmarkData }
  }
  notify() { this.updateSnapshot(); this.listeners.forEach((l) => l()) }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getState() { return this.cachedSnapshot }
  initFixtureMode() { this.applyFrame(getFixture('NORMAL')) }
  setFixtureScenario(name) {
    if (this.mode !== 'fixture') return
    const f = getFixture(name)
    if (f) this.applyFrame({ ...f, run_id: `fixture-${Date.now()}`, sequence: 0 })
  }
  async request(path, body) {
    const res = await fetch(`${API}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    if (!res.ok) { const detail = await res.text(); throw new Error(`HTTP ${res.status}: ${detail.slice(0, 240)}`) }
    return res.json()
  }
  initLiveConnection() {
    this.fetchConfig(); this.fetchCurrentSnapshot(); this.connectWebSocket(); this.fetchBenchmarkResults()
  }
  async fetchConfig() {
    try { this.config = await this.request('/config'); this.notify() } catch { /* Keep unavailable explicitly. */ }
  }
  async fetchBenchmarkResults() {
    this.benchmarkData = { state: 'loading', results: null }; this.notify()
    try {
      const data = await this.request('/benchmarks/phase4_v2/results')
      this.benchmarkData = { state: 'completed', seeds: data.test_seeds, results: data.summary_table,
        timestamp: data.timestamp, note: data.note, simulatorVersion: data.simulator_version }
    } catch (e) { this.benchmarkData = { state: 'failed', results: null, error: e.message } }
    this.notify()
  }
  adoptRun(run) {
    if (!run || this.retiredRuns.has(run.run_id)) return false
    if (this.run?.run_id && this.run.run_id !== run.run_id) this.retiredRuns.add(this.run.run_id)
    const changed = this.run?.run_id !== run.run_id
    this.run = run
    if (changed) { this.currentFrame = null; this.lastSequence = -1; this.frameHistory = [] }
    if (run.telemetry) this.applyFrame(adaptBackendFrame(run.telemetry, run.run_id, run.status, run.scenario, run.controller))
    if (this.currentFrame) this.currentFrame = { ...this.currentFrame, run_state: run.status.toUpperCase() }
    this.notify()
    return true
  }
  async fetchCurrentSnapshot() {
    const epoch = this.snapshotEpoch
    try { const run = await this.request('/runs/current'); if (epoch === this.snapshotEpoch) this.adoptRun(run) } catch { /* WS reconnect owns connection status. */ }
  }
  connectWebSocket() {
    if (this.mode !== 'live' || this.isDestroyed || !WS) return
    this.cleanupWebSocket()
    this.ws = new WebSocket(WS)
    this.ws.onopen = () => { this.reconnectAttempts = 0; this.connectionState = CONNECTION_STATES.LIVE; this.resetStaleTimer(); this.notify() }
    this.ws.onmessage = (e) => {
      try { this.handleMessage(JSON.parse(e.data)) } catch { /* Invalid payloads cannot overwrite valid telemetry. */ }
    }
    this.ws.onclose = () => { this.cleanupWebSocket(); this.scheduleReconnect() }
    this.ws.onerror = () => { this.cleanupWebSocket(); this.scheduleReconnect() }
  }
  handleMessage(msg) {
    if (msg.type === 'connected' && msg.data?.run) { this.adoptRun(msg.data.run); return }
    if (this.retiredRuns.has(msg.run_id)) return
    if (msg.run_id && msg.run_id !== this.run?.run_id) { this.fetchCurrentSnapshot(); return }
    if (msg.type === 'run_state') {
      this.run = { ...this.run, status: msg.data.status }
      if (this.currentFrame) this.currentFrame = { ...this.currentFrame, run_state: msg.data.status.toUpperCase() }
      this.notify(); return
    }
    if (msg.type === 'telemetry') {
      this.applyFrame(adaptBackendFrame(msg.data, msg.run_id, this.run?.status || 'running', this.run?.scenario, this.run?.controller))
    }
  }
  cleanupWebSocket() {
    if (!this.ws) return
    this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null
    this.ws.close(); this.ws = null
  }
  scheduleReconnect() {
    if (this.isDestroyed || this.mode !== 'live') return
    this.connectionState = CONNECTION_STATES.RECONNECTING; this.notify()
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => { this.fetchConfig(); this.fetchCurrentSnapshot(); this.connectWebSocket() }, Math.min(1000 * 1.5 ** this.reconnectAttempts++, 15000))
  }
  resetStaleTimer() {
    clearTimeout(this.staleTimer)
    if (this.mode !== 'live') return
    this.staleTimer = setTimeout(() => {
      if (this.currentFrame?.run_state === 'RUNNING' && this.connectionState === CONNECTION_STATES.LIVE) {
        this.connectionState = CONNECTION_STATES.STALE; this.notify(); this.fetchCurrentSnapshot()
      }
    }, Math.max(5000, 2500 / (this.run?.step_rate_hz || 1)))
  }
  applyFrame(frame) {
    if (!isValidTelemetryFrame(frame) || this.retiredRuns.has(frame.run_id)) return false
    if (this.currentFrame && this.currentFrame.run_id !== frame.run_id) { this.lastSequence = -1; this.frameHistory = [] }
    if (frame.sequence <= this.lastSequence) return false
    this.lastSequence = frame.sequence; this.currentFrame = frame
    this.frameHistory = [...this.frameHistory.slice(-this.maxHistory + 1), frame]
    if (this.run) this.run = { ...this.run, current_step: frame.sequence, status: frame.run_state.toLowerCase() }
    if (this.mode === 'live' && this.ws?.readyState === 1) this.connectionState = CONNECTION_STATES.LIVE
    this.resetStaleTimer(); this.notify(); return true
  }
  async perform(command, task) {
    this.commandStatus = { state: 'pending', command, error: null }; this.notify()
    try {
      const result = await task()
      this.commandStatus = { state: 'accepted', command, error: null }; this.notify(); return result
    } catch (e) {
      this.commandStatus = { state: 'rejected', command, error: e.message }; this.notify(); throw e
    }
  }
  async startNewRun({ scenario = 'NORMAL', controller = 'JOINT_RL', seed = 42, step_rate_hz = 1, custom_failure } = {}) {
    return this.perform({ action: 'START_RUN', scenario, controller }, async () => {
      if (this.mode === 'fixture') { await Promise.resolve(); this.setFixtureScenario(scenario); return { run_id: this.currentFrame.run_id } }
      const mapped = { FAILURE: 'cooling_failure', PEAK: 'peak_load', HEATWAVE: 'ambient_heat', NORMAL: 'normal' }
      this.snapshotEpoch++
      const run = await this.request('/runs', { scenario: mapped[scenario] || scenario.toLowerCase(), controller: controller.toLowerCase(),
        seed, step_rate_hz, auto_play: true, ...(custom_failure ? { custom_failure } : {}) })
      this.adoptRun(run); await this.fetchCurrentSnapshot(); return run
    })
  }
  async sendCommand(payload) {
    return this.perform(payload, async () => {
      const command = (payload.command || payload.action).toLowerCase()
      if (this.mode === 'fixture') {
        await Promise.resolve()
        if (command === 'set_scenario') this.setFixtureScenario(payload.scenario)
        else if (this.currentFrame) { this.currentFrame = { ...this.currentFrame, run_state: command === 'pause' ? 'PAUSED' : 'RUNNING' }; this.notify() }
        return { status: 'accepted' }
      }
      const id = this.run?.run_id || this.currentFrame?.run_id
      if (!id) throw new Error('Start a run first.')
      // The existing API normalizes "start" to "resume". Bootstrap a created
      // run with its supported single-step command before resuming playback.
      if (command === 'start' && this.run?.status === 'created') await this.request(`/runs/${id}/commands`, { command: 'step' })
      const result = await this.request(`/runs/${id}/commands`, { command: command === 'start' ? 'resume' : command, params: payload.params || payload })
      if (command === 'reset') { this.snapshotEpoch++; this.currentFrame = null; this.frameHistory = []; this.lastSequence = -1 }
      await this.fetchCurrentSnapshot(); return result
    })
  }
  destroy() { this.isDestroyed = true; clearTimeout(this.reconnectTimer); clearTimeout(this.staleTimer); this.cleanupWebSocket() }
}
export const telemetryAdapter = new TelemetryAdapter({ mode: import.meta.env.VITEST ? 'fixture' : MODE, autoConnect: !import.meta.env.VITEST })
if (import.meta.env.VITEST) telemetryAdapter.initFixtureMode()
if (import.meta.hot) import.meta.hot.dispose(() => telemetryAdapter.destroy())
export function useTelemetry() {
  return useSyncExternalStore((l) => telemetryAdapter.subscribe(l), () => telemetryAdapter.getState(), () => telemetryAdapter.getState())
}
