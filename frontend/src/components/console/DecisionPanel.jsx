import { useMemo } from 'react'
import { controllerLabel, decisionFor, fmt, moveLabel, pct, recentActivity, zoneName, ZONE_LAYOUT } from './presentation'

export default function DecisionPanel({ telemetry, selectedZone, onSelectZone }) {
  const { frame, history, config } = telemetry
  const previous = history.at(-2)
  const decision = useMemo(() => decisionFor(frame, previous), [frame, previous])
  const activity = useMemo(() => recentActivity(history), [history])
  const zone = frame?.zones.find((z) => z.id === selectedZone)
  const move = decision?.moves[0]
  const proposed = frame?.actions?.proposed_move
  return <aside className="decision-panel">
    <div className="panel-title"><div><span className="eyebrow">CONTROL INTELLIGENCE</span><h2>Inside the decision</h2></div><span className="step-tag">#{frame?.sequence ?? '—'}</span></div>
    <div className="policy-identity"><span className="policy-icon">⌘</span><div><strong>{controllerLabel(frame?.controller || telemetry.run?.controller)}</strong><small>{frame?.controller === 'RULE_BASED' ? 'Threshold controller · cooling only' : frame?.controller === 'COOLING_ONLY_RL' ? 'Pretrained policy · cooling only' : 'Pretrained policy · cooling + placement'}</small></div><span className="dot mint" /></div>
    {!frame ? <div className="empty-decision">Waiting for the first simulation step. Decisions appear here as they execute.</div> : <>
      <div className="decision-sequence" key={`${frame.run_id}-${frame.sequence}`}>
        <article className="decision-stage"><span className="stage-index">01</span><div><label>OBSERVE</label><strong>{decision.faults.length ? `${zoneName(decision.faults[0].zone_id)} cooling at ${pct(decision.faults[0].available_capacity)}` : 'Five zones under observation'}</strong><p>{decision.faults.length ? 'Reduced capacity is visible to the controller.' : `${fmt(frame.ambient_temp)}°C ambient · ${fmt(previous?.metrics.max_temperature_c ?? frame.metrics.max_temperature_c)}°C previous peak`}</p></div></article>
        <article className="decision-stage"><span className="stage-index">02</span><div><label>PROPOSE</label><strong>{proposed?.move_fraction > 0 && proposed.from_zone !== proposed.to_zone ? `${ZONE_LAYOUT[proposed.from_zone]?.name} → ${ZONE_LAYOUT[proposed.to_zone]?.name}` : 'Set cooling allocation'}</strong><p>{proposed?.move_fraction > 0 && proposed.from_zone !== proposed.to_zone ? `${pct(proposed.move_fraction)} of source workload proposed` : 'The controller proposes a command for each zone.'}</p></div></article>
        <article className={`decision-stage ${frame.safety?.override_active ? 'shield-stage' : ''}`}><span className="stage-index">03</span><div><label>SHIELD & APPLY</label><strong>{move ? `${zoneName(move.from_zone)} → ${zoneName(move.to_zone)}` : frame.safety?.move_rejected ? 'Transfer rejected by shield' : 'Cooling commands applied'}</strong><p>{move ? `${moveLabel(move)} transferred` : 'No workload migration executed this step.'}</p>{frame.safety?.override_active && <p className="amber-text">{frame.safety.reasons.join(' · ') || 'Safety correction applied'}{frame.safety.move_rejected ? ' · Transfer blocked' : ''}</p>}</div></article>
        <article className="decision-stage"><span className="stage-index">04</span><div><label>MEASURED RESULT</label><strong>{fmt(frame.metrics.max_temperature_c)}°C peak <span className={decision.thermalDelta > 0 ? 'amber-text' : 'mint-text'}>{decision.thermalDelta === null ? '' : `${decision.thermalDelta >= 0 ? '+' : ''}${fmt(decision.thermalDelta, 2)}°`}</span></strong><p>{fmt(frame.metrics.pue, 3)} PUE · {fmt(frame.metrics.sla_percent)}% SLA uptime</p></div></article>
      </div>
      <div className="allocation-title"><span>Cooling allocation</span><small><i className="proposal-key" /> Proposal <i className="applied-key" /> Applied</small></div>
      <div className="cooling-allocation">{frame.zones.map((z, i) => <button key={z.id} className={`allocation-row ${selectedZone === z.id ? 'selected' : ''}`} onClick={() => onSelectZone(z.id)} aria-label={`Inspect ${zoneName(z.id)}`}>
        <span>{ZONE_LAYOUT[i]?.letter}</span><span className="allocation-track"><i className="capacity-limit" style={{ left: `${(z.capacity ?? 1) * 100}%` }} /><i className="proposal-bar" style={{ width: `${(frame.actions.proposed_cooling[i] ?? 0) * 100}%` }} /><i className={`applied-bar ${frame.safety.zone_corrections?.[i] && frame.safety.zone_corrections[i] !== 'none' ? 'corrected' : ''}`} style={{ width: `${(frame.actions.applied_cooling[i] ?? 0) * 100}%` }} /></span><strong>{pct(frame.actions.applied_cooling[i])}</strong>
      </button>)}</div>
      {zone && <section className="zone-inspector"><div><strong>{zoneName(zone.id)} <span>selected</span></strong><button aria-label="Close zone inspection" onClick={() => onSelectZone(null)}>×</button></div><dl><div><dt>Temperature</dt><dd>{fmt(zone.temperature_c)}°C</dd></div><div><dt>Workload</dt><dd>{pct(zone.utilization)}</dd></div><div><dt>Cooling</dt><dd>{pct(zone.cooling)}</dd></div><div><dt>Capacity</dt><dd>{pct(zone.capacity)}</dd></div></dl><small>{config?.topology?._zone_layout?.[`Zone-${ZONE_LAYOUT.find((z) => z.id === zone.id)?.letter}`]?.split('.')[0] || 'Authoritative zone telemetry'}</small></section>}
      <div className="activity-heading"><span>Execution log</span><small>Actual run events</small></div>
      <div className="activity-list">{activity.length ? activity.map((e) => <div key={e.key} className={`activity-event ${e.type}`}><span>{e.type === 'move' ? '↗' : e.type === 'fault' ? '!' : '◇'}</span><p>{e.text}<small>Step {e.step}</small></p></div>) : <p className="quiet-note">No migrations or capacity changes recorded yet.</p>}</div>
    </>}
  </aside>
}
