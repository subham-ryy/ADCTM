export const ZONE_LAYOUT = [
  { id: 'zone-01', name: 'Zone A', letter: 'A', position: [-3.6, 0, -1.9] },
  { id: 'zone-02', name: 'Zone B', letter: 'B', position: [-0.4, 0, -1.9] },
  { id: 'zone-03', name: 'Zone C', letter: 'C', position: [2.8, 0, -1.9] },
  { id: 'zone-04', name: 'Zone D', letter: 'D', position: [-2, 0, 2.1] },
  { id: 'zone-05', name: 'Zone E', letter: 'E', position: [1.6, 0, 2.1] },
]
export const zoneName = (id) => ZONE_LAYOUT.find((z) => z.id === id)?.name || id
export const fmt = (v, digits = 1) => Number.isFinite(v) ? v.toFixed(digits) : '—'
export const pct = (v) => Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'
export const clockTime = (s = 0) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`
export const controllerLabel = (v) => ({ JOINT_RL: 'Joint PPO', COOLING_ONLY_RL: 'Cooling-only PPO', RULE_BASED: 'Rule-based' }[v?.toUpperCase()] || 'Controller')
export function thermalBands(config) {
  const t = config?.thresholds
  if (!t) return config?.temperature_thresholds || []
  return [
    { max: t.target_temp_high, color: '#72e5d2', label: 'Target band' },
    { max: t.operational_max_temperature_c, color: '#e9c680', label: 'Above target' },
    { max: t.critical_temp, color: '#f5a35c', label: 'SLA breach' },
    { max: t.emergency_max_temperature_c, color: '#f16b79', label: 'Critical' },
    { max: Infinity, color: '#f14765', label: 'Emergency' },
  ]
}
export function tempColor(value, config) {
  if (!Number.isFinite(value)) return '#637a89'
  const bands = thermalBands(config)
  return (bands.find((b) => value <= b.max) || bands.at(-1))?.color || '#9fb4c2'
}
export const moveLabel = (move) => move.amount_unit === 'utilization'
  ? `${fmt(move.amount * 100, 1)} percentage points`
  : `${fmt(move.amount)} kW (fixture)`

// Explain observed deltas, never invent policy intent or a simulated outcome.
export function decisionFor(frame, previous) {
  if (!frame) return null
  const sameRun = previous?.run_id === frame.run_id
  const prior = sameRun ? previous : null
  const moves = frame.actions?.workload_moves || []
  const faults = frame.cooling_units.filter((c) => c.available_capacity < 1)
  const newFaults = faults.filter((c) => {
    const before = prior?.cooling_units.find((p) => p.id === c.id)
    return before && before.available_capacity > c.available_capacity
  })
  const thermalDelta = prior && Number.isFinite(frame.metrics.max_temperature_c) && Number.isFinite(prior.metrics.max_temperature_c)
    ? frame.metrics.max_temperature_c - prior.metrics.max_temperature_c : null
  return { moves, faults, newFaults, thermalDelta, previous: prior }
}

export function recentActivity(history) {
  return history.flatMap((frame, i) => {
    const d = decisionFor(frame, history[i - 1])
    const entries = []
    for (const c of d.newFaults) entries.push({ type: 'fault', text: `${zoneName(c.zone_id)} cooling → ${pct(c.available_capacity)} capacity` })
    for (const move of d.moves) entries.push({ type: 'move', text: `${zoneName(move.from_zone)} → ${zoneName(move.to_zone)} · ${moveLabel(move)}` })
    if (frame.safety?.move_rejected) entries.push({ type: 'shield', text: 'Safety shield rejected the proposed transfer' })
    if (!entries.length && frame.safety?.override_active && !history[i - 1]?.safety?.override_active) entries.push({ type: 'shield', text: 'Safety shield adjusted cooling commands' })
    return entries.map((entry, j) => ({ ...entry, step: frame.sequence, key: `${frame.run_id}-${frame.sequence}-${j}` }))
  }).slice(-24).reverse()
}
