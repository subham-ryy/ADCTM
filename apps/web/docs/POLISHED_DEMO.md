# Control room demo

The control room opens inside a procedural 3D facility, with full-height walls, a ceiling, suspended lighting, yellow cable trays, colored cable bundles and drops, service ductwork, power panels, raised-floor grilles and detailed cabinets. Five labelled rack groups (two display cabinets each) and five cooling modules map directly to the backend's five zones. The cabinet pairs do **not** introduce additional simulated zones or independent measurements. All active UI views consume one telemetry adapter; the legacy scripted room store is no longer used by the application.

## Presenting a run

1. Open the frontend with FastAPI available on port 8000. The checked-in example environment uses live telemetry. Missing backend data is shown as unavailable.
2. Choose Cooling failure and Joint PPO. Experiment settings expose the seed, failure zone, and failure step. The presentation preset is Zone D, step 12, 60% capacity; this uses the existing custom-failure API and does not alter the policy or simulator configuration.
3. Choose 0.5 or 1 step/second and press Run experiment. Changes to the selected scenario/controller take effect only when this button creates a new run.
4. Watch the packet arc between source and destination, cooling module status, per-zone workload bars, and the decision panel. The four stages describe a received, executed simulation step; they are not an account of the neural network's internal reasoning.
5. Pause to inspect a decision. Single-step executes one real backend step. The default camera is inside the room. Overview reveals the layout and cable infrastructure; Reset camera returns inside. Expand gives the room the full width and can be toggled back to show the decision panel.
6. Open Benchmark evidence for the saved five-seed evaluation. It is explicitly separate from the live run and uses the canonical Zone D / step 50 scenario.
7. Open Live telemetry trends below the facility to view the received PUE, temperature and energy history. The drawer starts collapsed to reserve space for the room. Start a different scenario immediately; charts and events reset to the new run. The heatwave policy can breach the operational SLA; those outcomes are displayed without alteration.

The 2D thermal plan remains available through its tab, the `?view=2d` URL, `VITE_ENABLE_3D=false`, or a graphics failure. Reduced-motion mode stops decorative airflow, fan, and transfer movement. The zone buttons provide keyboard-accessible inspection in both views.

## Data integrity and boundaries

- PPO inference, thermal equations, safety projection, model checkpoints, rewards, and benchmark numbers are unchanged.
- Five backend cooling channels are represented individually. A capacity of 60% is labelled derated, not failed.
- Migration indices are converted to the stable `zone-01` through `zone-05` IDs. Migration amount is a fraction of zone utilization, displayed as percentage points; it is not incorrectly labelled kW.
- Shield intervention comes from `corrections_applied`, with proposed cooling and applied cooling displayed separately.
- Overall risk, PUE, power, energy and SLA are received from the API. Temperature colors use fixed backend-configured thresholds.
- The backend does not report per-zone electrical power or cooling heat removal in its API contract. The frontend does not synthesize those measurements.
- Unknown failure timing is not inferred after a page refresh; the schedule marker is shown only for a run created and acknowledged in the current page. Actual capacity reduction remains visible in telemetry.
- Fixture mode is explicitly labelled and cannot start a live experiment. Live connection failures retain the last frame, show a connection notice, stop activity animation, and trigger bounded reconnect plus a fresh snapshot.
- Transfer particles run a finite transit for an applied migration. A recent transfer can remain labelled with its original step for five steps. It is not presented as repeated migration.

## Implementation map

- `src/components/console/OperatorConsole.jsx`: application shell, scenario/controller controls, playback, benchmark dialog.
- `src/components/3d/FacilityView.jsx`: paired cabinets, cooling fans, telemetry labels, interior/overview cameras, locally generated material reflections and finite transfer paths. No remote assets or font requests.
- `src/components/3d/RoomArchitecture.jsx`: static room shell, floor, ceiling, trays, wire bundles and service equipment. Repeated hardware is instanced; the static shell and once-baked contact shadow do not rerender on every telemetry update.
- `src/components/console/console-room.css`: scene-first layout, compact live metrics, expanded-room mode and responsive styling.
- `src/components/console/DecisionPanel.jsx`: observed state, proposal, shield/application, measured result and event history.
- `src/components/console/ThermalPlan.jsx`: standalone Canvas fallback, with accessible text table and correct click coordinates after resizing.
- `src/components/console/TelemetryCharts.jsx`: SVG plots of received PUE, peak temperature and cumulative energy.
- `src/api/liveTelemetry.js`: validated adaptation, command acknowledgement, bounded history, run identity, reconnection and snapshot recovery. `telemetryAdapter.js` re-exports this single adapter for existing consumers.

## Verification

Room-refinement verification (September 6): production build and all 25 frontend tests pass; lint has only pre-existing legacy warnings. Live browser testing covered a complete 288-step cooling-failure episode, a subsequent Normal run, pause at step 13 and a single advance to step 14, 3D → 2D → 3D switching, interior/overview cameras, expanded room, temperature/workload modes, zone inspection, real benchmark results and all three expandable charts. Layouts were inspected at 1536×864 and 390×844 with no horizontal overflow. The RL, API and telemetry adapter were not changed in this refinement. The lazy-loaded Three.js bundle still triggers the existing large-chunk build warning.

Visual evidence: `images/compute-hall-interior.png` and `images/compute-hall-mobile.png`.

The following checks also cover the preceding control-room implementation:

- 25 frontend regression tests pass, including zero values, all five cooling channels, migration units, shield corrections, missing measurements, held run identities, sequence ordering, reconnect/resnapshot, commands and scenario settings.
- 16 existing API/integration/contract tests pass.
- Production build succeeds, with the Three.js subtree loaded separately.
- Live browser checks: real cooling failure with migration and derating; pause and one-step execution; immediate subsequent heatwave run through completion; saved benchmark table; 3D/2D switching; desktop and narrow-screen layout.
- Existing lint warnings are confined to legacy components retained in the repository; the new control room has no lint errors.

Start the frontend with `npm run dev` from `frontend`. If the main Python environment lacks dependencies, the repository-local `.venv` created during verification can run `python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000` from the repository root. No live training or external data service is involved.
