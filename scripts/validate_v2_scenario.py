"""
Pre-training validation gate for simulator-v2.

Run this script before any training. All 6 conditions must pass.
If any condition fails, training must NOT begin.

Usage:
    python scripts/validate_v2_scenario.py

Exit code 0 = all conditions passed.
Exit code 1 = one or more conditions failed.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path
from typing import List, Tuple

import numpy as np

# Add repo root to path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from engine.physics.thermal_model import ThermalConfig, ThermalModel
from engine.env import DataCenterEnv
from engine.safety.safety_shield import apply_safety_shield
from engine.control.rule_based import RuleBasedController


def _check(condition: bool, name: str, detail: str = "") -> Tuple[bool, str]:
    status = "PASS" if condition else "FAIL"
    msg = f"  [{status}] {name}"
    if detail:
        msg += f"\n         {detail}"
    return condition, msg


def condition_1_placement_effect() -> Tuple[bool, str]:
    """Zone-D to Zone-B migration reduces total facility electrical power.

    The mechanism: Zone-D has high heat gain (a_D=5.8), low cooling effectiveness
    (b_D=4.0), and low COP (2.0). At equilibrium, it requires more cooling action
    than Zone-B (a_B=4.5, b_B=8.0, COP=3.8), and that cooling action costs more
    electricity (low COP). Tests use equilibrium-derived per-zone cooling levels.
    """
    try:
        cfg = ThermalConfig.from_config_dir()
        cfg.noise_std = 0.0
        model = ThermalModel(cfg)

        a = cfg.get_a_zones()
        b = cfg.get_b_zones()
        g = cfg.get_g_zones()
        t_star = 25.0  # target steady-state temperature

        # Equilibrium cooling: C_i = (a_i*W_i + g_i*(T_amb - T*)) / b_i
        w_d = np.array([0.30, 0.30, 0.30, 0.60, 0.30], dtype=np.float64)
        w_b = np.array([0.30, 0.60, 0.30, 0.30, 0.30], dtype=np.float64)

        cooling_d = np.clip((a * w_d + g * (cfg.ambient_temp - t_star)) / b, 0.0, 1.0)
        cooling_b = np.clip((a * w_b + g * (cfg.ambient_temp - t_star)) / b, 0.0, 1.0)

        p_d = model.compute_power(w_d, cooling_d)
        p_b = model.compute_power(w_b, cooling_b)

        reduction = p_d["cooling_power_kw"] - p_b["cooling_power_kw"]
        reduction_pct = 100.0 * reduction / p_d["cooling_power_kw"] if p_d["cooling_power_kw"] > 1e-9 else 0.0
        passed = reduction > 0 and reduction_pct >= 2.0

        detail = (
            f"Zone-D load: {p_d['cooling_power_kw']:.4f} kW cooling (C={cooling_d}), "
            f"Zone-B load: {p_b['cooling_power_kw']:.4f} kW cooling, "
            f"reduction: {reduction_pct:.1f}%"
        )
        return _check(passed, "Placement effect: D->B reduces electrical cooling power >=2%", detail)
    except Exception as e:
        return _check(False, "Placement effect", f"ERROR: {e}\n{traceback.format_exc()}")


def condition_2_rule_based_cannot_exploit_heterogeneity() -> Tuple[bool, str]:
    """Rule-based controller never moves workload → cannot exploit zone heterogeneity."""
    try:
        cfg = ThermalConfig.from_config_dir()
        env = DataCenterEnv(config=cfg)
        controller = RuleBasedController(config=cfg)

        obs, _ = env.reset(seed=42)
        state = env.get_state_dict()
        action = controller.act(state)

        # Rule-based must always produce from_zone == to_zone == 0 and move_fraction == 0
        no_migration = (
            action["from_zone"] == 0
            and action["to_zone"] == 0
            and abs(action["move_fraction"]) < 1e-9
        )
        detail = (
            f"from_zone={action['from_zone']}, to_zone={action['to_zone']}, "
            f"move_fraction={action['move_fraction']:.6f}"
        )
        return _check(no_migration, "Rule-based produces no workload migration", detail)
    except Exception as e:
        return _check(False, "Rule-based no-migration check", f"ERROR: {e}")


def condition_3_shield_works_with_v2() -> Tuple[bool, str]:
    """Safety shield functions correctly with heterogeneous b_i in the one-step predictor."""
    try:
        cfg = ThermalConfig.from_config_dir()

        # Deliberately unsafe action: zero cooling, all zones near hot
        state = {
            "temperatures": [43.0, 43.0, 43.0, 43.0, 43.0],
            "workloads": [0.8, 0.8, 0.8, 0.8, 0.8],
            "cooling_prev": [0.0] * 5,
            "cooling_capacity": [1.0, 1.0, 1.0, 1.0, 1.0],
            "ambient_temp": 30.0,
            "time_step": 0,
        }
        proposed = {
            "cooling": np.zeros(5, dtype=np.float64),
            "from_zone": 0,
            "to_zone": 0,
            "move_fraction": 0.0,
        }
        corrected, info = apply_safety_shield(proposed, state, cfg, bypass=False)

        # Shield must force all zones to max cooling (all at 43°C, near 45°C emergency)
        all_zones_forced = np.all(np.array(corrected["cooling"]) >= 0.9)
        corrections_positive = info["corrections_applied"] > 0

        passed = all_zones_forced and corrections_positive
        detail = (
            f"Applied cooling: {[f'{c:.3f}' for c in corrected['cooling']]}, "
            f"corrections_applied={info['corrections_applied']}"
        )
        return _check(passed, "Safety shield correctly forces max cooling at 43°C", detail)
    except Exception as e:
        return _check(False, "Safety shield v2 compatibility", f"ERROR: {e}\n{traceback.format_exc()}")


def condition_4_existing_tests_pass() -> Tuple[bool, str]:
    """All existing 106+ tests must still pass."""
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/", "-q", "--tb=short"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )
        output = result.stdout + result.stderr
        passed = result.returncode == 0

        # Extract summary line
        summary_lines = [l for l in output.splitlines() if "passed" in l or "failed" in l or "error" in l]
        summary = summary_lines[-1] if summary_lines else "No summary found"
        return _check(passed, "All existing tests pass", summary)
    except subprocess.TimeoutExpired:
        return _check(False, "All existing tests pass", "TIMEOUT after 300s")
    except Exception as e:
        return _check(False, "All existing tests pass", f"ERROR: {e}")


def condition_5_episode_smoke_test() -> Tuple[bool, str]:
    """A full episode with random actions completes without error."""
    try:
        cfg = ThermalConfig.from_config_dir()
        env = DataCenterEnv(config=cfg)
        obs, _ = env.reset(seed=999)

        done = False
        steps = 0
        max_temp_seen = -999.0
        while not done:
            action = env.action_space.sample()
            obs, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated
            steps += 1
            max_temp_seen = max(max_temp_seen, info["max_temp"])

        passed = steps == cfg.episode_length
        detail = f"Steps completed: {steps}, max_temp_seen: {max_temp_seen:.2f}°C"
        return _check(passed, "Full episode smoke test (random actions)", detail)
    except Exception as e:
        return _check(False, "Full episode smoke test", f"ERROR: {e}\n{traceback.format_exc()}")


def condition_6_rule_based_v2_pue() -> Tuple[bool, str]:
    """Rule-based baseline PUE measured on simulator-v2 (establishes the new baseline)."""
    try:
        from engine.safety.safety_shield import apply_safety_shield

        cfg = ThermalConfig.from_config_dir()
        env = DataCenterEnv(config=cfg)
        controller = RuleBasedController(config=cfg)

        pue_values: List[float] = []
        for seed in [201, 202, 203, 204]:  # validation seeds
            obs, _ = env.reset(seed=seed)
            done = False
            while not done:
                state = env.get_state_dict()
                proposed = controller.act(state)
                corrected, _ = apply_safety_shield(proposed, state, cfg, bypass=False)

                # Build env-compatible action
                N = cfg.num_zones
                raw = np.zeros(N + 3, dtype=np.float32)
                raw[:N] = (np.array(corrected["cooling"]) * 2.0 - 1.0).astype(np.float32)
                raw[N] = 2.0 * 0.5 / N - 1.0
                raw[N + 1] = 2.0 * 0.5 / N - 1.0
                raw[N + 2] = -1.0

                obs, _, terminated, truncated, info = env.step(raw)
                done = terminated or truncated

            pue_values.append(info["episode_pue"])

        mean_pue = float(np.mean(pue_values))
        passed = 1.0 < mean_pue < 3.0  # sanity range
        detail = (
            f"Rule-based v2 PUE on validation seeds [201-204]: "
            f"{[f'{p:.4f}' for p in pue_values]} → mean={mean_pue:.4f}. "
            f"This is the NEW v2 baseline target (not comparable to v1 PUE=1.4520)."
        )
        return _check(passed, "Rule-based v2 PUE measured (sanity range 1.0–3.0)", detail)
    except Exception as e:
        return _check(False, "Rule-based v2 PUE measurement", f"ERROR: {e}\n{traceback.format_exc()}")


def main() -> int:
    print("=" * 70)
    print("Simulator-v2 Pre-Training Validation Gate")
    print("All 6 conditions must pass before training begins.")
    print("=" * 70)
    print()

    conditions = [
        condition_1_placement_effect,
        condition_2_rule_based_cannot_exploit_heterogeneity,
        condition_3_shield_works_with_v2,
        condition_4_existing_tests_pass,
        condition_5_episode_smoke_test,
        condition_6_rule_based_v2_pue,
    ]

    results: List[Tuple[bool, str]] = []
    for i, cond_fn in enumerate(conditions, 1):
        print(f"Condition {i}: {cond_fn.__name__}")
        passed, msg = cond_fn()
        results.append((passed, msg))
        print(msg)
        print()

    n_passed = sum(1 for p, _ in results if p)
    n_total = len(results)

    print("=" * 70)
    print(f"RESULT: {n_passed}/{n_total} conditions passed.")
    if n_passed == n_total:
        print("ALL CONDITIONS PASSED -- training may proceed.")
        return 0
    else:
        failed = [msg for p, msg in results if not p]
        print("TRAINING BLOCKED -- the following conditions failed:")
        for msg in failed:
            print(msg)
        return 1


if __name__ == "__main__":
    sys.exit(main())
