/**
 * Canonical Telemetry Contract definitions matching AGENTS.md
 */

export const SCENARIOS = {
  NORMAL: 'NORMAL',
  PEAK: 'PEAK',
  HEATWAVE: 'HEATWAVE',
  FAILURE: 'FAILURE',
}

export const CONTROLLERS = {
  RULE_BASED: 'RULE_BASED',
  COOLING_ONLY_RL: 'COOLING_ONLY_RL',
  JOINT_RL: 'JOINT_RL',
}

export const RUN_STATES = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
}

export const RISK_LEVELS = {
  SAFE: 'SAFE',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
}

export const CONNECTION_STATES = {
  LIVE: 'LIVE',
  CONNECTING: 'CONNECTING',
  RECONNECTING: 'RECONNECTING',
  STALE: 'STALE',
  DISCONNECTED: 'DISCONNECTED',
  FIXTURE: 'FIXTURE',
}

/**
 * Fixed temperature threshold bands (°C) for 2D heatmap.
 * These thresholds remain invariant across all frames.
 */
export const TEMP_THRESHOLDS = [
  { max: 22, label: 'OPTIMAL', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
  { max: 26, label: 'NORMAL', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.2)' },
  { max: 30, label: 'WARM', color: '#eab308', bg: 'rgba(234, 179, 8, 0.2)' },
  { max: 34, label: 'WARNING', color: '#f97316', bg: 'rgba(249, 115, 22, 0.2)' },
  { max: 100, label: 'CRITICAL', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.25)' },
]

export function getTempBand(tempC) {
  for (const band of TEMP_THRESHOLDS) {
    if (tempC <= band.max) return band
  }
  return TEMP_THRESHOLDS[TEMP_THRESHOLDS.length - 1]
}

/**
 * Validate that a frame matches the minimum required TelemetryFrame shape
 */
export function isValidTelemetryFrame(frame) {
  if (!frame || typeof frame !== 'object') return false
  if (frame.type !== 'telemetry.frame') return false
  if (typeof frame.sequence !== 'number') return false
  if (!frame.run_id || !frame.run_state || !frame.metrics) return false
  if (!Array.isArray(frame.zones) || frame.zones.length === 0) return false
  if (!Array.isArray(frame.cooling_units)) return false
  return true
}
