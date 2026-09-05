export const heatwaveFixture = {
  type: 'telemetry.frame',
  schema_version: '1.0.0',
  run_id: 'run-fixture-heatwave-03',
  sequence: 300,
  timestamp: new Date().toISOString(),
  simulation_time_s: 940,
  run_state: 'RUNNING',
  scenario: 'HEATWAVE',
  controller: 'JOINT_RL',
  metrics: {
    pue: 1.35,
    it_power_kw: 85.0,
    cooling_power_kw: 29.8,
    other_power_kw: 3.5,
    total_power_kw: 118.3,
    energy_used_kwh: 410.2,
    max_temperature_c: 30.8,
    sla_percent: 99.5,
    sla_violations: 0,
    shed_demand_kw: 0.0,
  },
  zones: [
    { id: 'zone-01', temperature_c: 28.5, utilization: 0.65, it_power_kw: 17.2, cooling_effect_kw: 18.0, risk: 'WARM' },
    { id: 'zone-02', temperature_c: 29.8, utilization: 0.68, it_power_kw: 18.1, cooling_effect_kw: 18.2, risk: 'WARM' },
    { id: 'zone-03', temperature_c: 30.8, utilization: 0.70, it_power_kw: 18.5, cooling_effect_kw: 18.0, risk: 'WARNING' },
    { id: 'zone-04', temperature_c: 29.2, utilization: 0.64, it_power_kw: 16.8, cooling_effect_kw: 17.5, risk: 'WARM' },
    { id: 'zone-05', temperature_c: 28.1, utilization: 0.60, it_power_kw: 14.4, cooling_effect_kw: 16.0, risk: 'WARM' },
  ],
  cooling_units: [
    { id: 'crac-01', command: 0.95, available_capacity: 1.0, status: 'AVAILABLE' },
    { id: 'crac-02', command: 0.92, available_capacity: 1.0, status: 'AVAILABLE' },
  ],
  actions: {
    proposed_cooling: [0.95, 0.92],
    applied_cooling: [0.95, 0.92],
    workload_moves: [
      { from_zone: 'zone-03', to_zone: 'zone-05', amount: 5.0 },
    ],
  },
  safety: {
    override_active: false,
    reasons: [],
  },
  events: [
    { code: 'EXTERNAL_HEAT_SURGE', severity: 'WARNING', message: 'Ambient condenser temperature at 41°C. Elevated chiller lift active.' },
  ],
}
