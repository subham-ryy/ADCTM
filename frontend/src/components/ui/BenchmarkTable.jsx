import React, { useState } from 'react'

export default function BenchmarkTable({ benchmarkData, isFixtureMode }) {
  const [isOpen, setIsOpen] = useState(false)

  // In fixture mode or when no backend benchmark data is available,
  // do not show invented numerical results!
  const hasRealResults =
    benchmarkData &&
    benchmarkData.state === 'completed' &&
    Array.isArray(benchmarkData.results) &&
    benchmarkData.results.length > 0

  return (
    <div
      data-testid="benchmark-container"
      style={{
        position: 'absolute',
        bottom: 16,
        right: 14,
        zIndex: 35,
        fontFamily: 'monospace',
      }}
    >
      {!isOpen ? (
        <button
          data-testid="benchmark-toggle-btn"
          onClick={() => setIsOpen(true)}
          style={{
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            color: '#38bdf8',
            borderRadius: '6px',
            padding: '8px 14px',
            fontSize: '11px',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          📊 CONTROLLER BENCHMARKS
        </button>
      ) : (
        <div
          style={{
            width: '540px',
            maxWidth: 'calc(100vw - 28px)',
            background: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '8px',
            padding: '14px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            color: '#cbd5e1',
            fontSize: '11px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
              paddingBottom: '8px',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 800, color: '#38bdf8' }}>
                CONTROLLER BENCHMARK COMPARISON
              </span>
              {hasRealResults && (
                <span style={{ color: '#94a3b8', fontSize: '10px' }}>
                  ({benchmarkData.seeds || 5} Seeds)
                </span>
              )}
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>

          {!hasRealResults ? (
            <div
              data-testid="benchmark-empty-state"
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                background: 'rgba(30, 41, 59, 0.5)',
                borderRadius: '6px',
                border: '1px dashed rgba(148, 163, 184, 0.3)',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>
                {isFixtureMode ? 'OFFLINE FIXTURE MODE' : 'NO BENCHMARK RESULTS AVAILABLE'}
              </div>
              <p style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 10px 0' }}>
                {isFixtureMode
                  ? 'Per data integrity rules, benchmark results are never fabricated or hand-tuned in frontend fixture mode.'
                  : 'Awaiting execution of POST /api/v1/benchmarks → GET /api/v1/benchmarks/{id} → GET /api/v1/benchmarks/{id}/results.'}
              </p>
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                Target columns: Controller | Mean PUE | Max Temp | SLA/Uptime | Safety Violations | Energy Used
              </div>
            </div>
          ) : (
            <table data-testid="benchmark-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ padding: '6px' }}>Controller</th>
                  <th style={{ padding: '6px' }}>Mean PUE</th>
                  <th style={{ padding: '6px' }}>Max Temp</th>
                  <th style={{ padding: '6px' }}>SLA</th>
                  <th style={{ padding: '6px' }}>Safety Viol.</th>
                  <th style={{ padding: '6px' }}>Energy (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkData.results.map((row) => (
                  <tr key={row.controller} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.4)' }}>
                    <td style={{ padding: '6px', fontWeight: 700, color: '#f8fafc' }}>{row.controller}</td>
                    <td style={{ padding: '6px' }}>{row.mean_pue.toFixed(2)}</td>
                    <td style={{ padding: '6px' }}>{row.max_temp_c.toFixed(1)}°C</td>
                    <td style={{ padding: '6px' }}>{row.sla_uptime_percent.toFixed(1)}%</td>
                    <td style={{ padding: '6px' }}>{row.safety_violations}</td>
                    <td style={{ padding: '6px' }}>{row.energy_used_kwh.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
