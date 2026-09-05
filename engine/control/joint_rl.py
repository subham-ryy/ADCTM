"""
Joint Reinforcement Learning Controller for Data Center Digital Twin.

Jointly controls:
1. Cooling allocation across N zones (continuous Box actions in [0, 1]).
2. Workload placement / migration across N zones (continuous preference logits,
   decoded via softmax target allocation with rate limiting, capacity constraints,
   and deadband-gated no-ops).

Guarded by the deterministic safety shield in the executed action path.
"""

from __future__ import annotations

from dataclasses import dataclass
import time
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import gymnasium as gym
from gymnasium import spaces
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback

from engine.physics.thermal_model import ThermalConfig, ThermalModel
from engine.env import DataCenterEnv
from engine.safety.safety_shield import apply_safety_shield

# ---------------------------------------------------------------------------
# Constants and Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKPOINTS_DIR = REPO_ROOT / "models" / "checkpoints"
CHECKPOINT_PATH = CHECKPOINTS_DIR / "joint_rl_v2.zip"   # simulator-v2 checkpoint; v1 preserved at joint_rl.zip

# Disjoint deterministic seed groups for training and validation only.
# Final test seeds are isolated in benchmarks/final_test_config_v2.json (v2)
# Old v1 final seeds [301-305] are now audit seeds — do NOT use for training or validation.
TRAIN_SEEDS = [101, 102, 103, 104]
VALIDATION_SEEDS = [201, 202, 203, 204]


@dataclass
class JointRewardConfig:
    """Configurable weights and thresholds for the decomposed Joint RL reward function."""
    w_op: float = 10.0
    w_emerg: float = 20.0
    w_energy: float = 4.0
    w_drift: float = 0.02
    drift_temp_low: float = 18.0
    drift_temp_high: float = 27.0
    w_jitter: float = 0.05
    w_mig: float = 1.0
    w_cap: float = 5.0
    discrepancy_penalty_coef: float = 2.0



# ---------------------------------------------------------------------------
# Continuous Action Decoder
# ---------------------------------------------------------------------------
class JointActionDecoder:
    """
    Decodes a fixed-size continuous Box action space of shape (2N,) into:
    - per-zone cooling commands in [0, cooling_capacity]
    - explicit workload migration events (from_zone, to_zone, amount)

    Avoids discontinuous rounded scalar selectors. Preserves total workload,
    respects per-zone capacity [0, 1], enforces per-step migration limits,
    and supports genuine no-migration outcomes via a deadband.
    """

    def __init__(
        self,
        num_zones: int = 5,
        max_migration_amount: float = 0.05,
        deadband: float = 0.01,
        temperature: float = 1.0,
    ) -> None:
        self.num_zones = num_zones
        self.max_migration_amount = max_migration_amount
        self.deadband = deadband
        self.temperature = temperature

    def decode(
        self,
        raw_action: np.ndarray,
        current_workloads: np.ndarray,
        cooling_capacity: np.ndarray,
    ) -> Dict[str, Any]:
        """Decode raw continuous Box action array of shape (2N,)."""
        N = self.num_zones
        raw = np.asarray(raw_action, dtype=np.float64).flatten()

        # 1. Cooling: first N values in [-1, 1] mapped to [0, 1], then clamped to capacity
        cooling_raw = raw[:N]
        cooling_proposed = np.clip((cooling_raw + 1.0) / 2.0, 0.0, 1.0)
        cooling_proposed = np.minimum(cooling_proposed, cooling_capacity)

        # 2. Workload: remaining N values in [-1, 1] interpreted as preference logits
        workload_logits = raw[N : 2 * N]

        # Softmax allocation
        exp_logits = np.exp((workload_logits - np.max(workload_logits)) / max(self.temperature, 1e-4))
        target_fractions = exp_logits / np.sum(exp_logits)

        total_workload = float(np.sum(current_workloads))
        target_workloads = target_fractions * total_workload

        # Zone deltas: target - current
        # Positive delta = wants more workload (destination candidate)
        # Negative delta = wants less workload (source candidate)
        deltas = target_workloads - current_workloads

        source_zone = int(np.argmin(deltas))
        dest_zone = int(np.argmax(deltas))

        excess_source = -deltas[source_zone]
        deficit_dest = deltas[dest_zone]

        desired_transfer = min(excess_source, deficit_dest)

        # Check deadband and genuine no-migration condition
        if (
            source_zone == dest_zone
            or desired_transfer < self.deadband
            or excess_source <= 0.0
            or deficit_dest <= 0.0
        ):
            from_zone = 0
            to_zone = 0
            amount = 0.0
            move_fraction = 0.0
        else:
            from_zone = source_zone
            to_zone = dest_zone
            # Rate limit migration amount
            amount = min(desired_transfer, self.max_migration_amount)
            # Physical capacity boundaries: do not take source < 0 or dest > 1.0
            amount = min(amount, current_workloads[from_zone])
            amount = min(amount, 1.0 - current_workloads[to_zone])
            amount = max(amount, 0.0)

            # Move fraction of source zone workload
            if current_workloads[from_zone] > 1e-6:
                move_fraction = float(amount / current_workloads[from_zone])
            else:
                move_fraction = 0.0

        return {
            "cooling": cooling_proposed,
            "from_zone": from_zone,
            "to_zone": to_zone,
            "amount": float(amount),
            "move_fraction": float(move_fraction),
            "target_fractions": target_fractions,
            "deltas": deltas,
        }


# ---------------------------------------------------------------------------
# Joint RL Environment Wrapper
# ---------------------------------------------------------------------------
class JointRLWrapper(gym.Wrapper):
    """
    Gymnasium wrapper providing the 2N continuous action space, safety shield
    integration, decomposed reward calculation, and training domain randomization.
    """

    def __init__(
        self,
        env: DataCenterEnv,
        apply_shield: bool = True,
        training: bool = False,
        discrepancy_penalty_coef: float = 2.0,
        max_migration_amount: float = 0.05,
        deadband: float = 0.01,
        reward_config: Optional[JointRewardConfig] = None,
    ) -> None:
        super().__init__(env)
        self.apply_shield = apply_shield
        self.training = training
        self.reward_config = reward_config or JointRewardConfig(discrepancy_penalty_coef=discrepancy_penalty_coef)
        self.discrepancy_penalty_coef = self.reward_config.discrepancy_penalty_coef

        N = self.unwrapped.cfg.num_zones
        self.num_zones = N
        self.decoder = JointActionDecoder(
            num_zones=N,
            max_migration_amount=max_migration_amount,
            deadband=deadband,
        )

        # Fixed continuous Box action space: N cooling + N workload placement
        self.action_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(2 * N,),
            dtype=np.float32,
        )

        # Tracking state
        self._prev_applied_cooling = np.zeros(N, dtype=np.float64)
        self._total_migrations_in_episode = 0
        self._total_migration_volume = 0.0
        self._shield_overrides_in_episode = 0
        self._shield_rejections_in_episode = 0

        # Domain randomization parameters (active when training=True)
        self._failure_zone: Optional[int] = None
        self._failure_step: Optional[int] = None
        self._failure_capacity: float = 1.0

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, dict[str, Any]]:
        self._total_migrations_in_episode = 0
        self._total_migration_volume = 0.0
        self._shield_overrides_in_episode = 0
        self._shield_rejections_in_episode = 0

        # Setup training randomization
        if self.training:
            rng = np.random.default_rng(seed)
            # Randomized initial conditions
            init_temps = rng.uniform(20.0, 24.0, size=self.num_zones).tolist()
            # Dirichlet distribution for workloads to maintain reasonable total load
            workload_shares = rng.dirichlet(np.ones(self.num_zones))
            init_workloads = (workload_shares * 1.8).tolist()  # mean total ~1.8
            ambient = float(rng.uniform(25.0, 36.0))

            opts = dict(options) if options else {}
            opts.setdefault("initial_temperatures", init_temps)
            opts.setdefault("initial_workloads", init_workloads)
            opts.setdefault("ambient_temp", ambient)

            # Failure injection randomization (75% probability during training)
            if rng.random() < 0.75:
                self._failure_zone = int(rng.integers(0, self.num_zones))
                self._failure_step = int(rng.integers(20, 100))
                self._failure_capacity = float(rng.uniform(0.40, 0.70))
            else:
                self._failure_zone = None
                self._failure_step = None
                self._failure_capacity = 1.0

            obs, info = self.env.reset(seed=seed, options=opts)
        else:
            # Check options for explicit failure injection or preserve pre-configured attributes
            if options and "failure_injection" in options:
                fi = options["failure_injection"]
                self._failure_zone = fi["zone_index"]
                self._failure_step = fi["trigger_step"]
                self._failure_capacity = fi["reduced_capacity"]
            # If not configured before reset, keep defaults
            obs, info = self.env.reset(seed=seed, options=options)

        self._prev_applied_cooling = np.zeros(self.num_zones, dtype=np.float64)
        return obs, info

    def step(self, action: np.ndarray) -> Tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        raw_action = np.asarray(action, dtype=np.float64).flatten()
        cfg = self.unwrapped.cfg
        current_state = self.unwrapped.get_state_dict()
        t = current_state["time_step"]

        # Apply failure injection when triggered
        if self._failure_zone is not None and self._failure_step is not None:
            if t >= self._failure_step:
                current_state["cooling_capacity"][self._failure_zone] = self._failure_capacity
                self.unwrapped._cooling_capacity[self._failure_zone] = self._failure_capacity

        current_workloads = np.array(current_state["workloads"], dtype=np.float64)
        cooling_capacity = np.array(current_state["cooling_capacity"], dtype=np.float64)

        # 1. Decode continuous action into proposed cooling and workload migration
        decoded = self.decoder.decode(raw_action, current_workloads, cooling_capacity)
        proposed_cooling = decoded["cooling"].copy()
        from_zone = decoded["from_zone"]
        to_zone = decoded["to_zone"]
        amount = decoded["amount"]
        move_fraction = decoded["move_fraction"]

        proposed_action_dict = {
            "cooling": proposed_cooling,
            "from_zone": from_zone,
            "to_zone": to_zone,
            "move_fraction": move_fraction,
        }

        # 2. Apply deterministic safety shield
        if self.apply_shield:
            corrected_action, shield_info = apply_safety_shield(
                proposed_action_dict,
                current_state,
                cfg,
                bypass=False,
            )
            applied_cooling = np.array(corrected_action["cooling"], dtype=np.float64)
            # If shield rejected the move, nullify migration
            if shield_info["move_rejected"]:
                executed_amount = 0.0
                executed_from = 0
                executed_to = 0
                self._shield_rejections_in_episode += 1
            else:
                executed_amount = amount
                executed_from = from_zone
                executed_to = to_zone

            if shield_info["corrections_applied"] > 0:
                self._shield_overrides_in_episode += 1
        else:
            applied_cooling = proposed_cooling.copy()
            executed_amount = amount
            executed_from = from_zone
            executed_to = to_zone
            shield_info = {
                "zone_corrections": ["none"] * self.num_zones,
                "move_rejected": False,
                "corrections_applied": 0,
            }

        # 3. Apply workload migration to simulator state (strictly conserving workload)
        if executed_from != executed_to and executed_amount > 1e-6:
            self.unwrapped._workloads[executed_from] -= executed_amount
            self.unwrapped._workloads[executed_to] += executed_amount
            # Numerical clamp for defense
            self.unwrapped._workloads = np.clip(self.unwrapped._workloads, 0.0, 1.0)
            self._total_migrations_in_episode += 1
            self._total_migration_volume += executed_amount

        # 4. Thermal update with applied cooling
        updated_temps = self.unwrapped.thermal.step_temperatures(
            self.unwrapped._temperatures,
            self.unwrapped._workloads,
            applied_cooling,
            self.unwrapped._ambient_temp,
            self.unwrapped._rng,
        )
        self.unwrapped._temperatures = updated_temps

        # 5. Power accounting
        power = self.unwrapped.thermal.compute_power(
            self.unwrapped._workloads, applied_cooling
        )
        self.unwrapped._cumulative_it_power += power["it_power_kw"]
        self.unwrapped._cumulative_cooling_power += power["cooling_power_kw"]
        self.unwrapped._cumulative_overhead += power["overhead_kw"]

        # 6. Decomposed reward calculation
        rc = self.reward_config

        # Term 1: Operational temperature penalty (> 35C)
        op_excess = np.maximum(updated_temps - cfg.operational_max_temperature_c, 0.0)
        p_op = float(rc.w_op * np.sum(op_excess))

        # Term 2: Emergency temperature penalty (> 40C, massive > 45C)
        emerg_excess = np.maximum(updated_temps - 40.0, 0.0)
        p_emerg = float(rc.w_emerg * np.sum(np.exp(np.clip(emerg_excess / 2.0, 0.0, 5.0)) - 1.0))
        if np.any(updated_temps > cfg.emergency_max_temperature_c):
            p_emerg += 100.0  # Massive penalty for hard hardware boundary violation

        # Term 3: Cooling energy cost
        p_energy = float(rc.w_energy * np.sum(applied_cooling))

        # Term 4: Target temperature drift from configured band
        below = np.maximum(rc.drift_temp_low - updated_temps, 0.0)
        above = np.maximum(updated_temps - rc.drift_temp_high, 0.0)
        p_drift = float(rc.w_drift * np.sum(below + above))

        # Term 5: Cooling action jitter
        p_jitter = float(rc.w_jitter * np.sum((applied_cooling - self._prev_applied_cooling) ** 2))
        if np.any(updated_temps > cfg.critical_temp):
            p_jitter = 0.0  # Emergency override

        # Term 6: Workload migration cost
        p_mig = float(rc.w_mig * executed_amount)

        # Term 7: Capacity imbalance penalty (near-saturation > 0.95)
        cap_excess = np.maximum(self.unwrapped._workloads - 0.95, 0.0)
        p_cap = float(rc.w_cap * np.sum(cap_excess ** 2))

        # Term 8: Unserved workload penalty (0 because we conserve 100%)
        p_shed = 0.0

        # Term 9: Safety shield discrepancy penalty
        cool_disc = float(np.sum((proposed_cooling - applied_cooling) ** 2))
        rejection_penalty = 1.0 if shield_info.get("move_rejected", False) else 0.0
        p_disc = float(self.discrepancy_penalty_coef * (cool_disc + rejection_penalty))

        total_reward = -(
            p_op
            + p_emerg
            + p_energy
            + p_drift
            + p_jitter
            + p_mig
            + p_cap
            + p_shed
            + p_disc
        )

        # 7. Update internal state
        self._prev_applied_cooling = applied_cooling.copy()
        self.unwrapped._prev_cooling = applied_cooling.copy()
        self.unwrapped._time_step += 1

        terminated = False
        truncated = self.unwrapped._time_step >= cfg.episode_length

        obs = self.unwrapped._get_obs()
        info = self.unwrapped._get_info(power=power)

        # Detailed logging
        info["applied_cooling"] = applied_cooling.tolist()
        info["proposed_cooling"] = proposed_cooling.tolist()
        info["proposed_migration"] = {
            "from_zone": from_zone,
            "to_zone": to_zone,
            "amount": amount,
            "move_fraction": move_fraction,
        }
        info["executed_migration"] = {
            "from_zone": executed_from,
            "to_zone": executed_to,
            "amount": executed_amount,
            "move_fraction": move_fraction if executed_amount > 1e-6 else 0.0,
        }
        info["shield_info"] = shield_info
        info["reward_components"] = {
            "p_op": p_op,
            "p_emerg": p_emerg,
            "p_energy": p_energy,
            "p_drift": p_drift,
            "p_jitter": p_jitter,
            "p_mig": p_mig,
            "p_cap": p_cap,
            "p_shed": p_shed,
            "p_disc": p_disc,
            "total_reward": total_reward,
        }
        info["episode_migrations_count"] = self._total_migrations_in_episode
        info["episode_migration_volume"] = self._total_migration_volume
        info["episode_shield_overrides"] = self._shield_overrides_in_episode
        info["episode_shield_rejections"] = self._shield_rejections_in_episode

        return obs, float(total_reward), terminated, truncated, info


# ---------------------------------------------------------------------------
# Training Pipeline
# ---------------------------------------------------------------------------
def make_env(
    seed: int,
    cfg: Optional[ThermalConfig] = None,
    apply_shield: bool = True,
    training: bool = True,
    reward_config: Optional[JointRewardConfig] = None,
) -> gym.Env:
    """Create a wrapped Joint RL environment."""
    base_env = DataCenterEnv(config=cfg)
    return JointRLWrapper(
        base_env,
        apply_shield=apply_shield,
        training=training,
        reward_config=reward_config,
    )


def train(
    total_timesteps: int = 150_000,
    checkpoint_path: Optional[Path] = None,
    base_seed: int = 42,
    cfg: Optional[ThermalConfig] = None,
    reward_config: Optional[JointRewardConfig] = None,
    verbose: int = 1,
) -> PPO:
    """Train Joint RL PPO policy across training seeds and select best checkpoint on validation seeds."""
    target_path = Path(checkpoint_path) if checkpoint_path else CHECKPOINT_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if cfg is None:
        cfg = ThermalConfig.from_config_dir()

    # Create training environment with domain & failure randomization
    train_env = make_env(
        seed=base_seed,
        cfg=cfg,
        apply_shield=True,
        training=True,
        reward_config=reward_config,
    )

    model = PPO(
        "MlpPolicy",
        train_env,
        learning_rate=3e-4,
        n_steps=1024,
        batch_size=64,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,
        verbose=verbose,
        seed=base_seed,
    )

    # Train in chunks and evaluate on validation seeds
    chunk_size = 30_000
    n_chunks = max(1, total_timesteps // chunk_size)

    best_val_score = float("inf")
    best_model_path = target_path

    for chunk in range(n_chunks):
        model.learn(total_timesteps=chunk_size, reset_num_timesteps=False)

        # Validation check strictly on disjoint validation seeds
        val_eval = evaluate_multi_seed(
            model,
            "cooling_failure",
            seeds=VALIDATION_SEEDS,
            cfg=cfg,
            shield_active=True,
        )
        val_pue = val_eval["pue_mean"]
        val_emerg = val_eval["emergency_violations_mean"]
        val_op = val_eval["operational_violations_mean"]
        val_max_temp = val_eval["max_temp_mean"]
        val_override_rate = val_eval["shield_override_rate_mean"]

        # Lexicographic selection:
        # 1. Zero emergency violations
        # 2. Zero operational violations
        # 3. Thermal robustness margin: max_temp <= 34.0 C (1.0 C buffer below 35.0 C SLA boundary)
        # 4. Shield override rate <= 10%
        # 5. Lowest PUE
        temp_excess_34 = max(val_max_temp - 34.0, 0.0)
        override_excess = max(val_override_rate - 0.10, 0.0)
        val_score = (
            val_emerg * 10000.0
            + val_op * 100.0
            + temp_excess_34 * 50.0
            + override_excess * 20.0
            + val_pue
        )

        if verbose >= 1:
            print(
                f"[Chunk {chunk + 1}/{n_chunks}] Val Score: {val_score:.4f} "
                f"(PUE: {val_pue:.4f}, MaxT: {val_max_temp:.2f}C, Emerg: {val_emerg:.1f}, Op: {val_op:.1f}, "
                f"OverrideRate: {val_override_rate:.1%}, Migrations: {val_eval['migration_count_mean']:.1f})"
            )

        if val_score < best_val_score:
            best_val_score = val_score
            model.save(str(target_path))


    # Load best checkpoint
    model = load_model(target_path)
    return model


def load_model(checkpoint_path: Path | str = CHECKPOINT_PATH) -> PPO:
    """Load pre-trained Joint RL checkpoint."""
    p = Path(checkpoint_path)
    if not p.exists():
        raise FileNotFoundError(f"No joint RL model found at '{p}'.")
    return PPO.load(str(p))


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate_episode(
    model: PPO,
    env: gym.Env,
    seed: int,
) -> Dict[str, Any]:
    """Evaluate one full deterministic episode and report all metrics."""
    obs, info = env.reset(seed=seed)
    done = False

    temperatures_all: List[np.ndarray] = []
    applied_coolings_all: List[np.ndarray] = []
    proposed_coolings_all: List[np.ndarray] = []
    migrations: List[Dict[str, Any]] = []

    operational_violations = 0
    operational_degree_minutes = 0.0
    emergency_violations = 0
    shield_overrides = 0
    move_rejections = 0

    cfg = env.unwrapped.cfg

    inference_latencies: List[float] = []
    step_latencies: List[float] = []

    while not done:
        t0 = time.perf_counter()
        action, _ = model.predict(obs, deterministic=True)
        t_infer = time.perf_counter() - t0
        inference_latencies.append(t_infer * 1000.0)

        t1 = time.perf_counter()
        obs, reward, terminated, truncated, step_info = env.step(action)
        t_step = time.perf_counter() - t1
        step_latencies.append(t_step * 1000.0)

        done = terminated or truncated

        curr_temps = env.unwrapped._temperatures.copy()
        temperatures_all.append(curr_temps)

        applied_cool = np.array(step_info["applied_cooling"], dtype=np.float64)
        proposed_cool = np.array(step_info["proposed_cooling"], dtype=np.float64)
        applied_coolings_all.append(applied_cool)
        proposed_coolings_all.append(proposed_cool)

        # Workload migration tracking
        mig_event = step_info["executed_migration"]
        if mig_event["amount"] > 1e-6:
            migrations.append(mig_event)

        # SLA tracking
        op_excess = np.maximum(curr_temps - cfg.operational_max_temperature_c, 0.0)
        if np.any(op_excess > 0.0):
            operational_violations += 1
            operational_degree_minutes += float(np.sum(op_excess) * 5.0)

        if np.any(curr_temps > cfg.emergency_max_temperature_c):
            emergency_violations += 1

        if step_info["shield_info"]["corrections_applied"] > 0:
            shield_overrides += 1
        if step_info["shield_info"]["move_rejected"]:
            move_rejections += 1

    steps = len(temperatures_all)
    temps_arr = np.array(temperatures_all)
    applied_arr = np.array(applied_coolings_all)
    proposed_arr = np.array(proposed_coolings_all)

    # Power & Energy
    it_kwh = env.unwrapped._cumulative_it_power * (5.0 / 60.0)
    cooling_kwh = env.unwrapped._cumulative_cooling_power * (5.0 / 60.0)
    overhead_kwh = env.unwrapped._cumulative_overhead * (5.0 / 60.0)
    total_facility_kwh = it_kwh + cooling_kwh + overhead_kwh
    episode_pue = total_facility_kwh / max(it_kwh, 1e-6)

    sla_uptime_pct = (1.0 - (operational_violations / steps)) * 100.0
    operational_duration_m = operational_violations * 5.0
    max_temp = float(np.max(temps_arr))

    total_mig_volume = sum(m["amount"] for m in migrations)
    max_discrepancy = float(np.max(np.abs(proposed_arr - applied_arr)))

    return {
        "seed": seed,
        "steps": steps,
        "pue": float(episode_pue),
        "total_facility_energy_kwh": float(total_facility_kwh),
        "cooling_energy_kwh": float(cooling_kwh),
        "it_energy_kwh": float(it_kwh),
        "overhead_energy_kwh": float(overhead_kwh),
        "max_temp": max_temp,
        "sla_uptime_pct": float(sla_uptime_pct),
        "operational_violations": operational_violations,
        "operational_duration_minutes": operational_duration_m,
        "operational_degree_minutes": operational_degree_minutes,
        "emergency_violations": emergency_violations,
        "workload_served_pct": 100.0,
        "workload_shed_pct": 0.0,
        "migration_count": len(migrations),
        "total_migration_amount": float(total_mig_volume),
        "move_rejection_count": move_rejections,
        "shield_override_rate": float(shield_overrides / steps),
        "mean_proposed_cooling": float(np.mean(proposed_arr)),
        "mean_applied_cooling": float(np.mean(applied_arr)),
        "std_cooling": float(np.std(applied_arr)),
        "max_action_discrepancy": max_discrepancy,
        "inference_latency_ms": float(np.mean(inference_latencies)),
        "step_latency_ms": float(np.mean(step_latencies)),
    }


def evaluate_multi_seed(
    model: PPO,
    scenario_name: str = "cooling_failure",
    seeds: Optional[List[int]] = None,
    cfg: Optional[ThermalConfig] = None,
    shield_active: bool = True,
    failure_zone: int = 2,
    failure_step: int = 50,
    failure_capacity: float = 0.60,
) -> Dict[str, Any]:
    """Run multi-seed evaluation across specified seeds and compute mean +/- std."""
    if seeds is None:
        seeds = VALIDATION_SEEDS
    from engine.scenarios.scenario_env import get_reset_options

    results: List[Dict[str, Any]] = []

    for s in seeds:
        base_env = DataCenterEnv(config=cfg)
        options = get_reset_options(scenario_name, cfg)

        wrapped_env = JointRLWrapper(
            base_env,
            apply_shield=shield_active,
            training=False,
        )

        if scenario_name == "cooling_failure":
            wrapped_env._failure_zone = failure_zone
            wrapped_env._failure_step = failure_step
            wrapped_env._failure_capacity = failure_capacity

        res = evaluate_episode(model, wrapped_env, seed=s)
        results.append(res)

    # Compute aggregates
    keys_to_aggregate = [
        "pue",
        "total_facility_energy_kwh",
        "cooling_energy_kwh",
        "it_energy_kwh",
        "overhead_energy_kwh",
        "max_temp",
        "sla_uptime_pct",
        "operational_violations",
        "operational_duration_minutes",
        "operational_degree_minutes",
        "emergency_violations",
        "workload_served_pct",
        "workload_shed_pct",
        "migration_count",
        "total_migration_amount",
        "move_rejection_count",
        "shield_override_rate",
        "mean_proposed_cooling",
        "mean_applied_cooling",
        "std_cooling",
        "max_action_discrepancy",
        "inference_latency_ms",
        "step_latency_ms",
    ]

    agg: Dict[str, Any] = {
        "scenario": scenario_name,
        "seeds": seeds,
        "per_seed_results": results,
    }

    for k in keys_to_aggregate:
        vals = [r[k] for r in results]
        agg[f"{k}_mean"] = float(np.mean(vals))
        agg[f"{k}_std"] = float(np.std(vals))

    return agg
