import { useSyncExternalStore } from 'react'

// Topology: Logical cooling influence weights between CRACs and Racks
// Based on physical proximity in the room
export const COOLING_TOPOLOGY = {
  'RACK-01': [
    { cracId: 'CRAC-01', weight: 0.80 },
    { cracId: 'CRAC-02', weight: 0.20 },
  ],
  'RACK-02': [
    { cracId: 'CRAC-01', weight: 0.65 },
    { cracId: 'CRAC-02', weight: 0.35 },
  ],
  'RACK-03': [
    { cracId: 'CRAC-01', weight: 0.25 },
    { cracId: 'CRAC-02', weight: 0.75 },
  ],
  'RACK-04': [
    { cracId: 'CRAC-01', weight: 0.75 },
    { cracId: 'CRAC-02', weight: 0.25 },
  ],
  'RACK-05': [
    { cracId: 'CRAC-01', weight: 0.50 },
    { cracId: 'CRAC-02', weight: 0.50 },
  ],
  'RACK-06': [
    { cracId: 'CRAC-01', weight: 0.20 },
    { cracId: 'CRAC-02', weight: 0.80 },
  ],
}

// The 10-Stage Closed-Loop Autonomous Data Center Causal Chain
export const CAUSAL_STEPS = [
  {
    step: 0,
    icon: '🌍',
    title: 'REAL-WORLD EVENT',
    subtitle: 'Flash Crowd Event Triggered',
    detail: 'External traffic surge initiated: global streaming / flash sale begins.',
    users: '24,000',
    requests: '320k req/s',
    workload: [45, 48, 46, 50, 47, 49],
    cracCapacity: 80,
    color: '#38bdf8',
  },
  {
    step: 1,
    icon: '👥',
    title: 'USERS INCREASE',
    subtitle: 'Active Sessions Spike +450%',
    detail: 'Global concurrent client connections multiply across ingress network edge points.',
    users: '86,000',
    requests: '980k req/s',
    workload: [58, 62, 60, 56, 59, 58],
    cracCapacity: 80,
    color: '#38bdf8',
  },
  {
    step: 2,
    icon: '📡',
    title: 'REQUESTS INCREASE',
    subtitle: 'API Gateway Ingress at 2.4M req/s',
    detail: 'Microservices and database queues experience sustained high-throughput transaction demand.',
    users: '142,000',
    requests: '2.4M req/s',
    workload: [72, 76, 75, 70, 74, 72],
    cracCapacity: 80,
    color: '#06b6d4',
  },
  {
    step: 3,
    icon: '🖥️',
    title: 'SERVER LOAD INCREASES',
    subtitle: 'Compute Cluster CPU/GPU at 96%',
    detail: 'Primary compute cluster (Row A) experiences extreme CPU utilization and memory saturation.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [65, 96, 95, 60, 68, 64],
    cracCapacity: 80,
    color: '#f59e0b',
  },
  {
    step: 4,
    icon: '⚡',
    title: 'POWER CONSUMPTION INCREASES',
    subtitle: 'IT Power Climbs to 62 kW',
    detail: 'Server rack PDUs and switched power supplies pull maximum phase current under full load.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [68, 98, 96, 62, 70, 65],
    cracCapacity: 80,
    color: '#f59e0b',
  },
  {
    step: 5,
    icon: '🔥',
    title: 'HEAT GENERATION INCREASES',
    subtitle: 'Thermal Output Surges to 72 kW',
    detail: 'Heavy compute dissipation dumps concentrated thermal energy directly into server exhaust air streams.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [70, 98, 97, 64, 72, 66],
    cracCapacity: 80,
    color: '#f97316',
  },
  {
    step: 6,
    icon: '🌡️',
    title: 'TEMPERATURE RISES',
    subtitle: 'Rack Hotspots Exceed 35°C (Critical)',
    detail: 'Baseline perimeter cooling capacity is overwhelmed; hotspot alarms trigger on Row A.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [74, 99, 98, 66, 74, 68],
    cracCapacity: 80,
    color: '#ef4444',
  },
  {
    step: 7,
    icon: '🤖',
    title: 'RL AGENT RESPONDS',
    subtitle: 'Autonomous Policy Execution',
    detail: 'Trained RL agent infers optimal state: migrates compute away from hotspots to cool nodes.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [68, 78, 76, 68, 70, 69],
    cracCapacity: 88,
    color: '#818cf8',
  },
  {
    step: 8,
    icon: '❄️',
    title: 'COOLING OPTIMIZED',
    subtitle: 'CRAC Variable-Speed Modulation',
    detail: 'CRAC compressors ramp to 92%, boosting airflow delivery and lowering subfloor plenum supply temp.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [62, 65, 64, 62, 64, 63],
    cracCapacity: 92,
    color: '#38bdf8',
  },
  {
    step: 9,
    icon: '🌡️',
    title: 'TEMPERATURE STABILIZES',
    subtitle: 'Thermal Equilibrium & Optimal PUE',
    detail: 'All server racks return to safe nominal 24°C; PUE optimized to 1.20 with zero compute throttling.',
    users: '190,000',
    requests: '3.6M req/s',
    workload: [60, 62, 62, 60, 61, 60],
    cracCapacity: 85,
    color: '#22c55e',
  },
]

// Initial deterministic state
const initialSimulationState = {
  viewMode: 'REALISTIC', // 'REALISTIC' | 'TEMPERATURE' | 'WORKLOAD' | 'POWER'
  activeScenario: 'NORMAL', // 'NORMAL' | 'SPIKE' | 'CRAC_FAIL' | 'AIRFLOW_BLOCK' | 'RL_OPTIMIZE'
  selectedRackId: 'RACK-03',
  hoveredRackId: null,
  selectedCracId: null,
  hoveredCracId: null,

  // Causal Chain State (Interactive 10-stage closed loop)
  causalMode: true,
  causalStep: 6, // STAGE 7: 🌡️ TEMPERATURE RISES
  causalPlaying: false,

  facility: {
    ambientTemp: 21.5, // °C
    totalItPower: 45.2, // kW
    coolingPower: 16.8, // kW
    facilityPower: 68.2, // kW
    pue: 1.34,
    avgRackTemp: 26.8, // °C
    status: 'NORMAL', // 'NORMAL' | 'WARNING' | 'CRITICAL'
  },

  racks: [
    {
      id: 'RACK-01',
      name: 'RACK-01',
      row: 'Row A (Cold Aisle Left)',
      position: [-1.8, 0, -2.4],
      rotation: [0, Math.PI / 2, 0],
      workload: 42,
      itPower: 5.2,
      temp: 24.2,
      tempTop: 25.5,
      tempMid: 24.2,
      tempBottom: 22.4,
      coolingReceived: 88,
      airflow: 'NORMAL', // 'NORMAL' | 'RESTRICTED'
      health: 96,
      healthStatus: 'HEALTHY',
      status: 'NORMAL',
      serversCount: 14,
    },
    {
      id: 'RACK-02',
      name: 'RACK-02',
      row: 'Row A (Cold Aisle Left)',
      position: [-1.8, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      workload: 65,
      itPower: 7.8,
      temp: 27.1,
      tempTop: 28.9,
      tempMid: 27.1,
      tempBottom: 25.0,
      coolingReceived: 82,
      airflow: 'NORMAL',
      health: 91,
      healthStatus: 'HEALTHY',
      status: 'NORMAL',
      serversCount: 14,
    },
    {
      id: 'RACK-03',
      name: 'RACK-03',
      row: 'Row A (Cold Aisle Left)',
      position: [-1.8, 0, 2.4],
      rotation: [0, Math.PI / 2, 0],
      workload: 85,
      itPower: 11.2,
      temp: 31.4,
      tempTop: 33.8,
      tempMid: 31.4,
      tempBottom: 29.1,
      coolingReceived: 68,
      airflow: 'NORMAL',
      health: 72,
      healthStatus: 'WARNING',
      status: 'WARNING',
      serversCount: 14,
    },
    {
      id: 'RACK-04',
      name: 'RACK-04',
      row: 'Row B (Cold Aisle Right)',
      position: [1.8, 0, -2.4],
      rotation: [0, -Math.PI / 2, 0],
      workload: 48,
      itPower: 5.9,
      temp: 24.8,
      tempTop: 26.2,
      tempMid: 24.8,
      tempBottom: 23.0,
      coolingReceived: 86,
      airflow: 'NORMAL',
      health: 95,
      healthStatus: 'HEALTHY',
      status: 'NORMAL',
      serversCount: 14,
    },
    {
      id: 'RACK-05',
      name: 'RACK-05',
      row: 'Row B (Cold Aisle Right)',
      position: [1.8, 0, 0],
      rotation: [0, -Math.PI / 2, 0],
      workload: 72,
      itPower: 8.8,
      temp: 28.3,
      tempTop: 30.4,
      tempMid: 28.3,
      tempBottom: 26.2,
      coolingReceived: 78,
      airflow: 'NORMAL',
      health: 86,
      healthStatus: 'WATCH',
      status: 'NORMAL',
      serversCount: 14,
    },
    {
      id: 'RACK-06',
      name: 'RACK-06',
      row: 'Row B (Cold Aisle Right)',
      position: [1.8, 0, 2.4],
      rotation: [0, -Math.PI / 2, 0],
      workload: 96,
      itPower: 12.8,
      temp: 34.2,
      tempTop: 37.1,
      tempMid: 34.2,
      tempBottom: 31.8,
      coolingReceived: 62,
      airflow: 'NORMAL',
      health: 46,
      healthStatus: 'CRITICAL',
      status: 'CRITICAL',
      serversCount: 14,
    },
  ],

  cracs: [
    {
      id: 'CRAC-01',
      name: 'CRAC-01 (Primary West)',
      position: [-6.2, 0, -2.0],
      rotation: [0, Math.PI / 2, 0],
      capacity: 82, // %
      power: 8.8, // kW
      status: 'ACTIVE', // 'ACTIVE' | 'WARNING' | 'FAILED'
      airflow: 17200, // CFM
      connectedRacks: ['RACK-01', 'RACK-02', 'RACK-03', 'RACK-04', 'RACK-05'],
    },
    {
      id: 'CRAC-02',
      name: 'CRAC-02 (Secondary East)',
      position: [-6.2, 0, 2.0],
      rotation: [0, Math.PI / 2, 0],
      capacity: 75, // %
      power: 8.0, // kW
      status: 'ACTIVE',
      airflow: 15800, // CFM
      connectedRacks: ['RACK-02', 'RACK-03', 'RACK-05', 'RACK-06'],
    },
  ],
}

// Deterministic physical causal calculation engine
// Propagates Workload -> IT Power -> Heat -> Cooling Availability -> Temp -> Health -> PUE
function recomputePhysicalState(state) {
  const ambient = state.facility.ambientTemp

  // 1. Recompute CRAC powers & airflows
  const updatedCracs = state.cracs.map((crac) => {
    const isFailed = crac.status === 'FAILED'
    const capacity = isFailed ? 0 : crac.capacity
    const power = isFailed ? 0.8 : 2.5 + (capacity / 100) * 8.5
    const airflow = isFailed ? 0 : Math.round(4000 + (capacity / 100) * 16000)
    return { ...crac, capacity, power, airflow }
  })

  // 2. Recompute each Rack based on Workload and Connected CRAC Cooling
  const updatedRacks = state.racks.map((rack) => {
    // IT Power model: 2.2 kW baseline idle + workload delta
    const itPower = 2.2 + (rack.workload / 100) * 11.0
    // Heat generated in kW thermal
    const heatGen = itPower * 1.12

    // Calculate cooling contribution from connected CRACs
    const connections = COOLING_TOPOLOGY[rack.id] || []
    let totalCoolingDelivered = 0
    let potentialCoolingCapacity = 0

    connections.forEach(({ cracId, weight }) => {
      const crac = updatedCracs.find((c) => c.id === cracId)
      if (crac) {
        const cracCoolingKW = (crac.capacity / 100) * 14.5 * weight
        potentialCoolingCapacity += 14.5 * weight
        if (crac.status !== 'FAILED') {
          totalCoolingDelivered += cracCoolingKW
        }
      }
    })

    // Airflow effectiveness: 1.0 if normal, 0.60 if restricted/missing blanking panels
    const airflowFactor = rack.airflow === 'RESTRICTED' ? 0.60 : 1.0
    const effectiveCooling = totalCoolingDelivered * airflowFactor

    // Percentage of required cooling received
    const coolingReceived = Math.min(
      100,
      Math.max(0, Math.round((effectiveCooling / (heatGen || 1)) * 82))
    )

    // Thermal balance equation:
    // When heatGen > effectiveCooling, temperature climbs above ambient
    const netThermalDeficit = Math.max(0, heatGen - effectiveCooling * 0.88)
    const tempRise = netThermalDeficit * 2.1
    const rackTemp = Math.round((ambient + tempRise) * 10) / 10

    // Virtual thermal zones:
    // Bottom: cold intake from floor vent
    // Mid: average chassis temp
    // Top: accumulated hot exhaust rising through rack
    const tempBottom = Math.round((rackTemp - 1.8) * 10) / 10
    const tempMid = rackTemp
    const tempTop =
      Math.round((rackTemp + 1.2 + (rack.workload / 100) * 2.2) * 10) / 10

    // Health score (0 - 100%)
    let health = 100
    if (rackTemp > 25.0) health -= (rackTemp - 25.0) * 3.8
    if (coolingReceived < 75) health -= (75 - coolingReceived) * 0.5
    if (rack.airflow === 'RESTRICTED') health -= 18
    const anyConnectedCracFailed = connections.some(({ cracId }) => {
      const c = updatedCracs.find((item) => item.id === cracId)
      return c && c.status === 'FAILED'
    })
    if (anyConnectedCracFailed) health -= 14
    health = Math.min(100, Math.max(0, Math.round(health)))

    // Health label
    let healthStatus = 'HEALTHY'
    if (health < 50) healthStatus = 'CRITICAL'
    else if (health < 75) healthStatus = 'WARNING'
    else if (health < 95) healthStatus = 'WATCH'

    // Status label
    let status = 'NORMAL'
    if (rackTemp >= 33.0 || health < 50) status = 'CRITICAL'
    else if (rackTemp >= 28.5 || health < 75) status = 'WARNING'

    return {
      ...rack,
      itPower: Math.round(itPower * 10) / 10,
      temp: rackTemp,
      tempTop,
      tempMid,
      tempBottom,
      coolingReceived,
      health,
      healthStatus,
      status,
    }
  })

  // 3. Recompute Facility Totals & PUE
  const totalItPower =
    Math.round(
      updatedRacks.reduce((acc, r) => acc + r.itPower, 0) * 10
    ) / 10
  const coolingPower =
    Math.round(
      updatedCracs.reduce((acc, c) => acc + c.power, 0) * 10
    ) / 10
  const baseInfrastructurePower = 6.0 // UPS, baseline facility losses, lighting (kW)
  const facilityPower =
    Math.round(
      (totalItPower + coolingPower + baseInfrastructurePower) * 10
    ) / 10
  const pue =
    totalItPower > 0
      ? Math.round((facilityPower / totalItPower) * 100) / 100
      : 1.34

  const avgRackTemp =
    Math.round(
      (updatedRacks.reduce((acc, r) => acc + r.temp, 0) /
        updatedRacks.length) *
        10
    ) / 10

  const hasCritical = updatedRacks.some((r) => r.status === 'CRITICAL')
  const hasWarning =
    updatedRacks.some((r) => r.status === 'WARNING') ||
    updatedCracs.some((c) => c.status === 'FAILED')

  const facilityStatus = hasCritical
    ? 'CRITICAL'
    : hasWarning
    ? 'WARNING'
    : 'NORMAL'

  return {
    ...state,
    racks: updatedRacks,
    cracs: updatedCracs,
    facility: {
      ...state.facility,
      totalItPower,
      coolingPower,
      facilityPower,
      pue,
      avgRackTemp,
      status: facilityStatus,
    },
  }
}

const IS_LIVE_MODE = (import.meta.env.VITE_DATA_MODE || '').toLowerCase() === 'live'
if (IS_LIVE_MODE) {
  initialSimulationState.causalMode = false
}

// Reactive store
const initStep = CAUSAL_STEPS[initialSimulationState.causalStep || 0]
const initRacks = (initialSimulationState.causalMode && !IS_LIVE_MODE)
  ? initialSimulationState.racks.map((r, i) => ({
      ...r,
      workload:
        initStep.workload[i] !== undefined ? initStep.workload[i] : r.workload,
    }))
  : initialSimulationState.racks
const initCracs = (initialSimulationState.causalMode && !IS_LIVE_MODE)
  ? initialSimulationState.cracs.map((c) => ({
      ...c,
      capacity: initStep.cracCapacity,
    }))
  : initialSimulationState.cracs

let currentState = recomputePhysicalState({
  ...initialSimulationState,
  causalMode: !IS_LIVE_MODE && initialSimulationState.causalMode,
  racks: initRacks,
  cracs: initCracs,
})
const listeners = new Set()

function emitChange() {
  listeners.forEach((listener) => listener())
}

export const simulationStore = {
  getState() {
    return currentState
  },

  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  // Authoritative sync from backend frame (NO physics recalculation)
  syncFromTelemetryFrame(frame) {
    if (!frame) return
    const zones = frame.zones || []
    const coolingUnits = frame.cooling_units || []

    const nextRacks = currentState.racks.map((r, idx) => {
      const zone = zones[idx] || zones[zones.length - 1]
      if (!zone) return r
      return {
        ...r,
        temp: zone.temperature_c,
        workload: zone.utilization * 100,
        itPower: zone.it_power_kw,
        status: zone.risk === 'CRITICAL' ? 'CRITICAL' : zone.risk === 'WARNING' ? 'WARNING' : 'OPTIMAL',
        healthScore: zone.risk === 'CRITICAL' ? 45 : zone.risk === 'WARNING' ? 70 : 98,
        thermalZones: {
          top: zone.temperature_c + 1.2,
          mid: zone.temperature_c,
          bottom: zone.temperature_c - 1.2,
        },
      }
    })

    const nextCracs = currentState.cracs.map((c, idx) => {
      const cu = coolingUnits[idx]
      if (!cu) return c
      return {
        ...c,
        status: cu.status === 'FAILED' ? 'FAILED' : 'ACTIVE',
        capacity: cu.available_capacity * 100,
        coolingCapacity: cu.available_capacity * 100,
      }
    })

    currentState = {
      ...currentState,
      racks: nextRacks,
      cracs: nextCracs,
      facility: {
        ...currentState.facility,
        pue: frame.metrics?.pue || currentState.facility.pue,
        totalItPower: frame.metrics?.it_power_kw || currentState.facility.totalItPower,
        coolingPower: frame.metrics?.cooling_power_kw || currentState.facility.coolingPower,
        facilityPower: frame.metrics?.total_power_kw || currentState.facility.facilityPower,
        avgRackTemp: frame.metrics?.max_temperature_c || currentState.facility.avgRackTemp,
        status: frame.safety?.override_active ? 'SAFETY OVERRIDE' : frame.run_state,
      },
    }
    emitChange()
  },

  setViewMode(viewMode) {
    currentState = { ...currentState, viewMode }
    emitChange()
  },

  setSelectedRack(rackId) {
    currentState = {
      ...currentState,
      selectedRackId: rackId,
      selectedCracId: null,
    }
    emitChange()
  },

  setHoveredRack(rackId) {
    if (currentState.hoveredRackId !== rackId) {
      currentState = { ...currentState, hoveredRackId: rackId }
      emitChange()
    }
  },

  setSelectedCrac(cracId) {
    currentState = {
      ...currentState,
      selectedCracId: cracId,
      selectedRackId: null,
    }
    emitChange()
  },

  setHoveredCrac(cracId) {
    if (currentState.hoveredCracId !== cracId) {
      currentState = { ...currentState, hoveredCracId: cracId }
      emitChange()
    }
  },

  updateRack(rackId, updates) {
    const updatedRacks = currentState.racks.map((r) =>
      r.id === rackId ? { ...r, ...updates } : r
    )
    currentState = recomputePhysicalState({
      ...currentState,
      racks: updatedRacks,
    })
    emitChange()
  },

  updateCrac(cracId, updates) {
    const updatedCracs = currentState.cracs.map((c) =>
      c.id === cracId ? { ...c, ...updates } : c
    )
    currentState = recomputePhysicalState({
      ...currentState,
      cracs: updatedCracs,
    })
    emitChange()
  },

  // 5 Deterministic What-If Scenarios
  loadScenario(scenarioName) {
    let nextRacks = [...currentState.racks]
    let nextCracs = [...currentState.cracs]

    switch (scenarioName) {
      case 'NORMAL':
        // Safe, balanced steady state
        nextCracs = nextCracs.map((c) => ({
          ...c,
          status: 'ACTIVE',
          capacity: 80,
        }))
        nextRacks = nextRacks.map((r, i) => ({
          ...r,
          workload: [45, 52, 48, 50, 55, 46][i],
          airflow: 'NORMAL',
        }))
        break

      case 'SPIKE':
        // Compute workload spike on RACK-02 and RACK-03
        nextCracs = nextCracs.map((c) => ({
          ...c,
          status: 'ACTIVE',
          capacity: 80,
        }))
        nextRacks = nextRacks.map((r) => {
          if (r.id === 'RACK-02') return { ...r, workload: 95, airflow: 'NORMAL' }
          if (r.id === 'RACK-03') return { ...r, workload: 92, airflow: 'NORMAL' }
          return { ...r, airflow: 'NORMAL' }
        })
        break

      case 'CRAC_FAIL':
        // CRAC-01 suffers total compressor failure
        nextCracs = nextCracs.map((c) =>
          c.id === 'CRAC-01'
            ? { ...c, status: 'FAILED', capacity: 0 }
            : { ...c, status: 'ACTIVE', capacity: 75 }
        )
        // Connected racks (RACK-01, 02, 03) will lose cooling and heat up
        break

      case 'AIRFLOW_BLOCK':
        // Missing blanking panels / airflow blockage on RACK-05
        nextCracs = nextCracs.map((c) => ({
          ...c,
          status: 'ACTIVE',
          capacity: 80,
        }))
        nextRacks = nextRacks.map((r) =>
          r.id === 'RACK-05'
            ? { ...r, airflow: 'RESTRICTED', workload: 78 }
            : { ...r, airflow: 'NORMAL' }
        )
        break

      case 'RL_OPTIMIZE':
        // Autonomous RL controller redistributes workload & optimizes cooling
        nextCracs = nextCracs.map((c) =>
          c.id === 'CRAC-01' && c.status === 'FAILED'
            ? c // Leave failed if it was failed, or active
            : { ...c, status: 'ACTIVE', capacity: 88 }
        )
        // Rebalance workload evenly across cooler racks
        nextRacks = nextRacks.map((r, i) => ({
          ...r,
          workload: [55, 58, 60, 54, 52, 56][i],
          airflow: 'NORMAL',
        }))
        break

      default:
        break
    }

    currentState = recomputePhysicalState({
      ...currentState,
      activeScenario: scenarioName,
      racks: nextRacks,
      cracs: nextCracs,
    })
    emitChange()
  },

  // 10-Stage Causal Event Sequence Controls
  setCausalMode(active) {
    currentState = {
      ...currentState,
      causalMode: active,
      causalPlaying: false,
    }
    if (active) {
      this.setCausalStep(0)
    } else {
      this.loadScenario('NORMAL')
    }
    emitChange()
  },

  setCausalStep(stepIndex) {
    const idx = Math.max(0, Math.min(CAUSAL_STEPS.length - 1, stepIndex))
    const stepData = CAUSAL_STEPS[idx]

    const updatedCracs = currentState.cracs.map((c) => ({
      ...c,
      status: 'ACTIVE',
      capacity: stepData.cracCapacity,
    }))

    const updatedRacks = currentState.racks.map((r, i) => ({
      ...r,
      workload: stepData.workload[i] !== undefined ? stepData.workload[i] : 50,
      airflow: 'NORMAL',
    }))

    currentState = recomputePhysicalState({
      ...currentState,
      causalMode: true,
      causalStep: idx,
      racks: updatedRacks,
      cracs: updatedCracs,
    })
    emitChange()
  },

  nextCausalStep() {
    const next = (currentState.causalStep + 1) % CAUSAL_STEPS.length
    this.setCausalStep(next)
  },

  prevCausalStep() {
    const prev =
      (currentState.causalStep - 1 + CAUSAL_STEPS.length) % CAUSAL_STEPS.length
    this.setCausalStep(prev)
  },

  toggleCausalPlayback() {
    currentState = {
      ...currentState,
      causalPlaying: !currentState.causalPlaying,
    }
    emitChange()
  },
}

export function useSimulationState() {
  return useSyncExternalStore(
    simulationStore.subscribe,
    simulationStore.getState
  )
}

// Helpers for UI color codes
export function getTemperatureColor(temp) {
  if (temp < 25.5) return '#22c55e' // Cool/Normal (Green)
  if (temp < 28.5) return '#eab308' // Warm (Yellow)
  if (temp < 32.5) return '#f97316' // Hot (Orange)
  return '#ef4444' // Critical (Red)
}

export function getWorkloadColor(workload) {
  if (workload < 50) return '#38bdf8' // Low/Normal (Cyan)
  if (workload < 75) return '#818cf8' // Medium (Indigo)
  if (workload < 90) return '#fbbf24' // High (Amber)
  return '#f43f5e' // Heavy (Rose)
}

export function getHealthColor(health) {
  if (health >= 95) return '#22c55e' // Healthy (Green)
  if (health >= 75) return '#38bdf8' // Watch (Cyan)
  if (health >= 50) return '#f59e0b' // Warning (Amber)
  return '#ef4444' // Critical (Red)
}

export function getPowerColor(kw) {
  if (kw < 6.5) return '#10b981'
  if (kw < 10.0) return '#38bdf8'
  return '#f59e0b'
}
