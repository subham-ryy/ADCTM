export const peakFixture = {
  type: 'telemetry.frame',
  schema_version: '1.0.0',
  run_id: 'run-fixture-peak-02',
  sequence: 200,
  timestamp: new Date().toISOString(),
  simulation_time_s: 620,
  run_state: 'RUNNING',
  scenario: 'PEAK',
  controller: 'JOINT_RL',
  metrics: {
    pue: 1.24,
    it_power_kw: 114.8,
    cooling_power_kw: 24.6,
    other_power_kw: 3.2,
    total_power_kw: 142.6,
    energy_used_kwh: 288.4,
    max_temperature_c: 27.6,
    sla_percent: 99.8,
    sla_violations: 0,
    shed_demand_kw: 0.0,
  },
  zones: [
    { id: 'zone-01', temperature_c: 25.8, utilization: 0.88, it_power_kw: 23.5, cooling_effect_kw: 21.0, risk: 'SAFE' },
    { id: 'zone-02', temperature_c: 26.9, utilization: 0.92, it_power_kw: 24.8, cooling_effect_kw: 22.5, risk: 'WARM' },
    { id: 'zone-03', temperature_c: 27.6, utilization: 0.94, it_power_kw: 25.2, cooling_effect_kw: 23.0, risk: 'WARM' },
    { id: 'zone-04', temperature_c: 25.4, utilization: 0.82, it_power_kw: 21.6, cooling_effect_kw: 20.0, risk: 'SAFE' },
    { id: 'zone-05', temperature_c: 24.9, utilization: 0.76, it_power_kw: 19.7, cooling_effect_kw: 19.5, risk: 'SAFE' },
  ],
  cooling_units: [
    { id: 'crac-01', command: 0.82, available_capacity: 1.0, status: 'AVAILABLE' },
    { id: 'crac-02', command: 0.79, available_capacity: 1.0, status: 'AVAILABLE' },
  ],
  actions: {
    proposed_cooling: [0.82, 0.79],
    applied_cooling: [0.82, 0.79],
    workload_moves: [
      { from_zone: 'zone-03', to_zone: 'zone-05', amount: 3.5 },
    ],
  },
  safety: {
    override_active: false,
    reasons: [],
  },
  events: [
    { code: 'PEAK_TRAFFIC_DETECTED', severity: 'INFO', message: 'Workload surge to 92% aggregate capacity. Dynamic cooling ramped to 82%.' },
  ],
}
