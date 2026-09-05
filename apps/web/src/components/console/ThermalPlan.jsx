import { useEffect, useRef } from 'react'
import { fmt, pct, tempColor, ZONE_LAYOUT, zoneName } from './presentation'

const positions = [[125, 95], [390, 95], [655, 95], [255, 325], [530, 325]]
export default function ThermalPlan({ frame, config, selectedZone, onSelectZone, reduceMotion, layer = 'thermal' }) {
  const canvas = useRef(null)
  useEffect(() => {
    const element = canvas.current
    const resize = () => {
      const parent = element.parentElement.getBoundingClientRect()
      const width = Math.min(parent.width, parent.height * 1000 / 560)
      element.style.width = `${width}px`; element.style.height = `${width * 560 / 1000}px`
    }
    const observer = new ResizeObserver(resize); observer.observe(element.parentElement); resize()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    let raf
    const draw = (time = 0) => {
      ctx.clearRect(0, 0, 1000, 560)
      ctx.fillStyle = '#101c26'; ctx.fillRect(60, 60, 880, 455)
      ctx.strokeStyle = '#ffffff07'; ctx.lineWidth = 1
      for (let x = 60; x < 941; x += 40) { ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, 515); ctx.stroke() }
      for (let y = 60; y < 516; y += 40) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(940, y); ctx.stroke() }
      ctx.fillStyle = '#65decd0d'; ctx.fillRect(70, 275, 860, 28)
      ctx.font = '10px Segoe UI'; ctx.fillStyle = '#62b4b5'; ctx.textAlign = 'center'; ctx.fillText('C O L D   A I S L E   /   C O N T R O L L E D   C O O L I N G', 500, 294)
      ZONE_LAYOUT.forEach((zone, i) => {
        const data = frame?.zones[i], [x, y] = positions[i], color = tempColor(data?.temperature_c, config)
        ctx.fillStyle = selectedZone === zone.id ? '#233c47' : '#172731'; ctx.fillRect(x, y, 215, 150)
        ctx.strokeStyle = selectedZone === zone.id ? '#abfff1' : '#2f424d'; ctx.strokeRect(x, y, 215, 150)
        ctx.fillStyle = color; ctx.fillRect(x, y, 3, 150)
        ctx.textAlign = 'left'; ctx.font = '600 14px Segoe UI'; ctx.fillStyle = '#c8d9e5'; ctx.fillText(zone.name.toUpperCase(), x + 17, y + 26)
        ctx.font = '500 34px Segoe UI'; ctx.fillStyle = layer === 'load' ? '#bbc4fa' : color; ctx.fillText(layer === 'load' ? pct(data?.utilization) : `${fmt(data?.temperature_c)}°`, x + 17, y + 70)
        ctx.font = '12px Segoe UI'; ctx.fillStyle = '#8fa6b5'; ctx.fillText(`Workload ${pct(data?.utilization)}`, x + 17, y + 103)
        ctx.fillStyle = '#2a3b4a'; ctx.fillRect(x + 17, y + 113, 180, 5); ctx.fillStyle = '#8ea5d5'; ctx.fillRect(x + 17, y + 113, 180 * (data?.utilization || 0), 5)
        ctx.font = '10px Segoe UI'; ctx.fillStyle = data?.capacity < 1 ? '#edbb75' : '#65dcca'; ctx.fillText(`COOL ${pct(data?.cooling)}  /  CAP ${pct(data?.capacity)}`, x + 17, y + 137)
      })
      for (const move of frame?.actions?.workload_moves || []) {
        const from = ZONE_LAYOUT.findIndex((z) => z.id === move.from_zone), to = ZONE_LAYOUT.findIndex((z) => z.id === move.to_zone)
        if (from < 0 || to < 0) continue
        const [fx, fy] = positions[from], [tx, ty] = positions[to]
        ctx.strokeStyle = '#b5a7ff'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.lineDashOffset = reduceMotion ? 0 : -time / 45
        ctx.beginPath(); ctx.moveTo(fx + 105, fy + 75); ctx.quadraticCurveTo((fx + tx) / 2 + 105, Math.min(fy, ty) - 40, tx + 105, ty + 75); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = '#d6ceff'; ctx.font = 'bold 13px Segoe UI'; ctx.fillText('↓', tx + 100, ty + 70)
      }
      if (!reduceMotion && frame?.actions?.workload_moves?.length) raf = requestAnimationFrame(draw)
    }
    draw(); return () => cancelAnimationFrame(raf)
  }, [frame, config, selectedZone, reduceMotion, layer])
  return <div className="thermal-plan"><canvas ref={canvas} width="1000" height="560" aria-label="Five-zone thermal floor plan" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) * 1000 / r.width, y = (e.clientY - r.top) * 560 / r.height; const i = positions.findIndex(([px, py]) => x >= px && x <= px + 215 && y >= py && y <= py + 150); if (i >= 0) onSelectZone(ZONE_LAYOUT[i].id) }} /><table className="sr-only"><caption>Current zone measurements; use zone buttons below to inspect</caption><thead><tr><th>Zone</th><th>Temperature</th><th>Workload</th><th>Cooling capacity</th></tr></thead><tbody>{frame?.zones.map((z) => <tr key={z.id}><th>{zoneName(z.id)}</th><td>{fmt(z.temperature_c)}°C</td><td>{pct(z.utilization)}</td><td>{pct(z.capacity)}</td></tr>)}</tbody></table></div>
}
