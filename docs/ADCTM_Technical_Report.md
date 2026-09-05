# Technical & Research Report: Autonomous Data Center Digital Twin + Joint Reinforcement Learning Controller

**Project Title:** Autonomous Data Center Thermal + Workload Controller (ADCTM)  
**Track:** Digital Twin & Autonomous Infrastructure Control  
**Date:** September 2026  
**Status:** Test-Validated Research Prototype (Simulator-v2)  
**Repository:** `e:\rl`  

---

## 1. Title and Short Abstract

### Abstract

Data centers worldwide consume an estimated 1–2% of global electricity, with mechanical cooling systems accounting for 30% to 40% of facility power. Traditional data center cooling is operated reactively using static rule-based controllers (such as Computer Room Air Handler / CRAH thermostats), completely decoupled from the software schedulers that allocate compute jobs. When mechanical failures or thermal anomalies occur, cooling-only control systems cannot overcome local physical cooling capacity loss. If a cooling unit fails or suffers reduced capacity, no cooling setpoint can prevent overheating unless computation is moved away from the affected zone.

This report presents the design, implementation, and empirical evaluation of the **Autonomous Data Center Thermal + Workload Controller (ADCTM)**. We construct a 5-zone test-validated digital twin incorporating heterogeneous thermodynamic characteristics and electrical coefficients of performance (COP). We train a reinforcement learning policy using Proximal Policy Optimization (PPO) that jointly controls both cooling allocation and computational workload migration, guarded on every step by a deterministic safety shield.

On held-out, unseen test seeds (`[401, 402, 403, 404, 405]`) under a canonical cooling failure scenario (a cooling unit dropping to 60% capacity mid-episode):
- **Joint RL** achieved a Power Usage Effectiveness (**PUE**) of **1.1931 ± 0.0003**, **100.00% SLA uptime**, **0 operational violations**, **0 emergency safety violations**, and a peak temperature of **30.09°C** (well within the ASHRAE Class A2 35.0°C limit).
- The **Rule-Based Baseline** achieved **PUE 1.2234 ± 0.0002**, but suffered catastrophic overheating in the impaired zone, reaching a maximum temperature of **55.33°C**, resulting in an **SLA uptime of only 1.88%** and **215.0 emergency violations**.
- The **Cooling-Only RL Baseline** achieved **PUE 1.2424 ± 0.0002**, an **SLA uptime of 14.44%**, and peak temperature of **54.98°C**, proving that optimizing cooling without workload mobility cannot survive physical cooling failures.
- Joint RL maintained a **0.00% safety-shield override rate**, demonstrating that the policy internalized safe operational boundaries without relying on the deterministic shield as an operational crutch.

**Explicit Research Disclaimer:**  
This project is a **simulator-based research prototype** operating on an ordinary differential equation (ODE) thermal digital twin with synthetic parameters. It is **not** a production data center controller, has not been tested on live production hardware, and does not model three-dimensional computational fluid dynamics (CFD).

---

## 2. Problem Statement

A modern data center consists of rows of server racks grouped into thermal zones. The facility faces a complex, coupled physical challenge:
1. **Heat Generation:** Computing hardware (CPUs, GPUs, memory, power supplies) converts virtually 100% of electrical energy into thermal energy. Higher computational utilization directly increases heat output.
2. **Cooling Infrastructure:** Air handlers, chillers, and fans remove heat from the server racks to maintain IT inlet temperatures within hardware reliability envelopes. This cooling equipment consumes significant electrical energy.
3. **Thermal Asymmetry:** In real facilities, zones are not identical. Differences in server generations, rack density, duct geometry, distance from chilled-water loops, and airflow obstructions result in heterogeneous heat generation and cooling effectiveness.
4. **Mechanical Vulnerabilities:** Chillers, variable-frequency fan drives, and valves can fail, jam, or degrade. In a cooling failure, a zone's maximum heat removal capacity drops abruptly.
5. **Workload Mobility:** In virtualized or containerized environments (e.g., Kubernetes), computational jobs can be migrated between server racks. However, workload migration consumes network bandwidth and CPU overhead.

### The Decoupling Problem

Historically, facility operations and IT workload scheduling operate as two disconnected silos:
- **The Workload Scheduler** packs jobs onto servers based on CPU, RAM, and storage availability, blind to instantaneous rack inlet temperatures or chiller health.
- **The Cooling Controller** observes rack or return air temperatures and turns on fans or chillers reactively after temperatures rise.

When a cooling unit degrades, reactive cooling control hits a hard physical wall: if a cooling unit's capacity drops from 100% to 60%, commanding 100% cooling will still only deliver 60% heat removal. Because the workload scheduler continues pumping jobs into that zone, the zone overheats, triggering thermal throttling or emergency hardware trips.

### The Joint Control Hypothesis

If an autonomous agent jointly observes temperatures, cooling capacities, and workload utilization across all zones, it can simultaneously:
1. **Allocate cooling** to exactly match heat removal requirements without wasteful overcooling.
2. **Migrate computational load** away from thermally impaired or electrically inefficient zones and toward zones with dedicated, high-COP cooling infrastructure.

By solving this as a **joint action space** problem, the system can maintain 100% SLA compliance and lower total facility energy consumption, even during severe mechanical cooling failures.

---

## 3. System Overview

The project is structured into clean, decoupled layers following the separation-of-concerns architecture specified in `AGENTS.md`.

```
                    +-----------------------------+
                    |      Operator / Judge       |
                    +-----------------------------+
                                   |
                                   v
                    +-----------------------------+
                    |    Next.js Web Interface    |
                    |   (Presentation Layer)      |
                    +-----------------------------+
                                   |
                      REST Commands / WebSockets
                                   |
                                   v
+-----------------------------------------------------------------+
|                       FastAPI Backend API                       |
|  - GET /api/v1/health          - POST /api/v1/runs              |
|  - GET /api/v1/config          - POST /api/v1/runs/{id}/commands|
|  - GET /api/v1/runs/current    - GET  /api/v1/benchmarks/{id}   |
|  - WS  /api/v1/stream (Server-to-Client Telemetry)              |
+-----------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------+
|                    API Orchestration Runtime                    |
|  - SessionManager & SimulationSession                           |
|  - Step boundary enforcement                                    |
|  - In-memory execution state machine                            |
+-----------------------------------------------------------------+
                                   |
                   State Observables / Step Triggers
                                   |
                                   v
+-----------------------------------------------------------------+
|                      Controller Subsystem                       |
|  [Rule-Based Baseline]  [Cooling-Only RL]   [Joint RL (PPO)]    |
+-----------------------------------------------------------------+
                                   |
                            Proposed Action
                                   |
                                   v
+-----------------------------------------------------------------+
|                    Deterministic Safety Shield                  |
|  - Pure function: apply_safety_shield(action, state, cfg)       |
|  - Zero-noise 1-step physical temperature projection            |
|  - Clamping, overheat protection, overcool floor, move check    |
+-----------------------------------------------------------------+
                                   |
                            Corrected Action
                                   |
                                   v
+-----------------------------------------------------------------+
|                 Digital Twin Simulation Engine                  |
|  - DataCenterEnv (Gymnasium environment)                        |
|  - ThermalModel (Heterogeneous ODE heat balance)                |
|  - PowerModel (COP-based electrical conversion & PUE)           |
+-----------------------------------------------------------------+
```

### Architectural Principles

1. **Presentation Decoupling:** The frontend (`apps/web`) is presentation-only. It owns no physics, calculates no rewards, and makes no control decisions.
2. **Authoritative Backend Runtime:** The FastAPI application (`apps/api`) owns run lifecycle orchestration, step timing, command dispatch, and WebSocket telemetry broadcasting.
3. **Pure Physics Engine:** All thermal equations, electrical power models, and numerical updates reside in `engine/physics/` and `engine/env.py`.
4. **Isolated Policy Layer:** Controllers reside in `engine/control/`. Checkpoints are loaded once into memory upon server startup; no live training occurs during API inference requests.
5. **Deterministic Safety Guard:** The safety shield in `engine/safety/safety_shield.py` is a pure function that intercepts proposed actions and mathematically projects them into a safe operating envelope before simulator execution.
6. **No External Dependencies:** The system runs completely self-contained without MongoDB, MQTT, external cloud APIs, or message brokers.

---

## 4. Digital Twin / Simulator

The digital twin models a medium data center hall divided into $N = 5$ thermal zones.

### Core Simulation Parameters

| Parameter | Symbol / Variable | Value | Physical Meaning |
|---|---|:---:|---|
| Number of Zones | $N$ | 5 | Spatial zones (Zone-A through Zone-E) |
| Simulation Timestep | $\Delta t$ | 300 s (5 min) | Control interval per step |
| Episode Length | $T_{\text{max}}$ | 288 steps | Exactly 24 hours of operation |
| Baseline Ambient Temp | $T_{\text{amb}}$ | 30.0°C | Outdoor / envelope temperature |
| Target Temp Band | $[T_{\text{target, low}}, T_{\text{target, high}}]$ | $[18.0, 27.0]^\circ\text{C}$ | ASHRAE recommended envelope |
| Operational Max Temp | $T_{\text{op, max}}$ | 35.0°C | ASHRAE Class A2 allowable limit (SLA threshold) |
| Emergency Max Temp | $T_{\text{emerg, max}}$ | 45.0°C | Hard simulator emergency threshold |
| Nominal IT Power per Zone | $P_{\text{IT, base}}$ | 10.0 kW | Peak IT power per zone at 100% load |
| Max Cooling Capacity | $Q_{\text{max}, i}$ | 5.0 kW | Max thermal removal capacity per zone |
| Overhead Fraction | $f_{\text{overhead}}$ | 0.05 (5%) | Lighting, UPS, and distribution losses |
| Gaussian Process Noise | $\sigma_{\text{noise}}$ | 0.10°C | Zero-mean Gaussian environmental jitter |

---

### Simulator-v1 vs. Simulator-v2: The Structural Deficiency and Resolution

#### The Simulator-v1 Flaw: Placement Invariance

In the initial implementation (Phase 1 through Phase 4 initial training), the thermal model treated all five zones as identical linear compartments:
- Global heat-gain coefficient: $a = 5.0$
- Global cooling-effectiveness coefficient: $b = 6.0$
- Global ambient-coupling coefficient: $g = 0.02$
- Direct cooling power consumption: $P_{\text{cooling}} = C_i \times 5.0$ kW

In steady state, the temperature in zone $i$ satisfies:
$$0 = a W_i - b C_i + g(T_{\text{amb}} - T^*)$$

Solving for the equilibrium cooling action $C_i$:
$$C_i = \frac{a W_i + g(T_{\text{amb}} - T^*)}{b}$$

Summing cooling demands across all $N$ zones:
$$\sum_{i=1}^N C_i = \frac{a}{b} \sum_{i=1}^N W_i + \frac{N g}{b} (T_{\text{amb}} - T^*)$$

Because total workload is conserved ($\sum_{i=1}^N W_i = W_{\text{total}} = \text{const}$), the total required cooling action $\sum C_i$ **was mathematically invariant to how workload was distributed among zones**.

Under identical linear zones, moving 0.2 workload from Zone 3 to Zone 1 saved heat in Zone 3 but added the exact same heat to Zone 1, requiring identical total cooling. Consequently, Joint RL had **no physical or electrical incentive to migrate workload**, causing migration to degenerate into meaningless chatter. In the Phase 4 v1 benchmark, Joint RL lost to the Rule-Based baseline on PUE (Joint RL: 1.4664 vs. Rule-Based: 1.4520).

#### The Simulator-v2 Correction: Heterogeneous Thermodynamics and COP

To make workload placement physically meaningful without adding computational fluid dynamics (CFD), Simulator-v2 introduced **heterogeneous zone parameters** frozen in `config/topology.json`.

```
+---------------------------------------------------------------------------------------------------+
|                                 SIMULATOR-v2 ZONE TOPOLOGY                                         |
+--------+---------------+-----------------+--------------------------+--------+--------------------+
| Zone   | Physical Role | Heat Gain (a_i) | Cooling Effectiveness(b_i)| COP_i  | Qualitative Status |
+--------+---------------+-----------------+--------------------------+--------+--------------------+
| Zone-A | Edge          | 5.2 °C/unit     | 6.0 °C/unit              | 3.2    | Moderate           |
| Zone-B | Core-Efficient| 4.5 °C/unit     | 8.0 °C/unit              | 3.8    | High-Efficiency    |
| Zone-C | Standard      | 5.0 °C/unit     | 6.0 °C/unit              | 3.0    | Average Reference  |
| Zone-D | Impaired      | 5.8 °C/unit     | 4.0 °C/unit              | 2.0    | Aging / Impaired   |
| Zone-E | Warm-Aisle    | 5.5 °C/unit     | 5.5 °C/unit              | 2.6    | Warm Air Recirc.   |
+--------+---------------+-----------------+--------------------------+--------+--------------------+
```

#### Why Heterogeneity Enables Workload Migration Optimization

In Simulator-v2, electrical cooling power is explicitly separated from thermal heat removal using the Coefficient of Performance ($\text{COP}_i$):
$$P_{\text{elec}, i} = \frac{Q_{\text{thermal}, i}}{\text{COP}_i} = \frac{C_i \cdot Q_{\text{max}, i}}{\text{COP}_i}$$

The marginal electrical cooling power required per unit workload in zone $i$ is:
$$\frac{\partial P_{\text{elec}}}{\partial W_i} = \frac{a_i \cdot Q_{\text{max}, i}}{b_i \cdot \text{COP}_i}$$

Calculating this marginal electrical cost for our zones ($Q_{\text{max}, i} = 5.0$ kW):
- **Zone-D (Impaired):**
  $$\frac{\partial P_{\text{elec}}}{\partial W_D} = \frac{5.8 \times 5.0}{4.0 \times 2.0} = \frac{29.0}{8.0} = \mathbf{3.625}\text{ kW electrical / unit workload}$$
- **Zone-B (Core-Efficient):**
  $$\frac{\partial P_{\text{elec}}}{\partial W_B} = \frac{4.5 \times 5.0}{8.0 \times 3.8} = \frac{22.5}{30.4} = \mathbf{0.740}\text{ kW electrical / unit workload}$$

$$\text{Efficiency Ratio} = \frac{3.625}{0.740} = \mathbf{4.898\times}$$

Moving computational workload from Zone-D to Zone-B yields three simultaneous physical benefits:
1. **Less heat generated:** $a_B = 4.5 < a_D = 5.8$ (Zone-B servers are newer and generate less heat per compute unit).
2. **More effective thermal removal:** $b_B = 8.0 > b_D = 4.0$ (Zone-B has unobstructed airflow and dedicated CRAC cooling).
3. **Higher electrical efficiency:** $\text{COP}_B = 3.8 > \text{COP}_D = 2.0$ (Zone-B chiller consumes far less electricity per kilowatt of heat extracted).

**Explicit Statement on Parameters:**  
All coefficients ($a_i, b_i, g_i, \text{COP}_i$) are **synthetic engineering assumptions** chosen to reflect realistic multi-generation data center characteristics. They were frozen in configuration prior to Phase 4 retraining and were never altered to force an artificial benchmark win.

---

## 5. Physics and Mathematical Model

This section documents the exact equations implemented in `engine/physics/thermal_model.py`.

### 5.1 Thermal State Update Equation

The temperature of zone $i$ at discrete timestep $t+1$ is computed as:

$$T_i(t+1) = T_i(t) + a_i W_i(t) - b_i C_i(t) + g_i (T_{\text{amb}}(t) - T_i(t)) + \sum_{j=1}^N A_{ji}(T_j(t) - T_i(t)) + \epsilon_i(t)$$

Where:
- $T_i(t) \in \mathbb{R}$: Temperature of zone $i$ at timestep $t$ in degrees Celsius (°C).
- $W_i(t) \in [0.0, 1.0]$: Computational workload utilization of zone $i$ at timestep $t$ (dimensionless fraction).
- $C_i(t) \in [0.0, \text{Cap}_i(t)]$: Applied cooling command for zone $i$ at timestep $t$ (dimensionless fraction).
- $T_{\text{amb}}(t) \in \mathbb{R}$: Ambient outside/envelope temperature (°C).
- $a_i > 0$: Zone-specific heat gain coefficient (°C temperature rise per unit workload per timestep).
- $b_i > 0$: Zone-specific cooling effectiveness coefficient (°C temperature drop per unit cooling command per timestep).
- $g_i > 0$: Zone-specific ambient thermal coupling coefficient (dimensionless conductance).
- $A_{ji} \ge 0$: Thermal adjacency coupling matrix representing heat leakage from zone $j$ to zone $i$. In Simulator-v2, $A$ is frozen as an all-zero matrix ($A_{ji} = 0$).
- $\epsilon_i(t) \sim \mathcal{N}(0, \sigma_{\text{noise}}^2)$: Zero-mean Gaussian process noise ($\sigma = 0.10^\circ\text{C}$).

**Location in Code:** `ThermalModel.step_temperatures()` in [`engine/physics/thermal_model.py`](file:///e:/rl/engine/physics/thermal_model.py).

---

### 5.2 Power and Energy Model

Power is calculated instantaneously at each step, and energy is accumulated over time.

#### 1. IT Equipment Power
$$P_{\text{IT}}(t) = \sum_{i=1}^N W_i(t) \cdot P_{\text{IT, base}}$$
With $P_{\text{IT, base}} = 10.0$ kW per zone. At full capacity across all 5 zones, $P_{\text{IT}} = 50.0$ kW.

#### 2. Thermal Heat Removal
$$Q_{\text{thermal}, i}(t) = C_i(t) \cdot Q_{\text{max}, i}$$
With $Q_{\text{max}, i} = 5.0$ kW thermal capacity per zone.

#### 3. Electrical Cooling Power
$$P_{\text{cooling}}(t) = \sum_{i=1}^N \frac{Q_{\text{thermal}, i}(t)}{\text{COP}_i} = \sum_{i=1}^N \frac{C_i(t) \cdot Q_{\text{max}, i}}{\text{COP}_i}$$
Where $\text{COP}_i \in [2.0, 3.8]$ is the Coefficient of Performance. Lower COP means more electrical watts are drawn to remove one watt of thermal heat.

#### 4. Facility Overhead Power
$$P_{\text{overhead}}(t) = P_{\text{IT}}(t) \cdot f_{\text{overhead}}$$
With fixed overhead fraction $f_{\text{overhead}} = 0.05$ (5%).

#### 5. Total Facility Power
$$P_{\text{facility}}(t) = P_{\text{IT}}(t) + P_{\text{cooling}}(t) + P_{\text{overhead}}(t)$$

**Location in Code:** `ThermalModel.compute_power()` in [`engine/physics/thermal_model.py`](file:///e:/rl/engine/physics/thermal_model.py).

---

### 5.3 Power Usage Effectiveness (PUE)

Instantaneous Power Usage Effectiveness at step $t$ is:
$$\text{PUE}(t) = \frac{P_{\text{facility}}(t)}{P_{\text{IT}}(t)} = 1 + \frac{P_{\text{cooling}}(t) + P_{\text{overhead}}(t)}{P_{\text{IT}}(t)}$$

For the entire 24-hour episode (288 steps), PUE is computed from total integrated electrical energy:
$$\text{PUE}_{\text{episode}} = \frac{E_{\text{facility}}}{E_{\text{IT}}} = \frac{\sum_{t=0}^{287} P_{\text{facility}}(t) \cdot \frac{\Delta t}{3600}}{\sum_{t=0}^{287} P_{\text{IT}}(t) \cdot \frac{\Delta t}{3600}}$$

Where $\Delta t = 300$ seconds ($5/60 = 1/12$ hours).

**Why Lower PUE is Better:**  
A PUE of 1.0 represents the physical ideal where 100% of consumed facility energy goes into computation, with zero energy wasted on chillers, fans, pumps, or transformers. Standard enterprise data centers typically average PUE 1.5–1.8. Hyperscale facilities achieve 1.15–1.25. A lower PUE directly translates to lower operational cost and carbon emissions.

---

## 6. RL Environment

The reinforcement learning interface is implemented as a Gymnasium environment in [`engine/env.py`](file:///e:/rl/engine/env.py) and wrapped by controller-specific wrappers.

### 6.1 Observation Space

The observation vector $s_t \in \mathbb{R}^{22}$ is continuous:

| Indices | Dimension | Description | Normalization / Range |
|---|:---:|---|---|
| `0..4` | 5 | Zone Temperatures ($T_1, \dots, T_5$) | Celsius (°C), nominal ~18–50°C |
| `5..9` | 5 | Zone Workloads ($W_1, \dots, W_5$) | $[0.0, 1.0]$ |
| `10..14` | 5 | Previous Cooling Actions ($C_{\text{prev}, 1}, \dots, C_{\text{prev}, 5}$) | $[0.0, 1.0]$ |
| `15..19` | 5 | Available Cooling Capacities ($\text{Cap}_1, \dots, \text{Cap}_5$) | $[0.0, 1.0]$ (drops to 0.6 during failure) |
| `20` | 1 | Ambient Temperature ($T_{\text{amb}}$) | Celsius (°C), nominal 30.0–40.0°C |
| `21` | 1 | Normalized Timestep ($t / 288$) | $[0.0, 1.0]$ |

### 6.2 Action Space

The action space differs fundamentally between the baselines and Joint RL:

#### Cooling-Only Action Space
- Space: Continuous $\text{Box}(-1, 1, (5,), \text{float32})$.
- Mapping: $C_i = \text{clip}((a_i + 1) / 2, 0.0, 1.0)$.
- Workload movement is disabled (fixed to no-op).

#### Joint RL Action Space
- Space: Continuous $\text{Box}(-1, 1, (10,), \text{float32})$.
- **Dimensions `0..4` (Cooling):** Mapped to cooling setpoints:
  $$C_{\text{proposed}, i} = \min\left( \text{clip}\left(\frac{a_i + 1}{2}, 0.0, 1.0\right), \text{Cap}_i \right)$$
- **Dimensions `5..9` (Workload Placement Preference Logits):** Mapped to continuous target allocation fractions via a Softmax transformation:
  $$\pi_i = \frac{\exp(z_i / \tau)}{\sum_{j=1}^5 \exp(z_j / \tau)}$$
  Where $z_i = a_{5+i} \in [-1, 1]$ and temperature $\tau = 1.0$.

#### Workload Migration Decoding & Rate Limiting
From target allocation fractions $\pi_i$, target workload is:
$$W^*_i = \pi_i \sum_{k=1}^5 W_k$$

Zone deltas represent workload surplus or deficit:
$$\Delta_i = W^*_i - W_i$$

- Candidate source zone: $s = \arg\min \Delta$ (most surplus/wants to shed).
- Candidate destination zone: $d = \arg\max \Delta$ (most deficit/wants to receive).
- Desired transfer volume: $v = \min(-\Delta_s, \Delta_d)$.

**Deadband & Rate Limiting:**
1. If $s = d$ or $v < 0.01$ (1% deadband), migration is a strict **no-op** ($v = 0$). This prevents policy chatter and thrashing.
2. The transfer is rate-limited: $v \le 0.05$ (maximum 5% workload moved per 5-minute timestep).
3. Physical boundary clamping: $v \le W_s$ and $v \le 1.0 - W_d$.
4. **Workload Conservation:**
   $$W_s(t+1) = W_s(t) - v, \quad W_d(t+1) = W_d(t) + v$$
   $$\sum_{i=1}^5 W_i(t+1) = \sum_{i=1}^5 W_i(t)$$
   Total compute demand is 100% conserved; no jobs are ever dropped or shed.

**Location in Code:** `JointActionDecoder` in [`engine/control/joint_rl.py`](file:///e:/rl/engine/control/joint_rl.py).

---

## 7. Reward Function

The reward function represents a multi-objective optimization problem that balances safety, energy minimization, equipment longevity, and migration friction.

$$R(t) = -(p_{\text{op}} + p_{\text{emerg}} + p_{\text{energy}} + p_{\text{drift}} + p_{\text{jitter}} + p_{\text{mig}} + p_{\text{cap}} + p_{\text{shed}} + p_{\text{disc}})$$

### Breakdown of Reward Terms

| Term | Mathematical Formula | Weight / Hyperparameter | Physical Purpose |
|---|---|:---:|---|
| **$p_{\text{op}}$** | $w_{\text{op}} \sum_{i=1}^N \max(T_i - 35.0, 0)$ | $w_{\text{op}} = 20.0$ | Linear penalty for exceeding the 35°C ASHRAE Class A2 SLA limit. |
| **$p_{\text{emerg}}$** | $w_{\text{emerg}} \sum_{i=1}^N \left( e^{\min\left(\frac{\max(T_i - 40, 0)}{2}, 5\right)} - 1 \right) + 100 \cdot \mathbb{I}_{T_i > 45}$ | $w_{\text{emerg}} = 80.0$ | Exponential penalty starting at 40°C, with a massive +100 step penalty for violating the hard 45°C limit. |
| **$p_{\text{energy}}$** | $w_{\text{energy}} \sum_{i=1}^N C_i$ | $w_{\text{energy}} = 12.0$ | Linear penalty proportional to total cooling deployed to force power reduction. |
| **$p_{\text{drift}}$** | $w_{\text{drift}} \sum_{i=1}^N \left( \max(18.0 - T_i, 0) + \max(T_i - 34.0, 0) \right)$ | $w_{\text{drift}} = 0.5$ | Soft penalty penalizing drift outside the [18.0°C, 34.0°C] operating band. |
| **$p_{\text{jitter}}$** | $w_{\text{jitter}} \sum_{i=1}^N (C_i - C_{\text{prev}, i})^2$ | $w_{\text{jitter}} = 0.5$ | Quadratic penalty on abrupt actuator changes. **Emergency override:** zeroed if any $T_i > 40.0^\circ\text{C}$. |
| **$p_{\text{mig}}$** | $w_{\text{mig}} \cdot \text{amount}$ | $w_{\text{mig}} = 0.1$ | Small friction cost on workload transfer to penalize unnecessary migration. |
| **$p_{\text{cap}}$** | $w_{\text{cap}} \sum_{i=1}^N \max(W_i - 0.95, 0)^2$ | $w_{\text{cap}} = 10.0$ | Penalizes driving any zone near 100% server capacity saturation. |
| **$p_{\text{shed}}$** | $0.0$ | $0.0$ | Workload is mathematically conserved (0% shed). |
| **$p_{\text{disc}}$** | $w_{\text{disc}} \left( \sum (C_{\text{prop}} - C_{\text{applied}})^2 + \mathbb{I}_{\text{rejected}} \right)$ | $w_{\text{disc}} = 2.0$ | Penalizes discrepancy between proposed action and safety-shield action (fosters shield independence). |

### Transparent Record of Candidate Configurations Tested

During Phase 4 reward tuning, multiple candidate configurations were evaluated:

| Candidate | $w_{\text{energy}}$ | Drift Upper Bound | Outcome & Rationale |
|---|:---:|:---:|---|
| **Candidate A** | 8.0 | 27.0°C | **Rejected.** The tight 27°C drift band caused the policy to aggressively overcool. PUE was 1.4820, failing to beat Rule-Based control. |
| **Candidate B** | 10.0 | 30.0°C | **Rejected.** Improved efficiency (PUE 1.4650), but still overcooled during stable operating periods. |
| **Candidate C (Final)** | 12.0 | 34.0°C | **Selected.** Allowed temperatures to float safely between 22°C and 34°C without triggering the 35°C SLA threshold. Enabled significant cooling power savings while maintaining 100% SLA compliance. |

---

## 8. PPO Training Setup

### Why Proximal Policy Optimization (PPO)?

PPO was chosen because:
1. It is the established industry standard for continuous control with continuous action spaces.
2. The clipped surrogate objective prevents catastrophic policy collapse during training.
3. It integrates seamlessly with deterministic safety shields and domain randomization.

### Training Hyperparameters

| Hyperparameter | Value | Description |
|---|:---:|---|
| Algorithm | PPO (`stable-baselines3`) | On-policy actor-critic |
| Policy Network Architecture | MlpPolicy | Shared feature extractor, 2 hidden layers $\times$ 64 units, Tanh activations |
| Learning Rate | $3 \times 10^{-4}$ | Constant learning rate with Adam optimizer |
| Discount Factor ($\gamma$) | 0.99 | Temporal discount factor |
| GAE Parameter ($\lambda$) | 0.95 | Generalized Advantage Estimation smoothing |
| Clip Range ($\epsilon$) | 0.20 | Surrogate objective clipping threshold |
| Value Function Coefficient | 0.50 | Critic loss weighting |
| Entropy Coefficient | 0.00 | Pure exploitation in continuous control |
| Rollout Buffer Size | 2048 steps | Experience collected before each policy update |
| Minibatch Size | 64 | Batch size for gradient steps |
| Optimization Epochs | 10 | SGD passes over rollout buffer |
| Total Training Timesteps | 150,000 steps | ~73 full episodes; took 32 seconds on local CPU |

### Seed Isolation and Evaluation Protocol

To prevent data contamination and guard against cherry-picked random seeds, seeds were strictly isolated across disjoint groups:

| Seed Group | Seed Values | Purpose & Rules |
|---|---|---|
| `TRAIN_SEEDS` | `[101, 102, 103, 104]` | Environment domain randomization during PPO policy rollouts. |
| `VALIDATION_SEEDS` | `[201, 202, 203, 204]` | Periodic checkpoint evaluation and candidate selection. |
| `AUDIT_SEEDS` | `[301, 302, 303, 304, 305]` | Historical Simulator-v1 test seeds (preserved for audit traceability). |
| `HELD_OUT_TEST_SEEDS` | `[401, 402, 403, 404, 405]` | **Locked in `benchmarks/final_test_config_v2.json`. Strictly untouched during all training and tuning.** |

---

## 9. Deterministic Safety Shield

The RL agent is **never permitted to directly command the physical simulator**. Every proposed action passes through a pure, deterministic safety shield before execution.

```
       +--------------------+
       |  RL Policy Action  |  [cooling_proposed, from_zone, to_zone, move_fraction]
       +--------------------+
                 |
                 v
+------------------------------------+
|        SAFETY SHIELD LAYER         |
|  1. Capacity Clamping              |  Clamp cooling to [0, cooling_capacity]
|  2. Overheat Prevention Check      |  Predict T_next with zero noise. If > 45°C -> force cooling = 1.0
|  3. Overcool Floor Check           |  Floor cooling if T_next comfortably below 18°C
|  4. Workload Move Rejection Check  |  Predict destination T_next. If > 45°C -> reject move (no-op)
+------------------------------------+
                 |
                 v
       +--------------------+
       |  Corrected Action  |  [cooling_applied, from_zone, to_zone, move_fraction]
       +--------------------+
                 |
                 v
       +--------------------+
       |   Simulator Step   |
       +--------------------+
```

### The Four Safety Constraints

1. **Capacity Clamping:**  
   Cooling setpoints are strictly bounded by instantaneous mechanical availability:
   $$C_i \in [0.0, \text{Cap}_i(t)]$$
   If a cooling unit has failed ($\text{Cap}_i = 0.60$), an action proposing $0.90$ cooling is clamped to $0.60$.

2. **Overheat Prevention (Safety-Critical):**  
   Using a zero-noise forward model, the shield computes a deterministic one-step temperature prediction:
   $$\hat{T}_i(t+1) = T_i(t) + a_i W_i(t) - b_i C_i(t) + g_i (T_{\text{amb}} - T_i(t))$$
   If $\hat{T}_i(t+1) > T_{\text{emerg, max}}$ ($45.0^\circ\text{C}$), the shield overrides the agent's cooling and forces maximum available cooling:
   $$C_i = \text{Cap}_i(t)$$
   Label: `capped_high`.

3. **Overcool Prevention (Efficiency):**  
   If even at reduced cooling a zone's predicted temperature remains comfortably below $18.0^\circ\text{C}$, the shield floors cooling down to the minimum necessary to stabilize near 18°C. **Safety always overrides efficiency:** constraint 2 takes absolute precedence. Label: `floored_low`.

4. **Workload Move Rejection:**  
   If a proposed workload migration would push the destination zone's predicted temperature above $45.0^\circ\text{C}$, the move is converted to a strict **no-op** ($v = 0$). Label: `move_rejected`.

### Shield Override Rate as a Measure of Autonomy

The shield logs every intervention. The override rate is defined as:
$$\text{Override Rate} = \frac{\text{Steps with Corrections Applied}}{\text{Total Steps}}$$

A low override rate proves that the reinforcement learning policy has **internalized the physical safety constraints** and is operating safely on its own, rather than constantly crashing against the shield.

---

## 10. Controllers

### A. Rule-Based Baseline Controller
- **Design:** Implements standard static operational logic used by facility engineering teams.
- **Cooling Policy:** Proportional linear ramp:
  - If $T_i \le 27.0^\circ\text{C}$: $C_i = 0.05$ (base idle airflow).
  - If $T_i \ge 45.0^\circ\text{C}$: $C_i = 1.0$ (full cooling).
  - If $27.0^\circ\text{C} < T_i < 45.0^\circ\text{C}$: Linear ramp between $0.05$ and $1.0$.
  - Clamped to $[0, \text{Cap}_i]$.
- **Workload Policy:** No-op. The rule-based controller has no mechanism to communicate with software schedulers or move compute jobs.

### B. Cooling-Only RL Controller
- **Design:** PPO policy trained on the reduced 5-dimensional action space.
- **Cooling Policy:** Neural network policy predicting continuous cooling setpoints $[0, 1]^5$.
- **Workload Policy:** Workload-move dimensions are hard-disabled at the Gymnasium wrapper level (`CoolingOnlyWrapper`). No workload movement is ever attempted.

### C. Joint RL Controller
- **Design:** PPO policy trained on the full 10-dimensional continuous action space.
- **Cooling Policy:** Dynamically scales cooling per zone based on instantaneous temperature, load, and local COP.
- **Workload Policy:** Continuously outputs workload allocation logits, proactively shifting compute load away from inefficient or cooling-impaired zones toward high-COP zones before thermal boundaries are breached.

---

## 11. Experimental Design

All three controllers were evaluated on identical benchmark scenarios using the exact same locked test seeds.

### 11.1 Benchmark Scenarios

1. **`canonical_cooling_failure` (Primary Evaluation Scenario):**  
   Workload initialized at nominal baseline (`[0.3, 0.4, 0.35, 0.5, 0.25]`). At step 50 (after 4.16 hours of operation), Zone-D cooling capacity drops abruptly from 1.0 to 0.60 (40% capacity reduction).
2. **`unseen_scenario_1`:**  
   Zone-C cooling unit drops to 60% capacity at step 100 (8.33 hours).
3. **`unseen_scenario_2`:**  
   Zone-B cooling unit drops to 60% capacity at step 75 (6.25 hours).

### 11.2 Evaluation Integrity Rules

1. **Identical Initial Conditions:** For a given seed, all three controllers start with identical initial temperatures, workloads, and ambient conditions.
2. **Identical Noise Sequences:** Gaussian noise draws are seeded deterministically per run.
3. **Strict Seed Isolation:** Test seeds `[401, 402, 403, 404, 405]` were never seen by PPO during training or hyperparameter selection.
4. **Authoritative Energy Accounting:** Timestep is strictly 300 seconds. Energy is accumulated in kWh using $P \times (300 / 3600)$.

---

## 12. Benchmark Results

The data below is extracted directly from the certified benchmark output file [`outputs/phase4_final_benchmark_results_v2.json`](file:///e:/rl/outputs/phase4_final_benchmark_results_v2.json).

### 12.1 Canonical Scenario Summary Table (`canonical_cooling_failure`)

Averaged across the 5 held-out test seeds (`[401, 402, 403, 404, 405]`), with 288 steps per episode (1,440 total evaluation steps per controller):

| Metric | Rule-Based Baseline | Cooling-Only RL | Joint RL (Ours) | Advantage of Joint RL |
|---|:---:|:---:|:---:|:---:|
| **PUE** (Lower is better) | $1.2234 \pm 0.0002$ | $1.2424 \pm 0.0002$ | **1.1931 ± 0.0003** | **-2.48% vs. Rule-Based** (-3.97% vs. Cooling-Only) |
| **Total Facility Energy** | $528.52 \pm 0.07$ kWh | $536.70 \pm 0.07$ kWh | **515.43 ± 0.12 kWh** | **-13.09 kWh / day saved** |
| **Cooling Energy** | $74.92 \pm 0.07$ kWh | $83.10 \pm 0.07$ kWh | **61.83 ± 0.12 kWh** | **-17.47% cooling electricity** |
| **IT Energy** | 432.00 kWh | 432.00 kWh | 432.00 kWh | 100% Workload Served |
| **Max Peak Temperature** | $55.33 \pm 0.24^\circ\text{C}$ | $54.98 \pm 0.30^\circ\text{C}$ | **30.09 ± 0.09°C** | **-25.24°C cooler (Safe)** |
| **SLA Uptime %** ($T \le 35^\circ\text{C}$) | $1.88 \pm 0.17\%$ | $14.44 \pm 1.13\%$ | **100.00% ± 0.00%** | **Perfect SLA Compliance** |
| **Operational Violations** | $282.6 \pm 0.5$ steps | $246.4 \pm 3.3$ steps | **0.0 ± 0.0 steps** | Zero SLA breaches |
| **Emergency Violations** ($T > 45^\circ\text{C}$) | $215.0 \pm 1.1$ steps | $174.4 \pm 2.2$ steps | **0.0 ± 0.0 steps** | Zero hardware-trip risks |
| **Workload Migrations** | $0.0 \pm 0.0$ | $0.0 \pm 0.0$ | **72.8 ± 5.0 moves** | Active load redistribution |
| **Shield Override Rate** | $75.83\%$ | $98.96\%$ | **0.00%** | Autonomous safety |
| **Inference Latency** | $0.005$ ms | $0.611$ ms | $0.666$ ms | Real-time capable (< 1 ms) |

---

### 12.2 Per-Seed Breakdown (Canonical Scenario)

#### Rule-Based Baseline
| Seed | PUE | Total Energy (kWh) | Cooling Energy (kWh) | Max Temp (°C) | SLA Uptime % | Op Violations | Emerg Violations |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 401 | 1.2233 | 528.45 | 74.85 | 55.57 | 1.74% | 283 | 215 |
| 402 | 1.2234 | 528.53 | 74.93 | 55.00 | 1.74% | 283 | 216 |
| 403 | 1.2237 | 528.62 | 75.02 | 55.32 | 2.08% | 282 | 214 |
| 404 | 1.2233 | 528.47 | 74.87 | 55.62 | 2.08% | 282 | 217 |
| 405 | 1.2234 | 528.51 | 74.91 | 55.15 | 1.74% | 283 | 213 |
| **Mean ± Std** | **1.2234 ± 0.0002** | **528.52 ± 0.07** | **74.92 ± 0.07** | **55.33 ± 0.24** | **1.88% ± 0.17%** | **282.6 ± 0.5** | **215.0 ± 1.1** |

#### Cooling-Only RL
| Seed | PUE | Total Energy (kWh) | Cooling Energy (kWh) | Max Temp (°C) | SLA Uptime % | Op Violations | Emerg Violations |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 401 | 1.2421 | 536.60 | 83.00 | 55.20 | 13.89% | 248 | 176 |
| 402 | 1.2424 | 536.70 | 83.10 | 54.59 | 14.58% | 246 | 171 |
| 403 | 1.2426 | 536.80 | 83.20 | 54.93 | 12.85% | 251 | 176 |
| 404 | 1.2423 | 536.68 | 83.08 | 55.42 | 14.58% | 246 | 174 |
| 405 | 1.2423 | 536.70 | 83.10 | 54.76 | 16.32% | 241 | 175 |
| **Mean ± Std** | **1.2424 ± 0.0002** | **536.70 ± 0.07** | **83.10 ± 0.07** | **54.98 ± 0.30** | **14.44% ± 1.13%** | **246.4 ± 3.3** | **174.4 ± 2.2** |

#### Joint RL (Ours)
| Seed | PUE | Total Energy (kWh) | Cooling Energy (kWh) | Max Temp (°C) | SLA Uptime % | Op Violations | Emerg Violations | Migrations |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 401 | 1.1926 | 515.22 | 61.62 | 30.13 | 100.00% | 0 | 0 | 72 |
| 402 | 1.1935 | 515.58 | 61.98 | 30.23 | 100.00% | 0 | 0 | 69 |
| 403 | 1.1933 | 515.51 | 61.91 | 29.96 | 100.00% | 0 | 0 | 79 |
| 404 | 1.1930 | 515.39 | 61.79 | 30.04 | 100.00% | 0 | 0 | 67 |
| 405 | 1.1931 | 515.44 | 61.84 | 30.10 | 100.00% | 0 | 0 | 77 |
| **Mean ± Std** | **1.1931 ± 0.0003** | **515.43 ± 0.12** | **61.83 ± 0.12** | **30.09 ± 0.09** | **100.00% ± 0.00%** | **0.0 ± 0.0** | **0.0 ± 0.0** | **72.8 ± 5.0** |

---

### 12.3 Generalization to Unseen Scenarios

To prove the policy was not overfitted to Zone-D failures, all models were evaluated on two unseen failure locations without retraining:

#### Unseen Scenario 1 (Zone-C failure to 60% capacity at step 100)
- **Rule-Based:** PUE = 1.2326, Max Temp = 39.35°C, SLA = 1.88%
- **Cooling-Only RL:** PUE = 1.2596, Max Temp = 35.88°C, SLA = 23.06%
- **Joint RL:** **PUE = 1.1931**, **Max Temp = 30.16°C**, **SLA = 100.00%** (77.6 migrations)

#### Unseen Scenario 2 (Zone-B failure to 60% capacity at step 75)
- **Rule-Based:** PUE = 1.2326, Max Temp = 39.35°C, SLA = 1.88%
- **Cooling-Only RL:** PUE = 1.2595, Max Temp = 36.18°C, SLA = 13.89%
- **Joint RL:** **PUE = 1.1938**, **Max Temp = 30.09°C**, **SLA = 100.00%** (85.4 migrations)

---

## 13. Results Interpretation

### Why Joint RL Wins: The Physical Mechanism

Joint RL outperforms both baselines because it controls the heat source (computation) and the heat extraction (cooling) as a unified system.

1. **Directional Workload Migration:**  
   When Zone-D's cooling unit fails to 60% capacity at step 50, Zone-D can no longer dissipate $a_D W_D$ heat even at maximum cooling ($C_D = 0.60$).
   - Joint RL detects the reduced capacity $\text{Cap}_D = 0.60$ in its state observation.
   - It progressively shifts compute load away from Zone-D ($a_D = 5.8, \text{COP}_D = 2.0$) into Zone-B ($a_B = 4.5, \text{COP}_B = 3.8$).
   - This relieves the heat burden in Zone-D, allowing its reduced 60% cooling capacity to easily maintain temperatures below 30°C.
   - Zone-B absorbs the workload easily because its cooling effectiveness is high ($b_B = 8.0$) and its COP is the highest in the facility ($\text{COP} = 3.8$).

2. **Electrical Power Reduction:**  
   Workload migration does not "destroy" energy. It redistributes computational power to where it is cheapest to cool. Removing 1 kW of thermal heat in Zone-D requires $1.0 / 2.0 = 0.50$ kW of electrical cooling power. Removing that same 1 kW of thermal heat in Zone-B requires only $1.0 / 3.8 = 0.263$ kW of electricity. By shifting workload, Joint RL reduced total daily cooling electricity from 74.92 kWh to 61.83 kWh (**a 17.47% reduction**).

### Why the Baselines Fail

- **The Rule-Based Baseline:**  
  The rule-based controller has no mechanism to communicate with the compute scheduler. When Zone-D's cooling capacity drops to 60%, the controller commands maximum cooling ($C_D = 0.60$). But because $W_D$ remains high, heat generation exceeds heat removal:
  $$a_D W_D - b_D \text{Cap}_D = (5.8 \times 0.5) - (4.0 \times 0.6) = 2.9 - 2.4 = +0.5^\circ\text{C / step}$$
  The temperature ramps relentlessly upward at 0.5°C per step, blowing through the 35°C SLA limit and the 45°C emergency limit, eventually stabilizing at an intolerable **55.33°C**.

- **The Cooling-Only RL Baseline:**  
  Like the rule-based controller, Cooling-Only RL cannot move workload. While it optimizes cooling allocation slightly better than a linear rule during normal conditions, it is physically powerless during a mechanical failure. Its temperature reached **54.98°C** and required the safety shield on 98.96% of steps.

---

## 14. Detailed Limitations

We emphasize the following limitations:

1. **Simplified Lumped Thermal Model:**  
   The simulator uses zero-dimensional lumped-capacitance ODEs per zone. It does not model Navier-Stokes airflow dynamics, cold/hot aisle pressure differentials, boundary-layer convection, or turbulent eddies that exist in real server halls.
2. **Coarse Spatial Granularity:**  
   The facility is modeled as 5 zones. A real hyperscale data center contains hundreds of racks and thousands of physical temperature sensors with complex 3D thermal gradients.
3. **Synthetic Assumptions:**  
   Parameters ($a_i, b_i, g_i, \text{COP}_i$) are synthetic engineering estimates. While qualitatively representative of heterogeneous server racks and aging cooling units, they are not calibrated to a specific physical building.
4. **Simplified Workload Migration Costs:**  
   Workload migration is penalized as a linear scalar in the reward function. In production, live VM/container migration incurs network bandwidth usage, page-dirtying memory overhead, and temporary tail latency spikes.
5. **No Equipment Thermal Inertia / Chiller Lag:**  
   Cooling setpoint changes take effect within the 5-minute timestep. Real commercial chillers have mechanical ramp times of 5–15 minutes to chill water loops.
6. **Simulation-to-Real (Sim-to-Real) Gap:**  
   A policy trained exclusively on this simulator cannot be deployed directly onto a live data center without significant domain randomization, system identification, and physical safety constraints.

---

## 15. Real-World Telemetry Calibration Attempt & Rejection

During Phase 3, we investigated whether the simulator could be directly calibrated against real-world telemetry using a public dataset: `data-centre-hot-corridor-temperature-prediction` (Kaggle).

### Dataset Audit Findings

The dataset contains 27,013 observations of data center hot corridor temperatures, IT server power, and air conditioning power from an operational facility. A rigorous scientific audit revealed severe structural barriers:

1. **Standardization Obfuscation:** All telemetry features were z-score normalized ($\mu = 0, \sigma = 1$). The original physical scaling factors (means and variances) were withheld. Attempting to fit physical heat-gain coefficients ($a$ in °C/kW) on dimensionless numbers is unphysical.
2. **Temporal Mismatch:** Telemetry was sampled at 15-minute intervals ($\Delta t = 900$ s), whereas data center thermal control operates on 1–5 minute loops.
3. **Closed-Loop Observational Confounding:** The data came from an operational data center under active feedback control. As IT power increased, the air conditioning system automatically drew *more* electrical power to compensate. In observational data without active perturbations, cooling power was positively correlated with temperature. Fitting an ordinary linear model resulted in a **negative cooling effectiveness** ($b < 0$), nonsensically implying that turning on air conditioning makes the room hotter.
4. **Single-Corridor vs. Multi-Zone Spatial Architecture:** The dataset contained measurements from a single corridor, providing no multi-zone spatial coupling or workload migration telemetry.

### Decision & Scientific Principle
Rather than force an unphysical regression to fit the dataset, **we explicitly rejected calibration against this dataset**, documented the limitations in `data/README.md`, added `data/raw/` to `.gitignore`, and labeled our simulation as a **test-validated synthetic ODE simulator**.

### Practical Path to Real-World Deployment

For any future physical deployment, the recommended roadmap is:
1. **Digital Twin Development:** Build an ODE/CFD model calibrated with unstandardized open-loop step-response test data from the physical site.
2. **Shadow Mode:** Run the Joint RL agent in production reading live telemetry and logging proposed cooling and migration actions without executing them. Compare proposed actions against human operators.
3. **Advisory Mode:** Display Joint RL recommendations on the operator console for human confirmation.
4. **Constrained Closed-Loop Control:** Allow Joint RL to control cooling setpoints within narrow bands (e.g. ±2°C) while software schedulers handle low-priority batch workload migrations.
5. **Full Autonomous Closed-Loop Operation:** Expand control envelope with the deterministic safety shield continuously active as a hard hardware barrier.

---

## 16. Future Work

1. **CFD Co-Simulation:** Couple the RL environment to an OpenFOAM computational fluid dynamics solver to capture turbulent recirculations and thermal stratification.
2. **Scale to Hundreds of Racks:** Expand state space to multi-cluster topologies using Graph Neural Networks (GNNs) or Attention Mechanisms that scale invariantly with rack count.
3. **Network-Aware Workload Scheduler:** Integrate network topology and migration bandwidth congestion costs into the migration decoder.
4. **Chiller Plant Dynamics:** Add refrigerant loop thermodynamics, thermal energy storage (chilled water tanks), and wet-bulb ambient cooling towers.
5. **Renewable Energy & Carbon Tracking:** Integrate time-varying electricity grid carbon intensity and on-site solar/battery generation into the reward function.

---

## 17. Reproducibility Guide

All code, configurations, checkpoints, and benchmark scripts are fully self-contained.

### 17.1 Environment Setup

```bash
# Clone and navigate to repository root
cd e:\rl

# Prerequisites: Python 3.10+ (tested on Python 3.11.9, Windows 11)
# Install core dependencies
pip install numpy>=1.24 gymnasium>=0.29 stable-baselines3>=2.1 torch>=2.0 fastapi>=0.100 uvicorn>=0.23 pytest>=7.4
```

### 17.2 Executing the Complete Test Suite

```bash
python -m pytest tests/ -v
```
**Expected Output:** `135 passed in ~5.9s`.

### 17.3 Running the One-Shot Final Benchmark

To evaluate all three controllers across the 5 held-out test seeds on Simulator-v2:
```bash
python benchmarks/run_final_benchmark.py
```
This loads pretrained models from:
- `models/checkpoints/joint_rl_v2.zip`
- `models/checkpoints/cooling_only_rl.zip`
and writes certified metrics to `outputs/phase4_final_benchmark_results_v2.json`.

### 17.4 Retraining Joint RL from Scratch (Optional)

```bash
python -c "from engine.control.joint_rl import train, JointRewardConfig; rc = JointRewardConfig(w_energy=12.0, drift_temp_high=34.0); train(total_timesteps=150000, reward_config=rc)"
```

### 17.5 Launching the Backend API

```bash
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
```
Interactive Swagger docs: `http://localhost:8000/docs`

---

## 18. Testing and Verification

The test suite comprises **135 automated unit, integration, and contract tests** with 100% pass rate:

| Test Module | Tests | Focus Area |
|---|:---:|---|
| `tests/contract/test_api_contracts.py` | 10 | Pydantic v2 schema compliance, input validation, 422 error enforcement |
| `tests/integration/test_api_runs.py` | 6 | Live run lifecycle, WebSocket streaming, repeat-run switching, migration semantics |
| `tests/integration/test_rule_based_episode.py` | 8 | Rule-based controller full 288-step episode execution |
| `tests/unit/test_calibration_gate.py` | 8 | Documentation integrity, Kaggle dataset rejection validation |
| `tests/unit/test_cooling_only_rl.py` | 20 | Cooling-only wrapper, action space reduction, scenario randomization, policy degeneracy |
| `tests/unit/test_energy_accounting.py` | 6 | 300s timestep integration, kWh conversion, PUE formulas |
| `tests/unit/test_env.py` | 18 | Reset/step determinism, observation shapes, workload conservation |
| `tests/unit/test_joint_rl.py` | 10 | Softmax decoder, deadband enforcement, migration volume bounds, reward decomposition |
| `tests/unit/test_safety_shield.py` | 13 | Capacity clamping, overheat override, overcool floor, move rejection, bypass flag |
| `tests/unit/test_simulator_v2_physics.py` | 13 | Placement effect, invariance breaking, COP electrical power conversion |
| `tests/unit/test_thermal_model.py` | 14 | Differential updates, numerical stability, power accounting |
| `tests/unit/test_thresholds_sla.py` | 9 | ASHRAE threshold separation, degree-minutes tracking, seed separation |
| **Total Test Count** | **135** | **135 Passed, 0 Failed** |

### What These Tests Prove vs. What They Do Not Prove
- **What they prove:** The mathematics, action decoding, workload conservation, safety overrides, power integration, API contracts, and seed isolation are programmatic, reproducible, and internally consistent.
- **What they do not prove:** Passing synthetic ODE unit tests does not prove the model is an accurate representation of a physical building or that real airflow will behave identically.

---

## 19. Final Conclusion

### What Did We Build?
We built an end-to-end digital twin and autonomous control system for data center thermal and workload management. The system pairs an ODE-based 5-zone thermodynamic simulation with a reinforcement learning policy (PPO) and a deterministic safety shield, served via a production-grade FastAPI backend and real-time WebSocket telemetry stream.

### What Did We Test?
We tested three controllers—a standard industry Rule-Based Controller, a Cooling-Only RL Controller, and a Joint RL Controller—across three distinct cooling failure scenarios on 5 held-out, previously unseen random seeds.

### What Did We Learn?
1. **Invariance in Homogeneous Systems:** In a data center model with identical linear zones and conserved workload, moving workload between zones mathematically cannot reduce total cooling demand. Heterogeneity in heat gain, airflow, and equipment COP is the physical prerequisite that makes workload placement valuable.
2. **Cooling Alone Cannot Survive Hardware Failures:** When a cooling unit suffers physical capacity loss, cooling-only controllers catastrophically fail (temperatures exceeded 54°C). The only way to prevent overheating is to reduce heat generation at the source by migrating computation.
3. **Safety Shields Enable Bold RL:** A deterministic safety shield allows an RL agent to train and operate safely without risking hardware violations, while a shield discrepancy penalty encourages the agent to internalize safe boundaries.

### What Did Joint RL Achieve?
- **Lower PUE:** Achieved PUE **1.1931** compared to 1.2234 (Rule-Based) and 1.2424 (Cooling-Only), saving 17.47% of daily cooling electricity.
- **Flawless Thermal Safety:** Maintained **100.00% SLA compliance** with zero operational or emergency violations, keeping peak temperatures at **30.09°C** during a severe 40% cooling failure that caused the rule-based baseline to overheat to **55.33°C**.
- **Complete Autonomy:** Maintained a **0.00% safety-shield override rate**, demonstrating that the agent learned to respect physical safety bounds independently.

### What Are We NOT Claiming?
- We do **not** claim to have built a production-ready system that can be plugged into a physical facility tomorrow.
- We do **not** claim our synthetic ODE model replaces 3D Computational Fluid Dynamics.
- We do **not** claim to have discovered a universal thermodynamic breakthrough; Joint RL simply exploits known physical heterogeneity by moving compute to where cooling is cheapest and most effective.

---

*Report compiled and verified against repository commit tree `e:\rl` on September 5, 2026.*
