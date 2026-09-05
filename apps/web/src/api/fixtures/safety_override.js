export const safetyOverrideFixture = {
  type: 'telemetry.frame',
  schema_version: '1.0.0',
  run_id: 'run-fixture-override-05',
  sequence: 500,
  timestamp: new Date().toISOString(),
  simulation_time_s: 1410,
  run_state: 'RUNNING',
  scenario: 'FAILURE',
  controller: 'JOINT_RL',
  metrics: {
    pue: 1.58,
    it_power_kw: 65.0,
    cooling_power_kw: 38.0,
    other_power_kw: 3.2,
    total_power_kw: 106.2,
    energy_used_kwh: 690.0,
    max_temperature_c: 35.4,
    sla_percent: 98.4,
    sla_violations: 1,
    shed_demand_kw: 12.0,
  },
  zones: [
    { id: 'zone-01', temperature_c: 25.0, utilization: 0.60, it_power_kw: 15.0, cooling_effect_kw: 20.0, risk: 'SAFE' },
    { id: 'zone-02', temperature_c: 27.2, utilization: 0.55, it_power_kw: 14.0, cooling_effect_kw: 17.5, risk: 'WARM' },
    { id: 'zone-03', temperature_c: 35.4, utilization: 0.20, it_power_kw: 5.0, cooling_effect_kw: 6.0, risk: 'CRITICAL' },
    { id: 'zone-04', temperature_c: 33.1, utilization: 0.35, it_power_kw: 9.0, cooling_effect_kw: 7.5, risk: 'WARNING' },
    { id: 'zone-05', temperature_c: 26.1, utilization: 0.65, it_power_kw: 17.0, cooling_effect_kw: 18.0, risk: 'WARM' },
  ],
  cooling_units: [
    { id: 'crac-01', command: 1.0, available_capacity: 1.0, status: 'AVAILABLE' },
    { id: 'crac-02', command: 0.0, available_capacity: 0.0, status: 'FAILED' },
  ],
  actions: {
    proposed_cooling: [0.85, 0.0],
    applied_cooling: [1.0, 0.0], // Overridden by safety shield to 1.0
    workload_moves: [
      { from_zone: 'zone-03', to_zone: 'zone-01', amount: 10.0 },
    ],
  },
  safety: {
    override_active: true,
    reasons: [
      'Zone 3 temperature (35.4°C) breached emergency safety ceiling (35.0°C)',
      'Deterministic safety shield forced CRAC-01 to 100% capacity',
      'Emergency load shedding invoked: 12.0 kW shed',
    ],
  },
  events: [
    { code: 'SAFETY_SHIELD_TRIGGERED', severity: 'CRITICAL', message: 'Deterministic safety boundary invoked. RL action overridden.' },
  ],
}
