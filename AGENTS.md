# AGENTS.md

Project instructions for the coding agent. Read this fully before writing any code. This is a 36-hour hackathon build — prioritize working, demoable code over completeness. Follow the phase order exactly; do not skip ahead to P1/P2 features until the corresponding P0 phase is fully working and tested.

## Golden Rule

Do not optimize for architectural elegance. Optimize for:

1. Correct simulation
2. Working RL
3. Real benchmark numbers
4. Visible cause → action → result
5. Demo reliability
6. Visual polish

Never fabricate metrics or hardcode a result to make the RL look better.

---

## Project summary

**Name:** Autonomous Data Center Thermal + Workload Controller (digital twin track)

**One-line description:** A simulated data center where a reinforcement-learning agent jointly controls cooling allocation and workload placement, guarded by a deterministic safety shield, benchmarked against a rule-based baseline and a cooling-only RL baseline on PUE (Power Usage Effectiveness), max temperature, and safety violations.

**Core technical differentiator:** joint action space (cooling + workload placement together), not cooling-only. This is the single thing to protect above all else — if time runs short, cut UI polish before cutting the workload-placement half of the action space.

---

## Tech stack

- **Simulation / RL:** Python 3.10+, `gymnasium`-style environment interface, `stable-baselines3` (PPO) for training
- **Backend API:** FastAPI
- **Frontend:** Next.js + React + TypeScript, HTML5 Canvas for the P0 heatmap, Recharts or Chart.js for charts, and Three.js for the optional/P1 3D layer
- **No external live APIs, no databases, no message brokers.** Everything runs self-contained for demo reliability. Do not add MongoDB, MQTT, live weather APIs, or any other network dependency.

---

## Repository structure to create

```text
/
├── apps/
│   ├── web/                     # Next.js operator interface
│   └── api/                     # FastAPI routes + orchestration
├── packages/
│   └── contracts/               # Shared/generated schemas
├── engine/
│   ├── physics/                 # Thermal + power models
│   ├── control/                 # Controller interface + implementations
│   ├── safety/                  # Hard constraints + action projection
│   ├── scenarios/               # Scenario logic
│   └── metrics/                 # Run + benchmark aggregation
├── config/
│   ├── topology.json
│   ├── thresholds.json
│   └── scenarios.json
├── models/                      # Pre-trained model checkpoints
├── benchmarks/                  # Benchmark runner + result schemas
├── tests/
│   ├── contract/
│   ├── unit/
│   ├── integration/
│   └── replay/
├── scripts/                     # Demo, benchmark, validation scripts
├── README.md
└── AGENTS.md

```

---

## Core specification: the simulation

### State space (per zone, N zones — start with N=5, expand if time allows)

```python
state = {
    "temperatures": [T_1, ..., T_N],       # Celsius, per zone
    "workloads": [W_1, ..., W_N],          # utilization 0.0-1.0, per zone
    "cooling_prev": [C_1, ..., C_N],       # previous cooling action, per zone
    "cooling_capacity": [Cap_1, ..., Cap_N], # current max cooling available (reduced during failure)
    "ambient_temp": T_amb,
    "time_step": t
}

```

### Action space

```python
action = {
    "cooling": [c_1, ..., c_N],   # continuous [0, 1] per zone
    "workload_move": (from_zone, to_zone, amount)  # optional per step, can be no-op
}

```

### Thermal update equation (apply per zone, per timestep)

```
T_next = T_current + a*workload - b*cooling + g*(ambient_temp - T_current) + noise

```

Where `a`, `b`, `g` are tunable constants and `noise` is small Gaussian noise. Tune `a`/`b`/`g` so that under zero cooling, temperature rises to unsafe levels within a demonstrable timeframe, and under reasonable cooling, it stabilizes — the agent needs a real problem to solve, not a trivially stable system.

### Reward function

```
reward = -(
    W1 * temperature_penalty      # exponential, harsh near critical temp
    + W2 * energy_cost            # linear, proportional to total cooling used
    + W3 * jitter_penalty         # quadratic, penalizes rapid action changes
    + W4 * target_drift           # deviation from ideal operating temp band
)

```

Suggested starting weights: `W1=heaviest, W2=moderate, W3=light, W4=light`. Expect to retune after watching first training runs — if the agent finds a degenerate policy (e.g. always max cooling, or ignoring temperature entirely), adjust weights before adding complexity.

**Emergency override:** when any zone temperature exceeds a critical threshold, set `jitter_penalty = 0` for that step — safety response should never be penalized for being abrupt.

### Safety Shield (implement as a pure function, separate from the RL policy)

```python
def apply_safety_shield(proposed_action, current_state):
    # 1. Clamp cooling values to valid range [0, cooling_capacity]
    # 2. If predicted next-step temperature for any zone > MAX_SAFE_TEMP:
    #       force that zone's cooling to maximum available
    # 3. If a workload move would push destination zone temperature > MAX_SAFE_TEMP:
    #       reject the move (no-op instead)
    # Return an action satisfying all defined one-step safety constraints
    return corrected_action

```

This function must be called on every single step, between the RL policy's output and the simulator's execution.

During early training/debugging, the team may temporarily disable the shield to diagnose the raw policy, but
the production training/evaluation path and especially inference/demo time must enforce it. Any such bypass
must be explicit and must never be the default.

### Failure injection scenario (must-have for demo)

At a fixed or configurable timestep, reduce `cooling_capacity` for one zone/unit to ~60% of normal.

`cooling_capacity` is part of the observable state, so the agent is allowed to know the currently available
cooling capacity. This is intentional: the controller should adapt its actions to the changed infrastructure
constraint rather than being scripted around a known failure timestamp.

The failure event itself must NOT be hardcoded into the policy. The environment changes the available capacity,
the agent receives the resulting state, and PPO chooses its next action from that state.

This is the core "prove it's not scripted" demo moment.

### Scenario set (build all 4)

1. **Normal** — stable baseline workload
2. **Peak load** — workload spikes across zones
3. **Ambient heat** — `ambient_temp` raised via `ambient = baseline + scenario_delta` (no live weather API)
4. **Cooling failure** — the failure injection above, combined with normal or peak load

---

## Controllers to build (in this order)

1. **Rule-based baseline** — simple fixed thresholds (e.g. "if temp > X, set cooling = 1.0, else proportional to temp"). No learning. Build this first — it's your first baseline and validates the simulator/API plumbing end to end.
2. **Cooling-only RL** — train PPO on the environment with workload\_move action disabled/fixed. Validates the training loop works before adding the harder joint action space.
3. **Joint RL** — train PPO with the full action space (cooling + workload placement). This is the differentiator; budget the most reward-tuning time here.

Train offline, save checkpoints to `/checkpoints`. The API loads pretrained checkpoints — never trains live during a demo request.

---

## Evaluation / benchmark requirements

`eval/benchmark.py` must:

- Run all three controllers (rule-based, cooling-only RL, joint RL) on the identical scenario, same random seed
- Repeat across **at least 3-5 seeds**, not a single run — report averaged results (this directly defends against "is this cherry-picked" objections)
- Output a table with columns: Controller | PUE | Max Temp | SLA/Uptime | Safety Violations | Energy Used
- PUE calculation: `PUE = Total Facility Power / IT Equipment Power`, where `Total Facility Power = IT Power + Cooling Power + Other Overhead`. Compute this from actual simulated power draw — do not hardcode or invent numbers.

---

## API architecture

Use REST for lifecycle operations and recoverable snapshots. Use WebSocket for server-to-client telemetry.

Recommended API surface:

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

The API owns orchestration and validation. It must not contain thermal equations or learned-policy logic.

Commands are applied at simulation step boundaries. The runtime owns authoritative simulation state.

---

## Frontend requirements (priority order)

1. **Status header:** PUE | Energy | Max Temp | SLA | Risk | connection/run state
2. **2D heatmap:** one cell per simulation zone; fixed thermal thresholds; visible legend. This is the guaranteed P0 visual.
3. **PUE / energy charts:** actual telemetry only.
4. **Decision/event panel:** generated from actual state/action deltas.
5. **Scenario selector:** Normal / Peak / Heatwave / Failure.
6. **Benchmark comparison table:** renders real multi-seed benchmark output.
7. **Three.js digital twin (P1):** integrate the existing procedural Three.js facility scene if it remains performant and stable. Rack state must be driven by backend telemetry.
8. **Clickable zone detail (P1):** load/temp/power/risk/workload information.

The existing Three.js scene is an enhancement, not a dependency. Blender GLB assets are optional and must never block the P0 system.

The frontend is presentation-only. It must not implement authoritative physics, safety rules, or RL decisions.

---

## Explicit non-goals — do not build these

Do not implement, integrate, or add dependencies for any of the following, regardless of what reference material suggests:

- MongoDB or any database/persistence layer
- MQTT, WebSockets for telemetry, or any message broker
- Live weather API or any other live external API
- OR-Tools or any static layout/placement optimizer
- SNMP/Modbus or real telemetry protocol integration
- LLM-based decision-making (LLM may only be used, if at all, to phrase an already-computed explanation — never to decide an action)
- Full 3D CAD, CFD, Omniverse/OpenUSD, Houdini pipelines
- Multi-agent RL, custom RL algorithms (use standard PPO via stable-baselines3)
- Experiment replay/persistence UI, saved-experiment database
- Mobile app, AR, voice assistant
- Authentication/login systems

If asked to add any of the above mid-build, flag it back to the user rather than implementing — these are known scope traps for this project.

---

## Build phase checklist (work in this exact order; do not start a phase until the previous is functionally complete)

- [x] **Phase 1:** `thermal_model.py` + `env.py` — one full episode runs end-to-end with random actions, no crashes
- [x] **Phase 2:** `safety_shield.py` + `rule_based.py` — safety shield unit-tested against at least one deliberately unsafe action; rule-based controller runs a full episode
- [x] **Phase 3:** `cooling_only_rl.py` trains and produces a non-degenerate policy (i.e., not always-max or always-zero cooling)
- [x] **Phase 4:** `joint_rl.py` trains with full action space; reward retuned until behavior looks sane on the failure-injection scenario
- [x] **Phase 5:** FastAPI routes wired to the simulator + all three controllers
- [ ] **Phase 6:** Frontend — status header + 2D heatmap working against live API data
- [ ] **Phase 7:** `benchmark.py` producing the multi-seed 3-way comparison table with real numbers
- [ ] **Phase 8:** Frontend — PUE chart, decision panel, scenario selector
- [ ] **Phase 9 (optional):** three.js 3D layer, clickable zone detail

---

## Definition of done for the demo

The system must support, live, without restarting anything:

1. Selecting the "Cooling Failure" scenario and running it
2. Watching the joint RL controller keep all zones under the safety threshold while the rule-based baseline (shown for comparison) would not
3. Displaying the 3-way benchmark table with real, non-fabricated numbers
4. Surviving a second, different scenario run immediately after, without restart or manual intervention — this proves the system isn't hardcoded to one script

If any of the above is not working reliably, that is the priority fix over any new feature.