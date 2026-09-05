import { normalFixture } from './normal.js'
import { peakFixture } from './peak.js'
import { heatwaveFixture } from './heatwave.js'
import { coolingFailureFixture } from './cooling_failure.js'
import { safetyOverrideFixture } from './safety_override.js'
import { pausedFixture, failedFixture } from './states.js'
import { configFixture } from './config.js'

export { configFixture }

export const FIXTURES = {
  NORMAL: normalFixture,
  PEAK: peakFixture,
  HEATWAVE: heatwaveFixture,
  FAILURE: coolingFailureFixture,
  SAFETY_OVERRIDE: safetyOverrideFixture,
  PAUSED: pausedFixture,
  FAILED: failedFixture,
}

export function getFixture(scenarioOrState = 'NORMAL') {
  return FIXTURES[scenarioOrState] || normalFixture
}
