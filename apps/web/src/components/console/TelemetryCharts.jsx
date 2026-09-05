import { fmt, clockTime } from './presentation'

function Chart({ history, metric, label, unit, color, threshold }) {
  const values = history.map((f) => f.metrics[metric]).filter(Number.isFinite)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values, threshold ?? -Infinity) : 1
  const pad = Math.max((max - min) * 0.2, metric === 'pue' ? 0.01 : 0.4)
  const low = min - pad, high = max + pad
  const y = (v) => 64 - (v - low) / (high - low) * 52
  const start = history[0]?.sequence || 0, end = history.at(-1)?.sequence || start + 1
  const x = (step) => 6 + (step - start) / Math.max(end - start, 1) * 388
  const points = history.filter((f) => Number.isFinite(f.metrics[metric])).map((f) => `${x(f.sequence)},${y(f.metrics[metric])}`).join(' ')
  const current = history.at(-1)?.metrics[metric]
  return <div className="telemetry-chart">
    <div className="chart-heading"><span><i style={{ background: color }} />{label}</span><strong>{fmt(current, metric === 'pue' ? 3 : 1)} <small>{unit}</small></strong></div>
    <svg viewBox="0 0 400 78" role="img" aria-label={`${label}: ${fmt(current, metric === 'pue' ? 3 : 1)} ${unit}; ${history.length} received samples`} preserveAspectRatio="none">
      {[18, 41, 64].map((v) => <line key={v} x1="0" x2="400" y1={v} y2={v} stroke="#ffffff09" />)}
      {threshold && values.length > 0 && <><line x1="0" x2="400" y1={y(threshold)} y2={y(threshold)} stroke="#f2af6170" strokeDasharray="4 5" /><text x="396" y={y(threshold) - 4} textAnchor="end" fill="#b7a078" fontSize="8">SLA {threshold}°</text></>}
      {values.length > 1 && <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />}
      {Number.isFinite(current) && <circle cx={x(history.at(-1).sequence)} cy={y(current)} r="3" fill={color} />}
    </svg>
    <div className="chart-axis"><span>{history.length ? clockTime(history[0].simulation_time_s) : 'Awaiting telemetry'}</span><span>{history.length > 1 ? `${clockTime(history.at(-1).simulation_time_s)} simulated` : 'No history yet'}</span></div>
  </div>
}
export default function TelemetryCharts({ history, config }) {
  return <section className="charts-row" aria-label="Run telemetry trends">
    <Chart history={history} metric="pue" label="Power usage effectiveness" color="#76e4d2" unit="PUE" />
    <Chart history={history} metric="max_temperature_c" label="Maximum temperature" color="#eec58a" unit="°C" threshold={config?.thresholds?.operational_max_temperature_c} />
    <Chart history={history} metric="energy_used_kwh" label="Facility energy" color="#a9abf8" unit="kWh" />
  </section>
}
