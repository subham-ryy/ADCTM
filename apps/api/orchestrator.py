"""Simulation orchestrator — in-memory session manager.

Owns the step loop and run lifecycle. Does NOT contain thermal equations,
action decoding, or controller logic.  Delegates to:
  - engine.env.DataCenterEnv
  - engine.control.rule_based.RuleBasedController
  - engine.control.cooling_only_rl.CoolingOnlyWrapper
  - engine.control.joint_rl.JointRLWrapper
  - engine.safety.safety_shield.apply_safety_shield
  - engine.scenarios.scenario_env.*
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Optional

import numpy as np

from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig, TIMESTEP_SECONDS
from engine.control.rule_based import RuleBasedController
from engine.control.cooling_only_rl import CoolingOnlyWrapper
from engine.control.joint_rl import JointRLWrapper
from engine.safety.safety_shield import apply_safety_shield
from engine.scenarios.scenario_env import (
    get_reset_options,
    apply_failure_injection,
    load_scenarios,
)

from packages.contracts.schemas import (
    ControllerName,
    ScenarioName,
    RunStatus,
    RiskLevel,
    TelemetryFrame,
    PowerInfo,
    EnergyInfo,
    SLAInfo,
    MigrationEvent,
    ShieldInfo,
    ControllerAction,
    RunSummary,
)


def _compute_risk(max_temp: float, cfg: ThermalConfig) -> RiskLevel:
    """Determine risk level from peak zone temperature."""
    if max_temp >= cfg.emergency_max_temperature_c:
        return RiskLevel.EMERGENCY
    if max_temp >= cfg.critical_temp:
        return RiskLevel.CRITICAL
    if max_temp >= cfg.operational_max_temperature_c:
        return RiskLevel.WARNING
    return RiskLevel.NORMAL


def _get_failure_params(scenario_name: str) -> Optional[dict[str, Any]]:
    """Extract failure injection parameters from scenarios.json.

    Returns None if the scenario has no failure injection.
    """
    scenarios = load_scenarios()
    s = scenarios.get(scenario_name, {})
    fi = s.get("failure_injection")
    if fi is None:
        return None
    return {
        "zone_index": int(fi["zone_index"]),
        "trigger_step": int(fi["trigger_step"]),
        "reduced_capacity": float(fi["reduced_capacity"]),
    }


class SimulationSession:
    """Encapsulates a single simulation run.

    Manages the environment, controller, and step-by-step execution.
    The safety shield is applied exactly once per step:
      - Rule-based: shield applied in this orchestrator
      - Cooling-only RL: shield applied inside CoolingOnlyWrapper
      - Joint RL: shield applied inside JointRLWrapper
    """

    def __init__(
        self,
        cfg: ThermalConfig,
        controller_name: ControllerName,
        scenario_name: ScenarioName,
        seed: int,
        step_rate_hz: float,
        cooling_only_model: Any,
        joint_rl_model: Any,
        custom_failure: Optional[dict[str, Any]] = None,
    ) -> None:
        self.run_id = str(uuid.uuid4())[:8]
        self.cfg = cfg
        self.controller_name = controller_name
        self.scenario_name = scenario_name
        self.seed = seed
        self.step_rate_hz = step_rate_hz
        self.status = RunStatus.CREATED
        self.current_step = 0
        self.total_steps = cfg.episode_length  # 288

        # SLA tracking
        self._operational_violations = 0
        self._emergency_violations = 0
        self._operational_degree_minutes = 0.0

        # Events for current step
        self._step_events: list[str] = []
        self._failure_injected = False

        # Failure parameters from scenario config (not hardcoded)
        if custom_failure is not None:
            self._failure_params = custom_failure
        else:
            self._failure_params = _get_failure_params(scenario_name.value)

        # Latest telemetry frame
        self.latest_telemetry: Optional[TelemetryFrame] = None

        # Build environment and controller
        self._base_env = DataCenterEnv(config=cfg)
        self._options = get_reset_options(scenario_name.value, cfg)

        # Controller-specific setup
        if controller_name == ControllerName.RULE_BASED:
            self._controller = RuleBasedController(config=cfg)
            self._wrapped_env = None
            self._rl_model = None
        elif controller_name == ControllerName.COOLING_ONLY_RL:
            self._controller = None
            # CoolingOnlyWrapper with apply_shield=True — shield is inside wrapper
            self._wrapped_env = CoolingOnlyWrapper(
                self._base_env, apply_shield=True
            )
            self._rl_model = cooling_only_model
        elif controller_name == ControllerName.JOINT_RL:
            self._controller = None
            # JointRLWrapper with apply_shield=True, training=False
            self._wrapped_env = JointRLWrapper(
                self._base_env, apply_shield=True, training=False
            )
            # Set failure injection params on the wrapper (loaded from scenarios.json)
            if self._failure_params is not None:
                self._wrapped_env._failure_zone = self._failure_params["zone_index"]
                self._wrapped_env._failure_step = self._failure_params["trigger_step"]
                self._wrapped_env._failure_capacity = self._failure_params["reduced_capacity"]
            self._rl_model = joint_rl_model

    def reset(self) -> RunSummary:
        """Reset the environment and prepare for stepping."""
        self.current_step = 0
        self._operational_violations = 0
        self._emergency_violations = 0
        self._operational_degree_minutes = 0.0
        self._failure_injected = False
        self.status = RunStatus.CREATED

        if self.controller_name == ControllerName.RULE_BASED:
            self._obs, _ = self._base_env.reset(
                seed=self.seed, options=self._options
            )
        elif self.controller_name == ControllerName.COOLING_ONLY_RL:
            self._obs, _ = self._wrapped_env.reset(
                seed=self.seed, options=self._options
            )
        elif self.controller_name == ControllerName.JOINT_RL:
            # Re-set failure params before reset (reset clears them if training=True,
            # but training=False preserves pre-configured attributes)
            if self._failure_params is not None:
                self._wrapped_env._failure_zone = self._failure_params["zone_index"]
                self._wrapped_env._failure_step = self._failure_params["trigger_step"]
                self._wrapped_env._failure_capacity = self._failure_params["reduced_capacity"]
            self._obs, _ = self._wrapped_env.reset(
                seed=self.seed, options=self._options
            )

        self.latest_telemetry = None
        return self.get_summary()

    def step_once(self) -> TelemetryFrame:
        """Execute exactly one simulation step and return a TelemetryFrame."""
        self._step_events = []

        # ---- Apply failure injection (rule-based and cooling-only only) ----
        # Joint RL handles failure injection internally via its wrapper
        if self.controller_name in (
            ControllerName.RULE_BASED,
            ControllerName.COOLING_ONLY_RL,
        ):
            if self._failure_params is not None:
                fp = self._failure_params
                if self.current_step >= fp["trigger_step"] and not self._failure_injected:
                    self._failure_injected = True
                if self.current_step >= fp["trigger_step"]:
                    self._base_env._cooling_capacity[fp["zone_index"]] = fp["reduced_capacity"]
                    if self.current_step == fp["trigger_step"]:
                        zone_idx = fp["zone_index"]
                        cap = fp["reduced_capacity"]
                        self._step_events.append(
                            f"FAILURE: Zone {zone_idx} cooling capacity reduced to {cap:.0%}"
                        )

        # ---- Controller action ----
        proposed_action: dict[str, Any]
        applied_action: dict[str, Any]
        shield_info_dict: dict[str, Any]
        migration: Optional[MigrationEvent] = None
        step_done = False

        # Capture pre-step workloads to verify actual applied migration deltas
        workloads_before = np.array(self._base_env._workloads, dtype=np.float64).copy()

        if self.controller_name == ControllerName.RULE_BASED:
            # Get state and proposed action
            state = self._base_env.get_state_dict()
            proposed_dict = self._controller.act(state)

            # Apply safety shield ONCE (rule-based has no wrapper to do it)
            corrected, shield_info_raw = apply_safety_shield(
                proposed_dict, state, self.cfg
            )

            proposed_c = proposed_dict["cooling"].tolist()
            applied_c = corrected["cooling"].tolist()
            proposed_action = ControllerAction(
                cooling=proposed_c,
                from_zone=proposed_dict["from_zone"],
                to_zone=proposed_dict["to_zone"],
                move_fraction=proposed_dict["move_fraction"],
                amount=0.0,
            )
            shield_info_dict = shield_info_raw

            if shield_info_raw["corrections_applied"] > 0:
                self._step_events.append(
                    f"SHIELD: {shield_info_raw['corrections_applied']} correction(s) applied"
                )

            # Convert corrected action to raw array for env.step()
            raw_action = self._controller.act_raw(state, self.cfg.num_zones)
            # Override cooling with shield-corrected values
            N = self.cfg.num_zones
            raw_action[:N] = (
                np.array(corrected["cooling"], dtype=np.float32) * 2.0 - 1.0
            )

            _, _, terminated, truncated, info = self._base_env.step(raw_action)
            step_done = terminated or truncated

        elif self.controller_name == ControllerName.COOLING_ONLY_RL:
            # CoolingOnlyWrapper applies shield internally
            action, _ = self._rl_model.predict(self._obs, deterministic=True)
            self._obs, _, terminated, truncated, info = self._wrapped_env.step(action)
            step_done = terminated or truncated

            proposed_c = info.get("proposed_cooling", action)
            applied_c = info.get("applied_cooling", proposed_c)
            si = info.get("shield_info", {
                "corrections_applied": 0,
                "zone_corrections": ["none"] * self.cfg.num_zones,
                "move_rejected": False,
            })

            proposed_action = ControllerAction(
                cooling=np.asarray(proposed_c).tolist(),
                from_zone=0, to_zone=0, move_fraction=0.0, amount=0.0,
            )
            shield_info_dict = si

            if si.get("corrections_applied", 0) > 0:
                self._step_events.append(
                    f"SHIELD: {si['corrections_applied']} correction(s) applied"
                )

        elif self.controller_name == ControllerName.JOINT_RL:
            # JointRLWrapper applies shield, failure injection, and migration internally
            action, _ = self._rl_model.predict(self._obs, deterministic=True)
            self._obs, _, terminated, truncated, info = self._wrapped_env.step(action)
            step_done = terminated or truncated

            proposed_c = info.get("proposed_cooling", [0.0] * self.cfg.num_zones)
            applied_c = info.get("applied_cooling", proposed_c)
            si = info.get("shield_info", {
                "corrections_applied": 0,
                "zone_corrections": ["none"] * self.cfg.num_zones,
                "move_rejected": False,
            })
            prop_mig = info.get("proposed_migration", {})

            proposed_action = ControllerAction(
                cooling=list(proposed_c) if not isinstance(proposed_c, list) else proposed_c,
                from_zone=prop_mig.get("from_zone", 0),
                to_zone=prop_mig.get("to_zone", 0),
                move_fraction=float(prop_mig.get("move_fraction", 0.0)),
                amount=float(prop_mig.get("amount", 0.0)),
            )
            shield_info_dict = si

            if si.get("corrections_applied", 0) > 0:
                self._step_events.append(
                    f"SHIELD: {si['corrections_applied']} correction(s) applied"
                )
            if si.get("move_rejected", False):
                self._step_events.append("SHIELD: Workload move rejected (safety)")

            # Check if failure was just injected
            if (
                self._failure_params is not None
                and self.current_step == self._failure_params["trigger_step"]
            ):
                zone_idx = self._failure_params["zone_index"]
                cap = self._failure_params["reduced_capacity"]
                self._step_events.append(
                    f"FAILURE: Zone {zone_idx} cooling capacity reduced to {cap:.0%}"
                )

        # ---- Derive migration event and applied_action strictly from actual workload delta ----
        workloads_after = np.array(self._base_env._workloads, dtype=np.float64).copy()
        delta = workloads_after - workloads_before
        applied_cooling_list = list(applied_c) if not isinstance(applied_c, list) else applied_c

        if np.max(delta) > 1e-6 and np.min(delta) < -1e-6:
            to_zone = int(np.argmax(delta))
            from_zone = int(np.argmin(delta))
            actual_amount = float(delta[to_zone])
            source_w = workloads_before[from_zone]
            actual_move_fraction = float(actual_amount / source_w) if source_w > 1e-6 else 0.0

            migration = MigrationEvent(
                from_zone=from_zone,
                to_zone=to_zone,
                amount=actual_amount,
            )
            applied_action = ControllerAction(
                cooling=applied_cooling_list,
                from_zone=from_zone,
                to_zone=to_zone,
                move_fraction=actual_move_fraction,
                amount=actual_amount,
            )
            self._step_events.append(
                f"MIGRATION: Zone {from_zone} -> Zone {to_zone} ({actual_amount:.4f})"
            )
        else:
            migration = None
            applied_action = ControllerAction(
                cooling=applied_cooling_list,
                from_zone=0,
                to_zone=0,
                move_fraction=0.0,
                amount=0.0,
            )

        # ---- Read post-step state ----
        temperatures = self._base_env._temperatures.tolist()
        workloads = self._base_env._workloads.tolist()
        cooling_applied = (
            applied_action.cooling
            if applied_action is not None
            else [0.0] * self.cfg.num_zones
        )
        cooling_capacity = self._base_env._cooling_capacity.tolist()
        ambient_temp = self._base_env._ambient_temp
        max_temp = float(np.max(self._base_env._temperatures))

        # ---- Power & energy from env accumulators ----
        step_power = info.get("step_power", {})
        it_power_kw = step_power.get("it_power_kw", 0.0)
        cooling_power_kw = step_power.get("cooling_power_kw", 0.0)
        overhead_kw = step_power.get("overhead_kw", 0.0)
        total_power_kw = step_power.get(
            "total_facility_power_kw",
            step_power.get("total_power_kw", it_power_kw + cooling_power_kw + overhead_kw),
        )

        power_info = PowerInfo(
            it_power_kw=it_power_kw,
            cooling_power_kw=cooling_power_kw,
            overhead_kw=overhead_kw,
            total_power_kw=total_power_kw,
        )

        ts_factor = TIMESTEP_SECONDS / 3600.0
        it_kwh = self._base_env._cumulative_it_power * ts_factor
        cooling_kwh = self._base_env._cumulative_cooling_power * ts_factor
        overhead_kwh = self._base_env._cumulative_overhead * ts_factor
        total_kwh = it_kwh + cooling_kwh + overhead_kwh
        step_pue = step_power.get("pue", total_power_kw / max(it_power_kw, 1e-9))
        cumulative_pue = total_kwh / max(it_kwh, 1e-9)

        energy_info = EnergyInfo(
            it_energy_kwh=it_kwh,
            cooling_energy_kwh=cooling_kwh,
            overhead_energy_kwh=overhead_kwh,
            total_facility_energy_kwh=total_kwh,
        )

        # ---- SLA tracking ----
        op_excess = np.maximum(
            np.array(temperatures) - self.cfg.operational_max_temperature_c, 0.0
        )
        if np.any(op_excess > 0.0):
            self._operational_violations += 1
            self._operational_degree_minutes += float(np.sum(op_excess) * 5.0)
        if np.any(np.array(temperatures) > self.cfg.emergency_max_temperature_c):
            self._emergency_violations += 1

        self.current_step += 1
        total_steps_so_far = self.current_step
        sla_info = SLAInfo(
            sla_uptime_pct=100.0 * (1.0 - self._operational_violations / max(total_steps_so_far, 1)),
            operational_violations=self._operational_violations,
            emergency_violations=self._emergency_violations,
            operational_degree_minutes=self._operational_degree_minutes,
        )

        # ---- Risk level ----
        risk = _compute_risk(max_temp, self.cfg)

        # ---- Build telemetry frame ----
        frame = TelemetryFrame(
            step=self.current_step,
            timestamp=time.time(),
            temperatures=temperatures,
            workloads=workloads,
            cooling=cooling_applied,
            cooling_capacity=cooling_capacity,
            ambient_temp=ambient_temp,
            power=power_info,
            pue=step_pue,
            cumulative_pue=cumulative_pue,
            energy=energy_info,
            sla=sla_info,
            risk=risk,
            max_temp=max_temp,
            controller_action=proposed_action,
            applied_action=applied_action,
            shield_info=ShieldInfo(
                corrections_applied=shield_info_dict.get("corrections_applied", 0),
                zone_corrections=shield_info_dict.get(
                    "zone_corrections", ["none"] * self.cfg.num_zones
                ),
                move_rejected=shield_info_dict.get("move_rejected", False),
            ),
            migration=migration,
            events=list(self._step_events),
            done=step_done,
        )

        self.latest_telemetry = frame

        if step_done:
            self.status = RunStatus.COMPLETED

        return frame

    def get_summary(self) -> RunSummary:
        """Return the current run summary."""
        return RunSummary(
            run_id=self.run_id,
            status=self.status,
            controller=self.controller_name,
            scenario=self.scenario_name,
            seed=self.seed,
            step_rate_hz=self.step_rate_hz,
            current_step=self.current_step,
            total_steps=self.total_steps,
            telemetry=self.latest_telemetry,
        )


class SessionManager:
    """Manages the single active simulation run.

    Only one run may be active at a time (per AGENTS.md demo requirements).
    Starting a new run auto-stops the previous one.
    """

    def __init__(self) -> None:
        self.current_session: Optional[SimulationSession] = None
        self._playback_task: Optional[asyncio.Task] = None
        self._broadcast_callback: Optional[Any] = None

    def set_broadcast_callback(self, callback) -> None:
        """Set the async callback for broadcasting telemetry via WebSocket."""
        self._broadcast_callback = callback

    def create_session(
        self,
        cfg: ThermalConfig,
        controller_name: ControllerName,
        scenario_name: ScenarioName,
        seed: int,
        step_rate_hz: float,
        cooling_only_model: Any,
        joint_rl_model: Any,
        custom_failure: Optional[dict[str, Any]] = None,
    ) -> SimulationSession:
        """Create a new session, stopping any existing one."""
        # Stop current run
        if self.current_session is not None:
            self._stop_playback()
            if self.current_session.status in (RunStatus.RUNNING, RunStatus.PAUSED):
                self.current_session.status = RunStatus.STOPPED

        session = SimulationSession(
            cfg=cfg,
            controller_name=controller_name,
            scenario_name=scenario_name,
            seed=seed,
            step_rate_hz=step_rate_hz,
            cooling_only_model=cooling_only_model,
            joint_rl_model=joint_rl_model,
            custom_failure=custom_failure,
        )
        session.reset()
        self.current_session = session
        return session

    async def start_playback(self) -> None:
        """Start auto-play stepping loop."""
        if self.current_session is None:
            return
        if self.current_session.status in (RunStatus.COMPLETED, RunStatus.FAILED):
            return

        self.current_session.status = RunStatus.RUNNING
        self._stop_playback()  # cancel any existing task
        self._playback_task = asyncio.create_task(self._playback_loop())

    def _stop_playback(self) -> None:
        """Cancel the background playback task if running."""
        if self._playback_task is not None and not self._playback_task.done():
            self._playback_task.cancel()
            self._playback_task = None

    async def _playback_loop(self) -> None:
        """Background loop that steps the simulation at step_rate_hz."""
        session = self.current_session
        if session is None:
            return

        try:
            while session.status == RunStatus.RUNNING:
                frame = session.step_once()

                # Broadcast telemetry via WebSocket
                if self._broadcast_callback is not None:
                    await self._broadcast_callback(session.run_id, frame)

                if frame.done:
                    session.status = RunStatus.COMPLETED
                    # Broadcast final state
                    if self._broadcast_callback is not None:
                        await self._broadcast_callback(session.run_id, frame)
                    break

                # Wait for next step
                await asyncio.sleep(1.0 / session.step_rate_hz)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if session is not None:
                session.status = RunStatus.FAILED
                session._step_events.append(f"ERROR: {e}")

    async def pause(self) -> None:
        """Pause the current run."""
        if self.current_session and self.current_session.status == RunStatus.RUNNING:
            self.current_session.status = RunStatus.PAUSED
            self._stop_playback()

    async def resume(self) -> None:
        """Resume a paused run."""
        if self.current_session and self.current_session.status == RunStatus.PAUSED:
            await self.start_playback()

    async def step_one(self) -> Optional[TelemetryFrame]:
        """Execute a single step (manual stepping while paused or created)."""
        if self.current_session is None:
            return None
        if self.current_session.status not in (
            RunStatus.CREATED,
            RunStatus.PAUSED,
        ):
            return None

        if self.current_session.status == RunStatus.CREATED:
            self.current_session.status = RunStatus.PAUSED

        frame = self.current_session.step_once()

        # Broadcast via WebSocket
        if self._broadcast_callback is not None:
            await self._broadcast_callback(self.current_session.run_id, frame)

        return frame

    async def stop(self) -> None:
        """Stop the current run."""
        self._stop_playback()
        if self.current_session and self.current_session.status in (
            RunStatus.RUNNING,
            RunStatus.PAUSED,
            RunStatus.CREATED,
        ):
            self.current_session.status = RunStatus.STOPPED

    async def reset(self) -> Optional[RunSummary]:
        """Reset the current run to step 0."""
        self._stop_playback()
        if self.current_session is not None:
            summary = self.current_session.reset()
            return summary
        return None

    def set_speed(self, hz: float) -> None:
        """Change the playback speed."""
        if self.current_session is not None:
            self.current_session.step_rate_hz = max(0.1, min(hz, 100.0))
