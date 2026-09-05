import * as THREE from 'three'

// Generates a realistic industrial data-center raised-floor access tile texture (600mm x 600mm)
// Light gray vinyl / antistatic coating (NOT pure white) with crisp neutral seams and corner screws
export function getFloorTileTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  // Base tile surface - realistic industrial light gray (Slate-350)
  ctx.fillStyle = '#b4bec9'
  ctx.fillRect(0, 0, 512, 512)

  // Subtle stipple / antistatic noise
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
  for (let i = 0; i < 3500; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  // Darker micro-grain for realistic matte vinyl texture
  ctx.fillStyle = 'rgba(71, 85, 105, 0.15)'
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  // Inner tile beveled border
  ctx.strokeStyle = '#9aa5b4'
  ctx.lineWidth = 3
  ctx.strokeRect(3, 3, 506, 506)

  // Outer recessed expansion joint / seam (defined slate gray)
  ctx.strokeStyle = '#5a6677'
  ctx.lineWidth = 5
  ctx.strokeRect(0, 0, 512, 512)

  // 4 corner leveling / lock fastener screws
  const screwOffsets = [
    [22, 22],
    [490, 22],
    [22, 490],
    [490, 490],
  ]
  screwOffsets.forEach(([sx, sy]) => {
    ctx.fillStyle = '#7a8797'
    ctx.beginPath()
    ctx.arc(sx, sy, 6, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Screw head slot
    ctx.strokeStyle = '#334155'
    ctx.beginPath()
    ctx.moveTo(sx - 3, sy)
    ctx.lineTo(sx + 3, sy)
    ctx.moveTo(sx, sy - 3)
    ctx.lineTo(sx, sy + 3)
    ctx.stroke()
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// Generates a perforated cold-aisle floor ventilation grille texture
export function getVentGrilleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  // Perforated plate background - brushed steel gray
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(0, 0, 512, 512)

  // Brushed aluminum outer frame
  ctx.fillStyle = '#64748b'
  ctx.fillRect(0, 0, 512, 24)
  ctx.fillRect(0, 488, 512, 24)
  ctx.fillRect(0, 0, 24, 512)
  ctx.fillRect(488, 0, 24, 512)

  // Cross reinforcing ribs
  ctx.fillStyle = '#475569'
  ctx.fillRect(0, 248, 512, 16)
  ctx.fillRect(248, 0, 16, 512)

  // Perforation airflow holes (dark contrast)
  ctx.fillStyle = '#0f172a'
  const step = 20
  for (let y = 36; y < 484; y += step) {
    const isOdd = Math.floor(y / step) % 2 === 1
    const xStart = isOdd ? 38 : 48
    for (let x = xStart; x < 484; x += step) {
      if (Math.abs(x - 256) < 16 || Math.abs(y - 256) < 16) continue
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Frame bevel highlight
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 2
  ctx.strokeRect(24, 24, 464, 464)

  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

// Generates a server front-panel micro-mesh texture
export function getMeshPerforatedTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#1e232a'
  ctx.fillRect(0, 0, 128, 128)

  ctx.fillStyle = '#0c0f13'
  const step = 8
  for (let y = 0; y < 128; y += step) {
    const offset = (y / step) % 2 === 0 ? 0 : 4
    for (let x = offset; x < 128; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  return texture
}
