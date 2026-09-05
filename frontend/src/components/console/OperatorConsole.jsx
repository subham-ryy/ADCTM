import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTelemetry, telemetryAdapter } from '../../api/telemetryAdapter'
import { scenarioName } from '../../api/liveTelemetry'
import ErrorBoundary3D from '../3d/ErrorBoundary3D'
import ThermalPlan from './ThermalPlan'
import DecisionPanel from './DecisionPanel'
import TelemetryCharts from './TelemetryCharts'
import { clockTime, controllerLabel, fmt, pct, tempColor, thermalBands, ZONE_LAYOUT, zoneName } from './presentation'
import './console.css'
import './console-room.css'

const FacilityView = lazy(() => import('../3d/FacilityView'))
const ENABLE_3D = import.meta.env.VITE_ENABLE_3D !== 'false'
const SCENARIOS = [{ id: 'NORMAL', label: 'Normal', icon: '◉' }, { id: 'PEAK', label: 'Peak load', icon: '↗' }, { id: 'HEATWAVE', label: 'Heatwave', icon: '☼' }, { id: 'FAILURE', label: 'Cooling failure', icon: 'ϟ' }]

function BenchmarkDialog({ data, onClose, fixture }) {
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return <dialog ref={ref} className="benchmark-dialog" onCancel={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
    <div className="dialog-heading"><div><span className="eyebrow">EVIDENCE / SIMULATOR V2</span><h2>Three controllers. Same conditions.</h2></div><button onClick={onClose} aria-label="Close benchmarks">×</button></div>
    <p>Offline cooling-failure benchmark · Zone D · capacity 60% at step 50. This comparison is separate from the current live experiment.</p>
    {data.state === 'completed' && data.results?.length ? <><div className="seed-badge">{data.seeds.length} held-out seeds: {data.seeds.join(' · ')}</div><div className="table-scroll"><table><thead><tr><th>Controller</th><th>Mean PUE</th><th>Mean peak °C</th><th>SLA %</th><th>Operational breaches</th><th>Emergency breaches</th><th>Energy kWh</th></tr></thead><tbody>{data.results.map((row) => <tr key={row.controller}><th>{row.controller}</th><td>{fmt(row.pue, 3)}</td><td>{fmt(row.max_temp, 2)}</td><td>{fmt(row.sla_uptime_pct, 2)}</td><td>{fmt(row.operational_violations, 1)}</td><td>{fmt(row.emergency_violations, 1)}</td><td>{fmt(row.energy_kwh, 2)}</td></tr>)}</tbody></table></div><small>Values are averages from the saved backend evaluation. No ranking or live-run savings are inferred.</small></> : <div className="empty-state">{fixture ? 'Benchmarks are unavailable in fixture mode.' : data.state === 'loading' ? 'Loading benchmark results…' : 'Benchmark results unavailable.'}<button onClick={() => telemetryAdapter.fetchBenchmarkResults()}>Retry</button></div>}
  </dialog>
}

export default function OperatorConsole() {
  const telemetry = useTelemetry()
  const { frame, run, config, history, connectionState, isFixtureMode, commandStatus } = telemetry
  const [view, setView] = useState(() => new URLSearchParams(location.search).get('view') === '2d' || !ENABLE_3D ? '2d' : '3d')
  const [layer, setLayer] = useState('thermal')
  const [selectedZone, setSelectedZone] = useState(null)
  const [scenario, setScenario] = useState('FAILURE')
  const [controller, setController] = useState('JOINT_RL')
  const [speed, setSpeed] = useState(1)
  const [seed, setSeed] = useState(42)
  const [faultStep, setFaultStep] = useState(12)
  const [faultZone, setFaultZone] = useState(3)
  const [showSetup, setShowSetup] = useState(false)
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [cameraKey, setCameraKey] = useState(0)
  const [roomFocus, setRoomFocus] = useState(false)
  const [showTrends, setShowTrends] = useState(false)
  const [fallback, setFallback] = useState('')
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [lastSetup, setLastSetup] = useState(null)
  const syncRun = useRef(null)
  useEffect(() => {
    if (run?.run_id && syncRun.current !== run.run_id) {
      syncRun.current = run.run_id
      setScenario(scenarioName(run.scenario)); setController(run.controller.toUpperCase()); setSpeed(run.step_rate_hz); setSeed(run.seed)
    }
  }, [run])
  const pending = commandStatus.state === 'pending'
  const connected = connectionState === 'LIVE'
  const state = frame?.run_state || run?.status?.toUpperCase() || 'IDLE'
  const paused = state === 'PAUSED' || state === 'CREATED'
  const running = state === 'RUNNING'
  const command = (c) => telemetryAdapter.sendCommand(c).catch(() => {})
  const start = () => {
    const custom = scenario === 'FAILURE' ? { zone_index: faultZone, trigger_step: faultStep, reduced_capacity: 0.6 } : undefined
    telemetryAdapter.startNewRun({ scenario, controller, seed, step_rate_hz: speed, custom_failure: custom }).then((r) => { setLastSetup({ id: r.run_id, failure: custom }); setSelectedZone(null) }).catch(() => {})
  }
  // A recovered run may have custom failure timing not present in RunSummary.
  // Only show a schedule that this client actually submitted and received acknowledgement for.
  const failure = lastSetup && lastSetup.id === run?.run_id ? lastSetup.failure : null
  const metrics = frame?.metrics || {}
  const m = (label, value, unit, detail, accent) => <div className={`metric ${accent || ''}`}><label>{label}</label><strong>{value}<small>{unit}</small></strong><span>{detail}</span></div>
  const fallbackToPlan = (reason) => { setFallback(reason || '3D view unavailable'); setView('2d') }
  const plan = <ThermalPlan frame={frame} config={config} layer={layer} selectedZone={selectedZone} onSelectZone={setSelectedZone} reduceMotion={reduceMotion || !running || !connected} />
  return <div className={`console-shell ${reduceMotion ? 'reduced-motion' : ''} ${roomFocus ? 'room-focused' : ''}`}>
    <header className="topbar"><a className="brand" href="/" aria-label="ADCTM control room"><span className="brand-mark"><i /><i /><i /></span><span>ADCTM<span className="brand-divider">/</span><small>CONTROL ROOM</small></span></a><div className="topbar-context">Autonomous thermal & workload control<span>SIMULATED DIGITAL TWIN</span></div><button className="benchmark-button" onClick={() => setShowBenchmark(true)}><span>▥</span> Benchmark evidence <span>↗</span></button></header>
    <section className="metrics-strip" aria-label="Live facility metrics">
      {m('POWER EFFECTIVENESS', fmt(metrics.pue, 3), 'PUE', 'Facility power / IT power', 'mint-metric')}
      {m('MAX TEMPERATURE', fmt(metrics.max_temperature_c), '°C', `Operational limit ${fmt(config?.thresholds?.operational_max_temperature_c, 0)}°C`, 'amber-metric')}
      {m('FACILITY ENERGY', fmt(metrics.energy_used_kwh), 'kWh', `${fmt(metrics.total_power_kw)} kW current draw`)}
      {m('SLA UPTIME', fmt(metrics.sla_percent, 1), '%', `${fmt(metrics.sla_violations, 0)} operational breaches`)}
      <div className="run-health"><div className={`connection-pill ${connected ? 'connected' : ''}`}><span className="dot" />{isFixtureMode ? 'SIMULATED FIXTURE' : connected ? 'Live simulation' : connectionState.toLowerCase().replace('_', ' ')}</div><strong>{state.charAt(0) + state.slice(1).toLowerCase()}<span className={`risk-label ${frame?.risk?.toLowerCase() || ''}`}>{frame?.risk || 'No risk data'}</span></strong><small>{frame ? `Step ${frame.sequence} / ${run?.total_steps || 288} · ${clockTime(frame.simulation_time_s)} simulated` : 'Awaiting backend telemetry'}</small></div>
    </section>
    {(isFixtureMode || (!connected && frame) || fallback) && <div className="notice-strip">{isFixtureMode ? 'SIMULATED FIXTURE · Offline preview; no live policy inference.' : !connected && frame ? 'Connection interrupted. Last received values remain visible; activity animations are paused.' : `2D fallback · ${fallback}`}</div>}
    <section className="experiment-bar" aria-label="Experiment controls"><div className="scenario-selector">{SCENARIOS.map((s) => <button key={s.id} className={scenario === s.id ? 'active' : ''} onClick={() => setScenario(s.id)} aria-pressed={scenario === s.id}><span>{s.icon}</span>{s.label}</button>)}</div><div className="run-buttons"><label className="sr-only" htmlFor="controller">Controller</label><select id="controller" value={controller} onChange={(e) => setController(e.target.value)}><option value="JOINT_RL">Joint PPO</option><option value="COOLING_ONLY_RL">Cooling-only PPO</option><option value="RULE_BASED">Rule-based</option></select><button className="icon-button setup-button" onClick={() => setShowSetup(!showSetup)} aria-expanded={showSetup} aria-label="Experiment settings">⚙</button><button className="primary-button" onClick={start} disabled={pending || !connected || isFixtureMode}><span>▶</span>{pending ? 'Applying…' : 'Run experiment'}</button></div></section>
    {showSetup && <section className="experiment-settings"><label>Random seed<input type="number" min="0" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value))))} /></label>{scenario === 'FAILURE' && <><label>Failure zone<select value={faultZone} onChange={(e) => setFaultZone(Number(e.target.value))}>{ZONE_LAYOUT.map((z, i) => <option key={z.id} value={i}>{z.name}</option>)}</select></label><label>Failure at step<input type="number" min="0" max="287" value={faultStep} onChange={(e) => setFaultStep(Math.min(287, Math.max(0, Math.floor(Number(e.target.value)))))} /></label><p>Cooling capacity reduces to 60%. This changes the environment; PPO chooses the response.</p></>}</section>}
    {commandStatus.state === 'rejected' && <div className="notice-strip error" role="alert">Command rejected: {commandStatus.error}</div>}
    <main className="workspace"><section className="facility-panel" aria-label="Facility visualization"><div className="facility-title"><div><span className="eyebrow">FACILITY / 01</span><h1>Compute hall <span>5 live zones · 10 display cabinets</span></h1></div><div className="facility-view-controls"><div className="view-switch"><button onClick={() => { setView('3d'); setFallback('') }} disabled={!ENABLE_3D} className={view === '3d' ? 'active' : ''} aria-pressed={view === '3d'}>3D room</button><button onClick={() => setView('2d')} className={view === '2d' ? 'active' : ''} aria-pressed={view === '2d'}>2D thermal</button></div><button className={`room-focus-button ${roomFocus ? 'active' : ''}`} onClick={() => setRoomFocus(!roomFocus)} aria-pressed={roomFocus} aria-label={roomFocus ? 'Show decision panel' : 'Expand room'} title={roomFocus ? 'Show decision panel' : 'Expand room'}>{roomFocus ? '↙' : '⛶'}<span>{roomFocus ? 'Exit focus' : 'Expand'}</span></button></div></div>
      <div className="scene-container">{view === '3d' ? <ErrorBoundary3D fallback={plan} onFallback={fallbackToPlan}><Suspense fallback={<div className="scene-loading"><span className="loader-ring" /><p>Preparing the compute hall</p><small>Live telemetry continues while the room loads.</small></div>}><FacilityView frame={frame} history={history} config={config} selectedZone={selectedZone} onSelectZone={setSelectedZone} onFallback={fallbackToPlan} layer={layer} cameraKey={cameraKey} reduceMotion={reduceMotion || !running || !connected} /></Suspense></ErrorBoundary3D> : plan}
        <div className="scene-tools"><div className="layer-switch"><button onClick={() => setLayer('thermal')} className={layer === 'thermal' ? 'active' : ''} aria-pressed={layer === 'thermal'}>Temperature</button><button onClick={() => setLayer('load')} className={layer === 'load' ? 'active' : ''} aria-pressed={layer === 'load'}>Workload</button></div>{view === '3d' && <><button className={cameraKey < 0 ? 'active' : ''} onClick={() => setCameraKey((n) => n < 0 ? 0 : -1)} aria-label="Overview camera" aria-pressed={cameraKey < 0}>{cameraKey < 0 ? 'Room view' : 'Overview'}</button><button className="icon-button" onClick={() => setCameraKey((n) => Math.max(0, n + 1))} aria-label="Reset camera" title="Reset camera">⌖</button></>}<button className={`icon-button ${reduceMotion ? 'active' : ''}`} onClick={() => setReduceMotion(!reduceMotion)} aria-pressed={reduceMotion} aria-label="Reduce motion" title="Reduce motion">≋</button></div>
        <div className="room-caption"><span className="dot mint" />{frame ? `${controllerLabel(frame.controller)} · ${SCENARIOS.find((s) => s.id === frame.scenario)?.label || frame.scenario}` : 'Room ready · waiting for simulation'}<span>{view === '3d' ? 'Drag to orbit · scroll to zoom' : 'Select a zone to inspect'}</span></div>
      </div>
      <div className="zone-strip">{ZONE_LAYOUT.map((z, i) => { const data = frame?.zones[i]; return <button key={z.id} onClick={() => setSelectedZone(selectedZone === z.id ? null : z.id)} className={selectedZone === z.id ? 'selected' : ''} aria-pressed={selectedZone === z.id}><span><i style={{ background: tempColor(data?.temperature_c, config) }} />{z.name}{data?.capacity < 1 && <b className="derated-tag">{pct(data.capacity)} CAP</b>}</span><strong>{fmt(data?.temperature_c)}<small>°C</small></strong><label>Load {pct(data?.utilization)}</label><div className="zone-load-track"><i style={{ width: `${(data?.utilization ?? 0) * 100}%` }} /></div></button> })}</div>
      <div className="thermal-legend">{thermalBands(config).slice(0, 4).map((b) => <span key={b.label}><i style={{ background: b.color }} />{b.label} ≤ {b.max}°</span>)}<span className="legend-note">Rack pairs share zone telemetry · illustrative airflow</span></div>
      <div className="playback-bar"><div className="playback-buttons"><button disabled={pending || !connected || (!running && !paused)} onClick={() => command({ command: running ? 'pause' : state === 'CREATED' ? 'start' : 'resume' })} aria-label={running ? 'Pause run' : 'Resume run'}>{running ? 'Ⅱ' : '▶'}</button><button disabled={pending || !connected || !paused} onClick={() => command({ command: 'step' })} aria-label="Execute one step">▸│</button></div><div className="run-progress"><div className="progress-label"><span>{clockTime(frame?.simulation_time_s)} <small>/ 24:00 simulated</small></span><small>{failure ? `${zoneName(ZONE_LAYOUT[failure.zone_index]?.id)} fault ${frame?.sequence > failure.trigger_step ? 'injected' : `at step ${failure.trigger_step}`}` : 'Continuous controller execution'}</small></div><div className="progress-track"><i style={{ width: `${(frame?.sequence || 0) / (run?.total_steps || 288) * 100}%` }} />{failure && <b title={`Cooling failure at step ${failure.trigger_step}`} style={{ left: `${failure.trigger_step / 288 * 100}%` }} />}</div></div><label className="speed-control"><span>Playback</span><select aria-label="Playback speed" value={speed} onChange={(e) => { const hz = Number(e.target.value); setSpeed(hz); if (run) command({ command: 'set_speed', params: { speed_hz: hz } }) }} disabled={pending}>{[0.5, 1, 2, 4, 8].map((v) => <option key={v} value={v}>{v} step{v === 1 ? '' : 's'}/s</option>)}</select></label></div>
    </section><DecisionPanel telemetry={telemetry} selectedZone={selectedZone} onSelectZone={setSelectedZone} /></main>
    <section className={`trends-drawer ${showTrends ? 'open' : ''}`}><button className="trends-toggle" onClick={() => setShowTrends(!showTrends)} aria-label={showTrends ? 'Hide telemetry trends' : 'Show telemetry trends'} aria-expanded={showTrends} aria-controls="telemetry-trends"><span><span className="trend-symbol">⌁</span> Live telemetry trends <small>{history.length} samples</small></span><span>{showTrends ? 'Collapse −' : 'PUE · Temperature · Energy +'} </span></button><div id="telemetry-trends" hidden={!showTrends}><TelemetryCharts history={history} config={config} /></div></section>
    <footer className="console-footer"><span><span className="dot mint" /> Safety shield enforced by the backend</span><span>Cooling allocation + workload placement<span className="footer-separator">/</span>{history.length} received samples</span><span>ADCTM · Digital twin research</span></footer>
    {showBenchmark && <BenchmarkDialog data={telemetry.benchmarkData} fixture={isFixtureMode} onClose={() => setShowBenchmark(false)} />}
  </div>
}
