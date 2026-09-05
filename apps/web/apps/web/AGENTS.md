# AGENTS.md — Frontend Workspace

These instructions apply only to the frontend workspace, ideally at `apps/web/AGENTS.md`. They supplement the project's root `AGENTS.md`. Read both files before making changes.

## Mission

Build the operator-facing interface for the Autonomous Data Center Thermal + Workload Controller.

The frontend must make this sequence obvious to a judge without verbal explanation:

```text
Scenario or failure occurs
→ controller takes an action
→ cooling/workload allocation changes
→ temperatures and power respond
→ safety and SLA outcome becomes visible
```

The frontend is a presentation and command surface. It must never calculate authoritative physics, rewards, PUE, safety decisions, controller actions, or benchmark results.

## Scope boundary

### Frontend owns

- Next.js application structure;
- React components and TypeScript types;
- REST and WebSocket client adapters;
- connection, loading, stale, empty, paused, and error states;
- status header and run controls;
- 2D Canvas thermal heatmap;
- temperature, power, and PUE charts;
- scenario selector;
- deterministic event/decision presentation from backend data;
- benchmark comparison table;
- optional Three.js digital-twin view;
- optional Blender-authored GLB assets; and
- responsive and accessible presentation.

### Frontend does not own

- thermal equations or simulation state transitions;
- reinforcement-learning training or inference;
- safety-shield rules;
- workload-allocation decisions;
- scenario generation;
- benchmark execution or metric aggregation;
- fabricated or hand-tuned demo metrics;
- backend API implementation;
- authentication, databases, message brokers, or external APIs; or
- LLM-based control or decision generation.

If backend data is missing, show an explicit unavailable, loading, stale, or disconnected state. Do not silently invent a value.

## Technology

- Next.js with React and TypeScript
- HTML5 Canvas for the guaranteed P0 heatmap
- Recharts or Chart.js for charts; choose one and do not install both
- Three.js for the optional 3D digital twin
- Blender may be used to create/export optional `.glb` assets
- Local REST plus WebSocket connection to FastAPI

No API keys, Ollama, hosted AI model, live weather API, database, MQTT, or external runtime service is required.

The project's local FastAPI-to-frontend WebSocket is allowed and required for telemetry. The root non-goal referring to “WebSockets for telemetry” should be interpreted as prohibiting external brokers or unrelated telemetry infrastructure, not the explicitly specified local `/api/v1/stream` connection.

## Collaboration contract

The backend is being developed independently on another computer. Frontend work may proceed against versioned local fixtures, but live integration must use the exact shared contract.

Rules:

1. Do not change field names or meanings only to simplify the UI.
2. Do not add authoritative calculations to compensate for a missing backend field.
3. Propose contract changes explicitly to the backend owner before depending on them.
4. Keep transport code behind one adapter so fixtures and live data feed the same components.
5. Use one representative fixture per important state: normal, peak, heatwave, cooling failure, safety override, paused, and failed.
6. Mark fixture mode visibly as `SIMULATED FIXTURE`; never present it as a live run.
7. Once live integration works, demo and benchmark screens must display backend data only.

Recommended environment variables:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/api/v1/stream
NEXT_PUBLIC_ENABLE_3D=false
```

Do not put secrets in `NEXT_PUBLIC_*` variables. This project does not need frontend secrets.

## Backend API to consume

Use REST for commands, lifecycle operations, snapshots, and benchmark results. Use WebSocket only for server-to-client live telemetry.

```text
GET  /api/v1/health
GET  /api/v1/config
GET  /api/v1/runs/current
POST /api/v1/runs
POST /api/v1/runs/{run_id}/commands
POST /api/v1/benchmarks
GET  /api/v1/benchmarks/{benchmark_id}
GET  /api/v1/benchmarks/{benchmark_id}/results
WS   /api/v1/stream
```

Commands are accepted by the backend and applied at simulation-step boundaries. Do not optimistically display a command as applied. Wait for acknowledgement and subsequent authoritative telemetry.

## Canonical telemetry shape

Treat the shared/generated contract as authoritative when it becomes available. Until then, fixtures should follow this minimum shape:

```ts
type Scenario = "NORMAL" | "PEAK" | "HEATWAVE" | "FAILURE";
type Controller = "RULE_BASED" | "COOLING_ONLY_RL" | "JOINT_RL";
type RunState = "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
type Risk = "SAFE" | "WARNING" | "CRITICAL";

interface TelemetryFrame {
  type: "telemetry.frame";
  schema_version: string;
  run_id: string;
  sequence: number;
  timestamp: string;
  simulation_time_s: number;
  run_state: RunState;
  scenario: Scenario;
  controller: Controller;
  metrics: {
    pue: number;
    it_power_kw: number;
    cooling_power_kw: number;
    other_power_kw: number;
    total_power_kw: number;
    energy_used_kwh: number;
    max_temperature_c: number;
    sla_percent: number;
    sla_violations: number;
    shed_demand_kw: number;
  };
  zones: Array<{
    id: string;
    temperature_c: number;
    utilization: number;
    it_power_kw: number;
    cooling_effect_kw: number;
    risk: Risk;
  }>;
  cooling_units: Array<{
    id: string;
    command: number;
    available_capacity: number;
    status: "AVAILABLE" | "DERATED" | "FAILED";
  }>;
  actions: {
    proposed_cooling: number[];
    applied_cooling: number[];
    workload_moves: Array<{
      from_zone: string;
      to_zone: string;
      amount: number;
    }>;
  };
  safety: {
    override_active: boolean;
    reasons: string[];
  };
  events: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
  }>;
}
```

If the backend's final schema differs, update this type and the fixtures together. Never maintain two competing telemetry models.

## Data integrity rules

- Display PUE exactly as received from the backend.
- Display energy and power with their correct units; do not mix kW and kWh.
- Do not recalculate SLA, safety violations, risk, or controller superiority in the browser.
- Order frames using `sequence`; ignore an older frame received after a newer one.
- Keep only enough history for smooth charts and the demo duration.
- Label all data as simulated telemetry.
- Use actual benchmark results. Never hardcode values that make joint RL look better.
- Show a safety override separately from the RL proposal.
- Show workload movement only when an applied movement is present in telemetry.

## Required information architecture

```text
Application shell
├── Live status header
│   ├── connection state
│   ├── run state
│   ├── scenario
│   ├── controller
│   ├── PUE
│   ├── energy used
│   ├── maximum temperature
│   ├── SLA
│   └── overall risk / safety override
├── Run and scenario controls
├── Main digital-twin area
│   ├── 2D heatmap — always available
│   └── 3D view — optional feature-flagged enhancement
├── Temperature and PUE timeline
├── Decision/event panel
└── Three-controller benchmark table
```

The primary visual hierarchy is current operational state first, cause/action/result second, historical evidence third.

## P0 implementation order

Frontend development can happen in parallel with backend development, but merge/integration priority must remain:

1. Establish TypeScript contracts and validated fixtures.
2. Build the transport adapter with fixture and live modes.
3. Build connection, loading, stale, paused, empty, and error states.
4. Build the live status header.
5. Build the 2D Canvas heatmap with five zones and a fixed legend.
6. Connect status and heatmap to the same telemetry frame.
7. Add scenario/run controls with acknowledgement and error handling.
8. Add the event/decision panel.
9. Add temperature, PUE, and energy charts.
10. Add the real benchmark comparison table.
11. Only then integrate the optional Three.js/Blender view into the main application.

The 3D scene may be explored separately in parallel, but it must remain isolated and must not block the P0 2D path.

## 2D heatmap requirements

- Use HTML5 Canvas for the P0 implementation.
- Render one stable-position cell per zone.
- Use fixed temperature thresholds from backend configuration.
- Show a visible legend with numeric temperature ranges.
- Pair colors with labels or icons; never rely on color alone.
- Show temperature and utilization for every zone.
- Show a cooling failure/derating marker on the affected zone or unit.
- Animate an applied workload movement with a restrained directional indicator.
- Do not auto-rescale colors from frame to frame.
- Respect reduced-motion preferences.

The heatmap must remain fully functional if WebGL, Three.js, or the GLB asset fails.

## Three.js and Blender requirements

Three.js is an optional visualization of the same backend state, not a second simulator.

### Allowed

- a lightweight facility shell;
- five clearly identifiable zones or rack groups;
- telemetry-driven rack/zone color or emissive state;
- visible cooling-unit status;
- restrained airflow or workload-movement animation;
- click/keyboard selection of a zone; and
- one optimized Blender-exported `.glb` asset if it improves presentation.

### Required safeguards

1. Keep the 3D view behind `NEXT_PUBLIC_ENABLE_3D` or an equivalent feature flag.
2. Lazy-load Three.js and the GLB asset.
3. Do not duplicate state calculations inside the scene.
4. Map objects to stable backend IDs such as `zone-01`.
5. Show the 2D heatmap if WebGL initialization or asset loading fails.
6. Keep materials, lights, geometry, and animation deliberately small.
7. Avoid photorealism, CFD airflow, CAD accuracy, complex physics, or large environment assets.
8. Do not block live telemetry rendering while loading 3D resources.
9. Test on the actual demo computer.
10. Remove or disable 3D before it is allowed to reduce P0 reliability.

Blender is an authoring tool only. Export assets before the demo; Blender must not be installed or running during the application demo.

## Decision and event presentation

The panel must explain actual backend events in the order they occurred:

```text
Cause:  Cooling Unit 3 capacity reduced from 100% to 60%
Action: Joint RL moved 15% workload from Zone 3 to Zone 1
Action: Applied Zone 3 cooling increased from 55% to 60%
Result: Zone 3 temperature stabilized from 31.2°C to 29.1°C
Safety: No thermal threshold breach
```

Use deterministic formatting of received telemetry and events. Do not use an LLM. Do not claim causality that the backend did not record.

## Benchmark table

Render backend results with these columns:

```text
Controller | Mean PUE | Max Temp | SLA/Uptime | Safety Violations | Energy Used
```

Requirements:

- identify the number of seeds;
- show loading, running, failed, and completed states;
- distinguish mean values from single-run values;
- do not hide metrics on which joint RL performs worse;
- do not rank a controller as better if it served less workload without showing shed demand; and
- never ship placeholder benchmark numbers as final data.

## Connection behavior

- Fetch a current snapshot when the application opens.
- Connect to `/api/v1/stream` for new frames.
- Detect stale telemetry after a configurable interval.
- Reconnect with bounded exponential backoff.
- Fetch a fresh snapshot after reconnecting instead of reconstructing missed frames.
- Do not let a slow chart or 3D render block message handling.
- Downsample presentation history if needed; never alter authoritative values.
- Keep the last valid frame visible but clearly label it stale when disconnected.

## UI and accessibility requirements

- Design for the actual presentation screen first, then support common laptop widths.
- Keep status labels readable from several feet away.
- Provide keyboard-accessible controls and zone selection.
- Provide text equivalents for heatmap and 3D status.
- Use clear focus states and semantic HTML.
- Provide reduced-motion behavior.
- Display Celsius, kW, kWh, percentages, and timestamps consistently.
- Use fixed, documented meanings for safe, warning, critical, failed, stale, and disconnected states.
- Avoid decorative dashboard cards that do not advance the cause/action/result story.

## Testing requirements

At minimum, test:

- contract fixtures parse correctly;
- old telemetry sequences cannot overwrite newer state;
- status header values and units match the received frame;
- heatmap thresholds remain fixed;
- scenario and run commands show pending, accepted, and rejected states;
- WebSocket disconnect, stale state, reconnect, and resnapshot behavior;
- safety overrides and equipment failures are visibly distinct;
- benchmark table renders real result shapes and failure states;
- Three.js disabled/failure mode returns to the 2D view; and
- the application remains usable at the target demo resolution.

## Frontend definition of done

The frontend is ready for the demo when it can do all of the following against the real backend without restarting:

1. Connect and show authoritative live status.
2. Start the cooling-failure scenario.
3. Show the failed/derated cooling unit.
4. Show the joint RL controller's applied cooling and workload movement.
5. Show temperature, PUE, SLA, and safety response over time.
6. Clearly distinguish an RL action from a safety override.
7. Display the real multi-seed three-controller benchmark.
8. Run a second scenario immediately afterward.
9. Continue working with the 2D heatmap when 3D is disabled or fails.

## Reporting expectations for the frontend agent

After each task, report:

- list the files changed;
- state whether fixture mode or live backend mode was tested;
- report the commands/tests run and their results;
- identify any assumed or missing backend contract fields;
- include a screenshot or short recording for visual changes when practical; and
- stop at the requested priority level instead of adding unrequested features.