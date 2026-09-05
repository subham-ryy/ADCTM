import { normalFixture } from './normal.js'

export const pausedFixture = {
  ...normalFixture,
  run_id: 'run-fixture-paused-06',
  sequence: 600,
  run_state: 'PAUSED',
  events: [
    { code: 'SIMULATION_PAUSED', severity: 'INFO', message: 'Operator issued pause command. Simulation clock halted at 300s.' },
  ],
}

export const failedFixture = {
  ...normalFixture,
  run_id: 'run-fixture-failed-07',
  sequence: 700,
  run_state: 'FAILED',
  metrics: {
    ...normalFixture.metrics,
    sla_percent: 88.0,
    sla_violations: 5,
  },
  events: [
    { code: 'RUN_TERMINATED_FAILED', severity: 'CRITICAL', message: 'Run failed: SLA violation ceiling exceeded permissible limit.' },
  ],
}
