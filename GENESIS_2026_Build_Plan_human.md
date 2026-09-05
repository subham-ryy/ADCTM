# GENESIS 2026 — Project Build Plan
## Autonomous Data Center Thermal + Workload Control (Digital Twin Track)

This document explains, in plain language, what we're building, why, how the AI part actually works, what we're borrowing from other people's code, and the exact order to build it in. Read this once fully before touching code. Give this whole file to your IDE agent as context when you start building each piece.

---

## 1. What problem are we actually solving?

Data centers run their cooling systems way more conservatively than they need to. Operators keep a big safety margin because if they push cooling too low and something goes wrong (a cooling unit fails, workload spikes suddenly), servers overheat and get damaged. Nobody wants to test "how low can we safely go" on real, expensive hardware — so they never find out, and they burn a huge amount of unnecessary energy. Cooling alone is typically 30-40% of a data center's total power bill.

**Our answer:** build a simulated data center (a "digital twin") that's physically realistic enough to trust, and train an AI agent inside it to find the actual safe minimum — how little cooling can you run, and how should you move workloads around, without ever risking overheating.

The official problem statement asks for a twin you can poke with "what if" questions (what if a cooling unit fails, what if we add 10 more servers). We're doing that, but the twin isn't just for humans to click buttons on — it's the training ground for an AI controller, and that controller is the actual product.

---

## 2. The two decisions our AI needs to make

Most people who touch this problem only think about **cooling**: turn the AC up or down. That's the obvious lever. We're doing something almost nobody else in the room will think of: **workload placement**.

Here's the intuition. Heat isn't caused by "the room being warm" — it's caused by *where the compute load is running*. If you cram all your busy servers into one rack, that rack overheats even if the room average is fine. A smart controller doesn't just blast more cooling at a hot rack — it can also **move the workload somewhere cooler**, which is often cheaper and faster than fighting the heat with more AC.

So our AI controls **two things at once**:
1. **Cooling allocation** — how much cooling power to send to each zone
2. **Workload placement** — which rack should run which job

This joint control is the actual technical differentiator of our project. Almost every "data center digital twin" hackathon project you'll see only does #1.

---

## 3. How the simulation actually works (the physics)

We're not doing real fluid dynamics (that's overkill and slow). We're using a simplified but legitimate physics model — the same style used in real published research on this exact problem (Google/DeepMind have done real RL-controlled cooling in production data centers).

For every "zone" (a cluster of racks) at every time step, temperature updates like this:

```
new_temp = old_temp
           + (heat added by workload running there)
           - (heat removed by cooling)
           + (heat leaking in/out from room ambient temperature)
           + (a little random noise, because real sensors are noisy)
```

That's it. It's one equation, computed for every zone, every time step. Each zone also tracks: current workload level, current cooling setting, and how close it is to a critical/dangerous temperature.

**Failure injection:** at some point during a run, we simulate a cooling unit dropping to reduced capacity (say 60%) *without telling the agent* — it has to notice temperatures rising unexpectedly and react. This is what makes the demo dramatic and proves the AI is actually adapting, not just following a memorized pattern.

---

## 4. The RL agent — explained without jargon

RL (Reinforcement Learning) means: the AI doesn't get told the right answer. It gets dropped into the simulation, tries actions, and gets a score after each action. Over many thousands of attempts, it learns which actions lead to good scores.

**What it sees (its "senses"):** temperature of every zone, workload of every zone, current cooling settings, outside/ambient temperature.

**What it controls (its "hands"):** for each zone, how much cooling to apply (a dial from 0 to max), and optionally, move a workload from one zone to another.

**How it's scored (the reward):** every time step, it gets penalized for:
- Running temperatures close to the danger zone (penalized hard — this matters most)
- Using more cooling energy than necessary (penalized some)
- Making jittery, unstable decisions that flip-flop rapidly (penalized a little)

It wants to keep temperatures safe using as little energy as possible, as smoothly as possible. Over training, it discovers strategies no human explicitly programmed — e.g. "pre-cool this zone slightly before load arrives" or "shift load away instead of over-cooling."

**Training time reality:** the actual computation is fast (well under an hour on a normal laptop CPU, no GPU needed for this — the simulation is small). What takes real time is *tuning the reward* so the agent doesn't find a lazy or broken strategy (like "just never turn on cooling" if the penalty math is off). Expect several retrain cycles, ~20-60 min each, while you watch its behavior and adjust the scoring. Budget roughly 6-8 hours total for this whole piece, spread across the event, not done in one sitting.

---

## 5. The Safety Shield — our most important architecture upgrade

Here's a serious weak point in "just use RL": if the AI is still learning, or gets a weird input it's never seen, it might propose a dangerous action. Relying purely on "the reward function will teach it not to" is a shaky answer if a judge pushes on it.

**Fix:** put a simple, dumb, 100%-reliable rule layer *outside* the AI, that checks every action before it's allowed to happen.

```
AI proposes an action
        ↓
Safety Shield checks it:
   - Would this push any zone above the critical temperature? → block it, force minimum safe cooling instead
   - Is cooling being set to something silly (negative, over max)? → clamp it to a valid range
        ↓
The (possibly corrected) action actually happens in the simulation
```

This is a handful of `if` statements, not a second AI. But it's the single best answer to "what if your AI is wrong" — because the answer becomes "it physically can't cause a failure, there's a hard rule outside it that won't let it."

**Framing for judges:** *"The RL agent is the optimizer. The safety shield is the authority. The AI proposes; the shield has final veto power."*

---

## 6. The proof — three-way comparison

This is your single most important piece of evidence, and it's cheap to build once the simulator exists. Run the exact same scenario (including the cooling failure) through three different controllers and record the results:

| Controller | PUE (lower=better) | Max Temp Reached | Safety Violations |
|---|---|---|---|
| Rule-based (what real ops teams do today — fixed thresholds) | (your real number) | (your real number) | (your real number) |
| Cooling-only RL (the "obvious" approach everyone else might build) | (your real number) | (your real number) | (your real number) |
| **Our joint RL (cooling + workload placement)** | (your real number) | (your real number) | (your real number) |

**PUE** (Power Usage Effectiveness) is the real industry metric operators actually report — total facility power divided by IT equipment power. Using it instead of a made-up "% energy saved" number makes your result legible to anyone who's touched real infrastructure. Use your actual experiment output — never invent these numbers.

This table alone tells the whole story: rule-based is safe but wasteful, cooling-only RL saves energy but is worse than joint RL, and joint RL gets the best of both. That comparison is your demo's climax.

---

## 7. What we build ourselves vs. what we reference

### From the ADCTM repo (github.com/na124441/ADCTM) — a trusted senior's reference, use freely for architecture/patterns:

**Use directly as inspiration (rewrite in our own code, don't literally clone their files):**
- The thermal ODE formula (Section 3 above is directly adapted from it — it's correct, proven physics)
- The state/action space shape (temperatures, workloads, previous cooling settings, ambient temp)
- The weighted evaluation metric idea (safety weighted highest, then precision, then efficiency, then smoothness) — copy the *shape*, use our own weights/numbers
- Their baseline comparison structure (rule-based / PID / RL) — we're extending this to include our joint-RL column, which they don't have

**What we're adding that they don't have (our actual differentiator):**
- Workload placement as a second action alongside cooling (their action space is cooling-only)
- The Safety Shield as an explicit separate layer
- The three-way comparison including joint control

### From the FlowCore repos (github.com/FlowCoreHackUPC) — a different hackathon's data center config/energy tool, borrow ideas only, don't integrate their code:

**Ideas worth adopting (cheap, build ourselves from scratch):**
- **Safety Shield concept** (see Section 5) — their broader system inspired this, we implement it fresh, small
- **Three-way benchmark table as the hero proof** (see Section 6)
- **Ambient temperature as a disturbance input** — we already have this in the ODE (Section 3), just script it as `ambient = baseline + scenario_change` for demo scenarios (no live weather API — that's an unnecessary network dependency during a demo)
- **A templated decision-explanation line**, e.g.: *"Rack 4 approaching thermal limit → moved workload W17 to Rack 9 → Cooling Unit 2 reduced by 8%"* — generate this from the actual state change each step, no AI/LLM call needed, same effect, zero risk

**Explicitly NOT integrating (real scope, real risk, doesn't match our core problem):**
- Their MQTT message broker, MongoDB persistence, React Flow visual canvas, OR-Tools static layout optimizer, live weather API, Gemini-based config generator, water/power/transformer infrastructure modeling
- These solve a different problem (data center *design/configuration*) not ours (data center *operational control*). Pulling any of this in adds integration hours and demo fragility for no payoff toward our actual differentiator.

---

## 8. The 3D visual (only if time allows — not the priority)

A teammate can build simplified 3D models in Blender (one server rack, one cooling unit, floor tiles — reused/instanced, not modeled individually per rack) and export as GLB/GLTF files. These get loaded into the web dashboard using **three.js**, and rack colors update live based on real temperature data from the simulation.

**Important:** Blender is only used to *build the models beforehand*. During the actual demo, we're not running Blender at all — just a browser tab rendering the exported model, driven by live data. This is cheap on the GPU and doesn't compete with anything else running.

**Fallback (always keep this ready):** a plain 2D grid of colored rectangles per zone, color = temperature. This is completely demo-legitimate on its own — judges care about seeing the AI's decisions and proof, not photorealism. If the 3D pipeline isn't rock solid by the halfway point of the event, drop it and use the 2D version. Don't let 3D become a single point of failure.

---

## 9. Full system architecture (final shape)

```
                    ┌──────────────────────┐
                    │  DASHBOARD (browser) │
                    │  heatmap / PUE chart │
                    │  decision panel      │
                    └──────────┬───────────┘
                               │  (reads live state)
                        FastAPI Backend
                     (/reset  /step  /state)
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
   Thermal Simulator     RL Controller          Safety Shield
   (the ODE physics,     (proposes cooling +    (checks every
    zones, ambient,       workload actions)      proposed action,
    failure injection)          │                 blocks/clamps
          │                     │                 unsafe ones)
          │                     └─────────┬───────────┘
          │                               │
          │                     (approved action)
          └───────────────────────────────┘
                               │
                     Metrics: PUE, Max Temp,
                     Safety Violations, Energy Used
                               │
                    Three-way Benchmark Table
                (Rule-based / Cooling-only RL / Joint RL)
```

---

## 10. Build order — do it in this sequence

**Phase 1 (hours 0-6): Core simulator + environment**
- Build the thermal ODE simulator (Section 3) — small Python module, no dependencies on anything else
- Define state/action/reward exactly as in Section 4
- Get one full episode running end-to-end (agent takes random actions, simulator responds) — this proves the plumbing works before any real training happens

**Phase 2 (hours 6-10): Safety Shield + rule-based baseline**
- Write the Safety Shield logic (Section 5) — this is small and fast, do it early since everything downstream depends on it existing
- Write a simple rule-based controller (fixed thresholds) — this is your first baseline for the comparison table

**Phase 3 (hours 10-18): RL training**
- Train the cooling-only RL agent first (simpler, proves the training loop works)
- Then train the joint RL agent (cooling + workload placement) — this is your real differentiator, give it the most reward-tuning time
- Save checkpoints as you go — never plan to train live on stage

**Phase 4 (hours 18-24): Backend API + data**
- Wrap the simulator/agent in FastAPI routes (`/reset`, `/step`, `/state`, `/simulate`)
- Build the failure-injection and ambient-temperature scenario scripts

**Phase 5 (hours 20-28, parallel with Phase 4): Frontend dashboard**
- 2D heatmap grid first (non-negotiable fallback)
- PUE timeline chart, decision panel, safety envelope chart
- If time and the 3D pipeline teammate is ahead of schedule, integrate the three.js scene — test this integration early (get one asset rendering by hour ~14), don't leave it to the end

**Phase 6 (hours 28-32): Three-way benchmark run**
- Run all three controllers through the identical scenario (including the cooling failure)
- Record real numbers into the comparison table — this is your proof artifact

**Phase 7 (hours 32-36): Demo rehearsal + buffer**
- Rehearse the pitch using the real recorded numbers
- Keep buffer time for whatever inevitably breaks

---

## 11. The demo script (rehearse this exact sequence)

1. **0-10s:** Show the dashboard at a normal, stable state — nothing looks wrong yet.
2. **10-30s:** Trigger the cooling failure scenario live. Temperatures start climbing.
3. **30-60s:** Show the RL agent reacting — cooling reallocating, a workload migrating away from the hot zone. Point out the Safety Shield is active but not needing to intervene, because the agent is already staying safe.
4. **60-90s:** Pull up the three-way comparison table. Point at the joint-RL row: lowest PUE, safe temperatures, zero violations — better than both the rule-based and cooling-only baselines.
5. **90-110s:** One more scenario (e.g. sudden workload spike, or push a value the agent hasn't specifically seen) to prove it's not just replaying a memorized script — this single moment kills the "is this hardcoded" objection.
6. **110s+:** Close with the one-sentence pitch:

> *"We built a closed-loop digital twin where an RL controller jointly manages cooling and workload placement, with a hard safety shield outside the policy — and we prove it against rule-based and cooling-only baselines on PUE, under a live cooling failure."*

---

## 12. What to say if judges push back

- **"Isn't this just a router with dials?"** → No — the joint action space (cooling + workload placement together) is the actual hard part; almost no other team will build the placement half.
- **"What if the AI does something dangerous?"** → It can't — the Safety Shield is a separate, deterministic rule layer with veto power outside the learned policy.
- **"How do we know these numbers are real?"** → All three controllers ran the identical scenario, same seed, same failure injection — it's a controlled comparison, not cherry-picked.
- **"Is this deployable or just a toy?"** → The physics model, PUE metric, and MDP formulation mirror published real-world approaches (e.g. Google/DeepMind's data center cooling RL work) — this is a scaled-down version of a real production pattern, not an invented one.

---

**Give this file to your IDE agent as project context before asking it to write any specific module — it should understand the whole shape before generating Phase 1 code.**
