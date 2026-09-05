import React, { useRef, useEffect, useState } from 'react'
import { TEMP_THRESHOLDS } from '../../api/telemetryContract.js'

export default function HeatmapCanvas({ frame, config, onSelectZone, selectedZoneId }) {
  const canvasRef = useRef(null)
  const animFrameRef = useRef(null)
  const [showTable, setShowTable] = useState(false)

  // Use dynamic thresholds from config, with fallback
  const thresholds = config?.temperature_thresholds || TEMP_THRESHOLDS

  const getCustomTempBand = (tempC) => {
    for (const band of thresholds) {
      if (tempC <= band.max) return band
    }
    return thresholds[thresholds.length - 1]
  }

  // Load topology from config or fallback
  const defaultZones = [
    { id: 'zone-01', x: 140, y: 70, w: 200, h: 140, label: 'ZONE 01 (ROW A-L)' },
    { id: 'zone-02', x: 370, y: 70, w: 200, h: 140, label: 'ZONE 02 (ROW A-C)' },
    { id: 'zone-03', x: 600, y: 70, w: 200, h: 140, label: 'ZONE 03 (ROW A-R)' },
    { id: 'zone-04', x: 250, y: 260, w: 200, h: 140, label: 'ZONE 04 (ROW B-L)' },
    { id: 'zone-05', x: 480, y: 260, w: 200, h: 140, label: 'ZONE 05 (ROW B-R)' },
  ]
  const defaultCracs = [
    { id: 'crac-01', x: 30, y: 90, w: 80, h: 100, label: 'CRAC-01' },
    { id: 'crac-02', x: 820, y: 90, w: 80, h: 100, label: 'CRAC-02' },
  ]

  const topologyZones = config?.topology?.zones || defaultZones
  const zonePositions = Object.fromEntries(topologyZones.map((z) => [z.id, z]))

  const topologyCracs = config?.topology?.cooling_units || defaultCracs
  const cracPositions = Object.fromEntries(topologyCracs.map((c) => [c.id, c]))

  // Detect prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animOffset = 0

    // Coordinate layout dynamically loaded from config
    const render = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Background room fill
      ctx.fillStyle = '#0b1120'
      ctx.fillRect(0, 0, w, h)

      // Grid pattern
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)'
      ctx.lineWidth = 1
      const gridSize = 30
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // Draw CRAC cooling units
      const coolingUnits = frame.cooling_units || []
      coolingUnits.forEach((crac) => {
        const pos = cracPositions[crac.id]
        if (!pos) return

        const isFailed = crac.status === 'FAILED'
        const isDerated = crac.status === 'DERATED'

        ctx.fillStyle = isFailed ? 'rgba(239, 68, 68, 0.25)' : isDerated ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.2)'
        ctx.fillRect(pos.x, pos.y, pos.w, pos.h)

        ctx.lineWidth = isFailed ? 3 : 2
        ctx.strokeStyle = isFailed ? '#ef4444' : isDerated ? '#f59e0b' : '#38bdf8'
        ctx.strokeRect(pos.x, pos.y, pos.w, pos.h)

        // Text labels
        ctx.fillStyle = '#f8fafc'
        ctx.font = 'bold 11px monospace'
        ctx.fillText(pos.label, pos.x + 8, pos.y + 20)

        // Status badge
        ctx.fillStyle = isFailed ? '#f87171' : isDerated ? '#fbbf24' : '#34d399'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(crac.status, pos.x + 8, pos.y + 40)

        // Capacity
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '10px monospace'
        ctx.fillText(`CAP: ${(crac.available_capacity * 100).toFixed(0)}%`, pos.x + 8, pos.y + 60)
        ctx.fillText(`CMD: ${(crac.command * 100).toFixed(0)}%`, pos.x + 8, pos.y + 75)

        // Alert marker icon if failed
        if (isFailed) {
          ctx.fillStyle = '#ef4444'
          ctx.font = 'bold 16px sans-serif'
          ctx.fillText('⚠️ FAILED', pos.x + 4, pos.y + 92)
        }
      })

      // Draw zones
      const zones = frame.zones || []
      zones.forEach((zone) => {
        const pos = zonePositions[zone.id]
        if (!pos) return

        const band = getCustomTempBand(zone.temperature_c)
        const isSelected = selectedZoneId === zone.id

        // Base cell background with fixed threshold color
        ctx.fillStyle = band.bg
        ctx.fillRect(pos.x, pos.y, pos.w, pos.h)

        // Border
        ctx.lineWidth = isSelected ? 3 : 1.5
        ctx.strokeStyle = isSelected ? '#ffffff' : band.color
        ctx.strokeRect(pos.x, pos.y, pos.w, pos.h)

        // Header: Zone Name + Risk Icon
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 12px monospace'
        const riskIcon = zone.risk === 'CRITICAL' ? '🚨' : zone.risk === 'WARNING' ? '⚠️' : '🛡️'
        ctx.fillText(`${riskIcon} ${pos.label}`, pos.x + 10, pos.y + 22)

        // Temperature (Large, readable)
        ctx.fillStyle = band.color
        ctx.font = 'bold 22px monospace'
        ctx.fillText(`${zone.temperature_c.toFixed(1)}°C`, pos.x + 10, pos.y + 52)

        // Threshold status label
        ctx.font = 'bold 10px monospace'
        ctx.fillText(`[${band.label}]`, pos.x + 115, pos.y + 50)

        // Utilization Bar
        const barX = pos.x + 10
        const barY = pos.y + 65
        const barW = pos.w - 20
        const barH = 8
        ctx.fillStyle = 'rgba(51, 65, 85, 0.8)'
        ctx.fillRect(barX, barY, barW, barH)
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect(barX, barY, barW * Math.min(zone.utilization, 1), barH)

        // Metrics: Utilization, IT Power, Cooling Effect
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '10px monospace'
        ctx.fillText(`UTIL: ${(zone.utilization * 100).toFixed(0)}%`, pos.x + 10, pos.y + 90)
        ctx.fillText(`IT PWR: ${zone.it_power_kw.toFixed(1)} kW`, pos.x + 95, pos.y + 90)
        ctx.fillText(`COOL EFFECT: ${zone.cooling_effect_kw.toFixed(1)} kW`, pos.x + 10, pos.y + 110)
        ctx.fillText(`RISK: ${zone.risk}`, pos.x + 10, pos.y + 126)
      })

      // Draw Workload Movement Arrows (if any)
      const workloadMoves = frame.actions?.workload_moves || []
      workloadMoves.forEach((move) => {
        const fromPos = zonePositions[move.from_zone]
        const toPos = zonePositions[move.to_zone]
        if (!fromPos || !toPos) return

        const startX = fromPos.x + fromPos.w / 2
        const startY = fromPos.y + fromPos.h / 2
        const endX = toPos.x + toPos.w / 2
        const endY = toPos.y + toPos.h / 2

        ctx.save()
        ctx.strokeStyle = '#a855f7'
        ctx.fillStyle = '#a855f7'
        ctx.lineWidth = 3

        if (!prefersReducedMotion) {
          ctx.setLineDash([8, 6])
          ctx.lineDashOffset = -animOffset
        }

        // Draw curved connector
        const midX = (startX + endX) / 2
        const midY = (startY + endY) / 2 - 40
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.quadraticCurveTo(midX, midY, endX, endY)
        ctx.stroke()
        ctx.restore()

        // Draw arrow head at end
        ctx.save()
        ctx.fillStyle = '#c084fc'
        const angle = Math.atan2(endY - midY, endX - midX)
        ctx.translate(endX, endY)
        ctx.rotate(angle)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(-12, -6)
        ctx.lineTo(-12, 6)
        ctx.closePath()
        ctx.fill()
        ctx.restore()

        // Workload Migration Label
        ctx.fillStyle = '#f3e8ff'
        ctx.font = 'bold 11px monospace'
        ctx.fillText(`⚡ MOVE: ${move.amount.toFixed(1)} kW`, midX - 40, midY - 6)
      })

      if (!prefersReducedMotion) {
        animOffset = (animOffset + 0.5) % 28
        animFrameRef.current = requestAnimationFrame(render)
      }
    }

    render()

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [frame, selectedZoneId, prefersReducedMotion, zonePositions, cracPositions, thresholds])

  // Handle canvas click to select zone
  const handleCanvasClick = (e) => {
    if (!onSelectZone || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const clickX = (e.clientX - rect.left) * scaleX
    const clickY = (e.clientY - rect.top) * scaleY

    for (const [id, pos] of Object.entries(zonePositions)) {
      if (
        clickX >= pos.x &&
        clickX <= pos.x + pos.w &&
        clickY >= pos.y &&
        clickY <= pos.y + pos.h
      ) {
        onSelectZone(id)
        return
      }
    }
  }

  if (!frame) return null

  return (
    <div
      data-testid="heatmap-canvas-container"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#090d16',
        padding: '80px 20px 20px',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '920px',
          width: '100%',
          background: '#0f172a',
          borderRadius: '8px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Heatmap Banner / Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#38bdf8', fontWeight: 800, fontFamily: 'monospace', fontSize: '13px' }}>
              P0 GUARANTEED 2D THERMAL & WORKLOAD HEATMAP
            </span>
            <span style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>
              (5 Thermal Zones + Dual CRAC Cooling Units)
            </span>
          </div>
          <button
            onClick={() => setShowTable(!showTable)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #64748b',
              color: '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            {showTable ? 'Hide Accessible Table' : 'Show Accessible Table'}
          </button>
        </div>

        {/* HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          data-testid="zone-heatmap"
          width={920}
          height={430}
          onClick={handleCanvasClick}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            cursor: 'pointer',
          }}
          aria-label="Interactive 2D Thermal Heatmap showing five server zones and cooling units"
        />

        {/* FIXED THRESHOLD TEMPERATURE LEGEND (REQUIRED) */}
        <div
          data-testid="heatmap-legend"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '10px 16px',
            background: 'rgba(15, 23, 42, 0.98)',
            borderTop: '1px solid rgba(148, 163, 184, 0.2)',
            flexWrap: 'wrap',
            fontFamily: 'monospace',
            fontSize: '11px',
          }}
        >
          <span style={{ color: '#94a3b8', fontWeight: 700 }}>FIXED THRESHOLDS:</span>
          {thresholds.map((band) => (
            <div key={band.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '2px',
                  backgroundColor: band.color,
                  boxShadow: `0 0 4px ${band.color}`,
                }}
              />
              <span style={{ color: '#e2e8f0' }}>
                {band.max === 100 ? '> 34°C' : `≤ ${band.max}°C`} ({band.label})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Accessible Text / Screen Reader Table */}
      {showTable && (
        <div
          data-testid="accessible-zone-table"
          style={{
            marginTop: '16px',
            maxWidth: '920px',
            width: '100%',
            background: '#0f172a',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '6px',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#cbd5e1',
          }}
        >
          <h4 style={{ margin: '0 0 8px 0', color: '#38bdf8' }}>Accessible Zone Telemetry Table</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ padding: '6px' }}>Zone ID</th>
                <th style={{ padding: '6px' }}>Temperature</th>
                <th style={{ padding: '6px' }}>Utilization</th>
                <th style={{ padding: '6px' }}>IT Power</th>
                <th style={{ padding: '6px' }}>Cooling Effect</th>
                <th style={{ padding: '6px' }}>Risk Status</th>
              </tr>
            </thead>
            <tbody>
              {frame.zones?.map((z) => (
                <tr key={z.id} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.5)' }}>
                  <td style={{ padding: '6px', fontWeight: 700 }}>{z.id}</td>
                  <td style={{ padding: '6px' }}>{z.temperature_c.toFixed(1)}°C</td>
                  <td style={{ padding: '6px' }}>{(z.utilization * 100).toFixed(0)}%</td>
                  <td style={{ padding: '6px' }}>{z.it_power_kw.toFixed(1)} kW</td>
                  <td style={{ padding: '6px' }}>{z.cooling_effect_kw.toFixed(1)} kW</td>
                  <td style={{ padding: '6px', color: z.risk === 'SAFE' ? '#22c55e' : '#ef4444' }}>{z.risk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
