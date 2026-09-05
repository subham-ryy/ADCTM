"""
Cooling-only RL controller — Phase 3.

Design
------
The joint DataCenterEnv has an action space of shape (N+3,): N cooling dims
plus 3 workload-move dims.  For the cooling-only baseline the policy should
never learn over the workload-move dims.

We implement this at the *wrapper* level with a Gymnasium ObservationWrapper +
ActionWrapper combination (CoolingOnlyWrapper).  The wrapper:

  1. Exposes a reduced action space of shape (N,) — cooling only, in [-1, 1].
  2. Internally appends fixed no-op workload-move dims before calling env.step().
  3. Exposes a reduced observation space dropping the time_step_norm scalar
     (kept for clarity) — in fact we keep the full observation since it's all
     valid signal for cooling decisions too.

This means PPO trains over an honest (N,)-dimensional action space, not a
(N+3,)-dimensional one where 3 dims are always ignored.

Scenario randomisation during training
---------------------------------------
Training rotates over all four scenarios (normal, peak_load, ambient_heat,
cooling_failure) by wrapping the env in a ScenarioRandomisationWrapper that
picks a new scenario + seed at every episode reset.  This prevents overfitting
to one scenario.

Safety shield
--------------
During training rollouts the shield is OFF by default (bypass=True in the
callback), matching the AGENTS.md allowance for raw-policy diagnostics.
During evaluation (evaluate_policy, checkpoint-selection) the shield is ON.

The EVAL_SEEDS list is used for all multi-seed evaluation and benchmark runs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import numpy as np
import gymnasium as gym
from gymnasium import spaces

from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig
from engine.safety.safety_shield import apply_safety_shield, decode_raw_action
from engine.scenarios.scenario_env import get_reset_options, apply_failure_injection, load_scenarios

# ---------------------------------------------------------------------------
# Deterministic Seed Groups (strictly separated for scientific validity)
# ---------------------------------------------------------------------------
# Training seeds: used for PPO environment vector rollouts
TRAIN_SEEDS = [101, 102, 103, 104]
# Validation seeds: used for intermediate evaluation callback and model selection
VALIDATION_SEEDS = [201, 202, 203, 204]
# Held-out test seeds: untouched during training and tuning; used solely for final benchmarking
TEST_SEEDS = [42, 123, 456, 789, 1337]

# Backwards compatibility alias
EVAL_SEEDS = TEST_SEEDS

# ---------------------------------------------------------------------------
# Checkpoint Paths
# ---------------------------------------------------------------------------
_MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
CHECKPOINTS_DIR = _MODELS_DIR / "checkpoints"
CHECKPOINT_PATH = CHECKPOINTS_DIR / "cooling_only_rl.zip"
LEGACY_CHECKPOINT_PATH = _MODELS_DIR / "cooling_only_rl.zip"

ALL_SCENARIOS = ["normal", "peak_load", "ambient_heat", "cooling_failure"]


# ---------------------------------------------------------------------------
# Wrapper 1: disable workload-move by projecting to reduced action space
# ---------------------------------------------------------------------------

class CoolingOnlyWrapper(gym.Wrapper):
    """Exposes only the N cooling dims; workload-move is fixed to no-op.

    Action space: Box(-1, 1, shape=(N,))
    Observation space: unchanged from base env (all state is valid signal).

    When apply_shield=True, actions are passed through apply_safety_shield
    before being executed by the simulator.
    If discrepancy_penalty_coef > 0, the reward is penalized by the squared
    discrepancy between proposed and shield-executed actions so the policy
    learns not to rely on the shield as a crutch.
    """

    def __init__(
        self,
        env: gym.Env,
        apply_shield: bool = True,
        discrepancy_penalty_coef: float = 0.0,
    ):
        super().__init__(env)
        dc_env = self._get_base_dc_env()
        N = dc_env.cfg.num_zones
        self._N = N
        self.apply_shield = apply_shield
        self.discrepancy_penalty_coef = float(discrepancy_penalty_coef)
        # Override action space to cooling-only
        self.action_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(N,),
            dtype=np.float32,
        )

    def _get_base_dc_env(self) -> DataCenterEnv:
        e = self.env
        while e is not None:
            if isinstance(e, DataCenterEnv):
                return e
            e = getattr(e, "env", None)
        raise RuntimeError("No DataCenterEnv found in wrapper chain")

    def step(self, action: np.ndarray):
        N = self._N
        action = np.asarray(action, dtype=np.float32).flatten()
        # Decode cooling from [-1, 1] to [0, 1]
        proposed_cooling = np.clip((action + 1.0) / 2.0, 0.0, 1.0)

        dc_env = self._get_base_dc_env()
        shield_info = None
        executed_cooling = proposed_cooling.copy()
        if self.apply_shield:
            state = dc_env.get_state_dict()
            proposed = {
                "cooling": proposed_cooling,
                "from_zone": 0,
                "to_zone": 0,
                "move_fraction": 0.0,
            }
            corrected, shield_info = apply_safety_shield(proposed, state, dc_env.cfg)
            executed_cooling = corrected["cooling"]

        # Build full (N+3,) action with no-op workload dims
        # No-op: from_zone == to_zone (both map to zone 0), amount = -1 (-> 0)
        full_action = np.zeros(N + 3, dtype=np.float32)
        full_action[:N] = (executed_cooling * 2.0 - 1.0).astype(np.float32)
        full_action[N] = -1.0      # from_zone -> 0
        full_action[N + 1] = -1.0  # to_zone   -> 0
        full_action[N + 2] = -1.0  # amount    -> 0
        obs, reward, terminated, truncated, info = self.env.step(full_action)

        # Discrepancy penalty (steers policy towards autonomy without shield overrides)
        if self.apply_shield and self.discrepancy_penalty_coef > 0.0:
            diff_sq = np.sum((proposed_cooling - executed_cooling) ** 2)
            penalty = float(self.discrepancy_penalty_coef * diff_sq)
            reward = float(reward - penalty)
            info["discrepancy_penalty"] = penalty

        info["proposed_cooling"] = proposed_cooling.copy()
        info["applied_cooling"] = executed_cooling.copy()
        info["action_discrepancy"] = float(np.max(np.abs(proposed_cooling - executed_cooling)))

        if shield_info is not None:
            info["shield_info"] = shield_info

        return obs, reward, terminated, truncated, info

    def reset(self, **kwargs):
        return self.env.reset(**kwargs)


# ---------------------------------------------------------------------------
# Wrapper 2: scenario randomisation — new scenario + seed every episode
# ---------------------------------------------------------------------------

class ScenarioRandomisationWrapper(gym.Wrapper):
    """Picks a random scenario and seed at each reset.

    During training this gives the policy diverse experience across all four
    scenarios so it doesn't overfit to a single one.
    """

    def __init__(
        self,
        env: gym.Env,
        cfg: Optional[ThermalConfig] = None,
        scenarios: list[str] | None = None,
        base_seed: int = 0,
    ):
        super().__init__(env)
        # Walk the wrapper chain to find the DataCenterEnv's cfg if not supplied
        self.cfg = cfg or self._find_cfg(env)
        self._scenarios = scenarios or ALL_SCENARIOS
        self._base_seed = base_seed
        self._episode_count = 0
        self._current_scenario = "normal"
        self._rng = np.random.default_rng(base_seed)

    @staticmethod
    def _find_cfg(env: gym.Env) -> ThermalConfig:
        """Walk the wrapper chain until we find a ThermalConfig."""
        e = env
        while e is not None:
            if hasattr(e, "cfg") and isinstance(getattr(e, "cfg", None), ThermalConfig):
                return e.cfg
            e = getattr(e, "env", None)
        return ThermalConfig()

    def _get_base_dc_env(self) -> DataCenterEnv:
        """Walk the wrapper chain to find the underlying DataCenterEnv."""
        e = self.env
        while e is not None:
            if isinstance(e, DataCenterEnv):
                return e
            e = getattr(e, "env", None)
        raise RuntimeError("No DataCenterEnv found in wrapper chain")

    def reset(self, **kwargs):
        # Pick a new scenario round-robin with random seed
        idx = self._episode_count % len(self._scenarios)
        self._current_scenario = self._scenarios[idx]
        self._episode_count += 1

        # Consume the caller-supplied seed (SB3 VecEnv may pass one);
        # we generate our own seed from the master RNG for diversity.
        kwargs.pop("seed", None)
        ep_seed = int(self._rng.integers(0, 2**31))
        options = get_reset_options(self._current_scenario, self.cfg)
        # Merge any caller-supplied options
        caller_options = kwargs.pop("options", {}) or {}
        options.update(caller_options)
        return self.env.reset(seed=ep_seed, options=options, **kwargs)

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        # Apply mid-episode scenario effects (failure injection, etc.)
        try:
            dc_env = self._get_base_dc_env()
            current_step = dc_env._time_step - 1
            apply_failure_injection(dc_env, self._current_scenario, current_step)
        except RuntimeError:
            pass
        info["scenario"] = self._current_scenario
        return obs, reward, terminated, truncated, info


# ---------------------------------------------------------------------------
# Training entry point
# ---------------------------------------------------------------------------

def train(
    total_timesteps: int = 150_000,
    checkpoint_path: Path | str = CHECKPOINT_PATH,
    base_seed: int = 42,
    cfg: Optional[ThermalConfig] = None,
    verbose: int = 1,
) -> Any:
    """Train the cooling-only PPO policy with safety shield active.

    Parameters
    ----------
    total_timesteps : total env steps for training
    checkpoint_path : where to save the final .zip checkpoint
    base_seed       : master RNG seed for training env rollouts
    cfg             : ThermalConfig (defaults to standard 5-zone config)
    verbose         : SB3 verbosity (0=silent, 1=progress, 2=debug)

    Returns
    -------
    model : trained PPO model
    """
    from stable_baselines3 import PPO
    from stable_baselines3.common.env_util import make_vec_env
    from stable_baselines3.common.callbacks import EvalCallback
    from stable_baselines3.common.monitor import Monitor

    cfg = cfg or ThermalConfig()
    checkpoint_path = Path(checkpoint_path)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

    # --- Training env: scenario-randomised, cooling-only wrapper WITH safety shield active ---
    # Per AGENTS.md, production checkpoints must enforce the safety shield in the executed path.
    # Discrepancy penalty prevents policy complacency ("shield crutching") by directly
    # penalizing the difference between what the policy proposed and what the shield executed.
    def make_train_env():
        base = DataCenterEnv(config=cfg)
        base = CoolingOnlyWrapper(base, apply_shield=True, discrepancy_penalty_coef=1.0)
        base = ScenarioRandomisationWrapper(base, cfg=cfg, base_seed=base_seed)
        return Monitor(base)

    # --- Eval env: fixed cooling_failure scenario, shield ON, evaluated on validation seeds ---
    def make_eval_env():
        base = DataCenterEnv(config=cfg)
        wrapped = CoolingOnlyWrapper(base, apply_shield=True)
        options = get_reset_options("cooling_failure", cfg)

        class FixedScenarioWrapper(gym.Wrapper):
            def reset(self, **kwargs):
                kwargs.setdefault("options", {})
                kwargs["options"].update(options)
                return self.env.reset(**kwargs)

            def step(self, action):
                obs, reward, terminated, truncated, info = self.env.step(action)
                try:
                    dc_env = self.env._get_base_dc_env()
                    current_step = dc_env._time_step - 1
                    apply_failure_injection(dc_env, "cooling_failure", current_step)
                except Exception:
                    pass
                return obs, reward, terminated, truncated, info

        wrapped = FixedScenarioWrapper(wrapped)
        return Monitor(wrapped)

    n_envs = 4  # 4 vectorised environments for speed and diverse exploration
    train_env = make_vec_env(make_train_env, n_envs=n_envs, seed=base_seed)
    eval_env = make_vec_env(make_eval_env, n_envs=1, seed=VALIDATION_SEEDS[0])

    # --- PPO hyperparameters tuned for this environment ---
    model = PPO(
        "MlpPolicy",
        train_env,
        learning_rate=5e-4,
        n_steps=512,
        batch_size=64,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.005,      # small entropy bonus for exploration
        vf_coef=0.5,
        max_grad_norm=0.5,
        verbose=verbose,
        seed=base_seed,
        tensorboard_log=str(checkpoint_path.parent / "tb_logs"),
        policy_kwargs=dict(net_arch=[128, 128]),
    )

    # EvalCallback evaluates on validation env
    eval_callback = EvalCallback(
        eval_env,
        best_model_save_path=str(checkpoint_path.parent),
        log_path=str(checkpoint_path.parent / "eval_logs"),
        eval_freq=max(4000 // n_envs, 1),
        n_eval_episodes=len(VALIDATION_SEEDS),
        deterministic=True,
        render=False,
        verbose=verbose,
    )

    model.learn(
        total_timesteps=total_timesteps,
        callback=eval_callback,
        reset_num_timesteps=True,
        progress_bar=(verbose > 0),
    )

    # Save final model first
    model.save(str(checkpoint_path))
    if checkpoint_path != LEGACY_CHECKPOINT_PATH:
        model.save(str(LEGACY_CHECKPOINT_PATH))
    if verbose:
        print(f"[Phase3] Saved final trained checkpoint to {checkpoint_path}")

    # Checkpoint selection strictly on VALIDATION_SEEDS (never touching TEST_SEEDS)
    best_path = checkpoint_path.parent / "best_model.zip"
    if best_path.exists():
        try:
            cand_model = PPO.load(str(best_path))
            eval_final = evaluate_multi_seed(model, "cooling_failure", seeds=VALIDATION_SEEDS, cfg=cfg, shield_active=True)
            eval_cand = evaluate_multi_seed(cand_model, "cooling_failure", seeds=VALIDATION_SEEDS, cfg=cfg, shield_active=True)
            if eval_cand["emergency_violations_mean"] == 0 and eval_cand["pue_mean"] < eval_final["pue_mean"]:
                cand_model.save(str(checkpoint_path))
                if checkpoint_path != LEGACY_CHECKPOINT_PATH:
                    cand_model.save(str(LEGACY_CHECKPOINT_PATH))
                model = cand_model
                if verbose:
                    print(f"[Phase3] Validation best checkpoint selected: PUE {eval_cand['pue_mean']:.4f} < {eval_final['pue_mean']:.4f}")
            else:
                if verbose:
                    print(f"[Phase3] Final trained model selected on validation seeds: PUE {eval_final['pue_mean']:.4f} <= {eval_cand['pue_mean']:.4f}")
        except Exception as e:
            if verbose:
                print(f"[Phase3] Candidate comparison on validation seeds skipped: {e}")

    train_env.close()
    eval_env.close()
    return model


# ---------------------------------------------------------------------------
# Load checkpoint
# ---------------------------------------------------------------------------

def load_model(checkpoint_path: Path | str | None = None):
    """Load a saved PPO checkpoint. Checks checkpoints/ first, then legacy root models/."""
    from stable_baselines3 import PPO
    if checkpoint_path is None:
        if CHECKPOINT_PATH.exists():
            resolved = CHECKPOINT_PATH
        elif LEGACY_CHECKPOINT_PATH.exists():
            resolved = LEGACY_CHECKPOINT_PATH
        else:
            raise FileNotFoundError(
                f"Checkpoint not found at {CHECKPOINT_PATH} or {LEGACY_CHECKPOINT_PATH}\n"
                "Run scripts/train_cooling_only.py to train first."
            )
    else:
        resolved = Path(checkpoint_path)
        if not resolved.exists():
            # Fallback to alternate path if relative
            if (CHECKPOINTS_DIR / resolved.name).exists():
                resolved = CHECKPOINTS_DIR / resolved.name
            elif (_MODELS_DIR / resolved.name).exists():
                resolved = _MODELS_DIR / resolved.name
            else:
                raise FileNotFoundError(f"Checkpoint not found: {resolved}")
    return PPO.load(str(resolved))


# ---------------------------------------------------------------------------
# Evaluation with safety shield & comprehensive metrics
# ---------------------------------------------------------------------------

def evaluate_episode(
    model,
    scenario_name: str = "cooling_failure",
    seed: int = 42,
    cfg: Optional[ThermalConfig] = None,
    shield_active: bool = True,
) -> dict[str, Any]:
    """Run one evaluation episode and return complete scientific metrics dict.

    The shield is enforced whenever shield_active=True (default at eval/inference).
    Tracks both operational SLA compliance and emergency safety boundaries separately.
    """
    cfg = cfg or ThermalConfig()
    base_env = DataCenterEnv(config=cfg)
    options = get_reset_options(scenario_name, cfg)
    obs, info = base_env.reset(seed=seed, options=options)

    N = cfg.num_zones
    max_temp = -np.inf
    total_energy = 0.0
    total_cooling_used = 0.0
    total_it_energy = 0.0
    operational_violations = 0
    emergency_violations = 0
    operational_degree_minutes = 0.0
    shield_corrections = 0
    total_workload = 0.0

    all_proposed_cooling: list[np.ndarray] = []
    all_applied_cooling: list[np.ndarray] = []

    terminated = truncated = False
    step = 0

    while not (terminated or truncated):
        # Apply mid-episode scenario effects
        apply_failure_injection(base_env, scenario_name, step)

        # Get cooling-only action from model (obs is same as full env)
        cooling_raw, _ = model.predict(obs, deterministic=True)
        cooling_raw = np.asarray(cooling_raw, dtype=np.float32).flatten()
        proposed_01 = np.clip((cooling_raw + 1.0) / 2.0, 0.0, 1.0)
        all_proposed_cooling.append(proposed_01.copy())

        applied_01 = proposed_01.copy()
        if shield_active:
            state = base_env.get_state_dict()
            proposed = {
                "cooling": proposed_01,
                "from_zone": 0,
                "to_zone": 0,
                "move_fraction": 0.0,
            }
            corrected, shield_info = apply_safety_shield(proposed, state, cfg)
            applied_01 = corrected["cooling"]
            shield_corrections += shield_info["corrections_applied"]

        all_applied_cooling.append(applied_01.copy())

        # Build full env action
        full_action = np.zeros(N + 3, dtype=np.float32)
        full_action[:N] = (applied_01 * 2.0 - 1.0).astype(np.float32)
        full_action[N:] = -1.0

        obs, reward, terminated, truncated, info = base_env.step(full_action)

        current_temps = info["temperatures"]
        current_max = float(np.max(current_temps))
        max_temp = max(max_temp, current_max)

        # 1. Operational limit tracking (ASHRAE Class A2 allowable max SLA threshold: operational_max_temperature_c = 35.0 C for simulated IT inlet/zone temps)
        op_excess = np.maximum(current_temps - cfg.operational_max_temperature_c, 0.0)
        if np.any(op_excess > 0.0):
            operational_violations += 1
            # 5 minutes per timestep * excess degrees across zones
            operational_degree_minutes += float(np.sum(op_excess) * 5.0)

        # 2. Emergency limit tracking (Project-defined simulator emergency threshold: emergency_max_temperature_c = 45.0 C)
        if np.any(current_temps > cfg.emergency_max_temperature_c):
            emergency_violations += 1

        if "step_power" in info:
            total_energy += info["step_power"]["total_facility_power_kw"]
            total_cooling_used += info["step_power"]["cooling_power_kw"]
            total_it_energy += info["step_power"]["it_power_kw"]

        total_workload += float(info.get("total_workload", 0.0))
        step += 1

    applied_arr = np.array(all_applied_cooling)    # (steps, N)
    proposed_arr = np.array(all_proposed_cooling)  # (steps, N)

    mean_applied = float(np.mean(applied_arr))
    std_applied = float(np.std(applied_arr))
    mean_proposed = float(np.mean(proposed_arr))
    max_discrepancy = float(np.max(np.abs(proposed_arr - applied_arr)))

    frac_near_max = float(np.mean(applied_arr > 0.95))
    frac_near_zero = float(np.mean(applied_arr < 0.05))

    # SLA uptime: percentage of steps without operational violations
    sla_uptime_pct = float(100.0 * (1.0 - (operational_violations / max(step, 1))))
    shield_override_rate = float(shield_corrections / max(step * N, 1))

    return {
        "scenario": scenario_name,
        "seed": seed,
        "pue": float(info["episode_pue"]),
        "max_temp": float(max_temp),
        "total_energy_kwh": float(total_energy),
        "total_cooling_kwh": float(total_cooling_used),
        "total_it_energy_kwh": float(total_it_energy),
        "sla_uptime_pct": sla_uptime_pct,
        "operational_violations": operational_violations,
        "operational_violation_duration_steps": operational_violations,
        "operational_violation_duration_min": float(operational_violations * 5.0),
        "operational_degree_minutes": float(operational_degree_minutes),
        "emergency_violations": emergency_violations,
        "safety_violations": emergency_violations,       # backward-compatibility alias
        "shield_corrections": shield_corrections,
        "shield_override_count": shield_corrections,
        "shield_override_rate": shield_override_rate,
        "mean_proposed_cooling": mean_proposed,
        "mean_applied_cooling": mean_applied,
        "mean_cooling": mean_applied,                    # backward-compatibility alias
        "std_cooling": std_applied,                      # backward-compatibility alias
        "max_action_discrepancy": max_discrepancy,
        "frac_near_max_cooling": frac_near_max,
        "frac_near_zero_cooling": frac_near_zero,
        "workload_served_pct": 100.0,
        "workload_shed_pct": 0.0,
        "steps": step,
    }


def evaluate_multi_seed(
    model,
    scenario_name: str = "cooling_failure",
    seeds: list[int] = TEST_SEEDS,
    cfg: Optional[ThermalConfig] = None,
    shield_active: bool = True,
) -> dict[str, Any]:
    """Run evaluation across multiple seeds and return mean/std summary plus raw results."""
    results = [
        evaluate_episode(model, scenario_name, seed, cfg, shield_active)
        for seed in seeds
    ]
    keys = [
        "pue",
        "max_temp",
        "total_energy_kwh",
        "total_cooling_kwh",
        "sla_uptime_pct",
        "operational_violations",
        "operational_violation_duration_steps",
        "operational_violation_duration_min",
        "operational_degree_minutes",
        "emergency_violations",
        "safety_violations",
        "shield_override_count",
        "shield_override_rate",
        "mean_proposed_cooling",
        "mean_applied_cooling",
        "mean_cooling",
        "std_cooling",
        "max_action_discrepancy",
        "frac_near_max_cooling",
        "frac_near_zero_cooling",
        "workload_served_pct",
    ]
    summary: dict[str, Any] = {"per_seed_results": results}
    for k in keys:
        vals = [r[k] for r in results]
        summary[f"{k}_mean"] = float(np.mean(vals))
        summary[f"{k}_std"] = float(np.std(vals))
    summary["seeds"] = list(seeds)
    summary["n_seeds"] = len(seeds)
    summary["scenario"] = scenario_name
    return summary


# ---------------------------------------------------------------------------
# Degeneracy check
# ---------------------------------------------------------------------------

def check_degeneracy(eval_result: dict[str, float]) -> tuple[bool, str]:
    """Return (is_degenerate, reason) from an evaluate_episode result.

    Degenerate policies:
    - always-max: mean cooling > 0.9 AND std < 0.05
    - always-zero: mean cooling < 0.1 AND std < 0.05
    """
    mean = eval_result["mean_cooling"]
    std = eval_result["std_cooling"]
    frac_max = eval_result["frac_near_max_cooling"]
    frac_zero = eval_result["frac_near_zero_cooling"]

    if frac_max > 0.90:
        return True, f"Always-max cooling: {frac_max:.1%} of actions near 1.0, mean={mean:.3f}"
    if frac_zero > 0.90:
        return True, f"Always-zero cooling: {frac_zero:.1%} of actions near 0.0, mean={mean:.3f}"
    if std < 0.02:
        return True, f"Policy is nearly constant: std={std:.4f}, mean={mean:.3f}"
    return False, "Non-degenerate policy"


# ---------------------------------------------------------------------------
# CLI entry point: train + evaluate
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Phase 3: Train cooling-only RL")
    parser.add_argument("--timesteps", type=int, default=200_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--checkpoint", type=str, default=str(CHECKPOINT_PATH))
    parser.add_argument("--eval-only", action="store_true",
                        help="Skip training, just evaluate existing checkpoint")
    parser.add_argument("--verbose", type=int, default=1)
    args = parser.parse_args()

    cfg = ThermalConfig.from_config_dir()

    if not args.eval_only:
        print(f"[Phase3] Training for {args.timesteps:,} timesteps...")
        model = train(
            total_timesteps=args.timesteps,
            checkpoint_path=args.checkpoint,
            base_seed=args.seed,
            cfg=cfg,
            verbose=args.verbose,
        )
    else:
        print(f"[Phase3] Loading checkpoint from {args.checkpoint}")
        model = load_model(args.checkpoint)

    # Multi-seed evaluation
    print("\n[Phase3] Evaluating across 5 seeds on cooling_failure scenario...")
    multi = evaluate_multi_seed(model, "cooling_failure", EVAL_SEEDS, cfg)

    print("\n" + "=" * 60)
    print("Cooling-Only RL | cooling_failure | 5-seed evaluation")
    print("=" * 60)
    print(f"  PUE:              {multi['pue_mean']:.3f} +/- {multi['pue_std']:.3f}")
    print(f"  Max temp:         {multi['max_temp_mean']:.1f} +/- {multi['max_temp_std']:.1f} C")
    print(f"  Total energy:     {multi['total_energy_kwh_mean']:.1f} kWh")
    print(f"  Safety violations:{multi['safety_violations_mean']:.1f} avg")
    print(f"  Mean cooling:     {multi['mean_cooling_mean']:.3f}")
    print(f"  Cooling std:      {multi['std_cooling_mean']:.3f}")
    print(f"  Frac near max:    {multi['frac_near_max_cooling_mean']:.1%}")
    print(f"  Frac near zero:   {multi['frac_near_zero_cooling_mean']:.1%}")

    # Degeneracy check
    single = evaluate_episode(model, "cooling_failure", 42, cfg)
    degenerate, reason = check_degeneracy(single)
    print(f"\n  Degeneracy check: {'DEGENERATE' if degenerate else 'OK'} -- {reason}")
    print("=" * 60)
