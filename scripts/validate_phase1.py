#!/usr/bin/env python3
"""
Phase 1 validation script — run one complete episode with random actions.

This is the acceptance gate for Phase 1: the script must run to completion
without crashes, NaNs, invalid shapes, or workload loss.

Usage:
    python scripts/validate_phase1.py
"""

import sys
import numpy as np

# Ensure repo root is on path
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig


def run_validation(seed: int = 42) -> bool:
    """Run one full episode with random actions and validate invariants."""
    print("=" * 70)
    print(f"Phase 1 Validation — seed={seed}")
    print("=" * 70)

    cfg = ThermalConfig()
    env = DataCenterEnv(config=cfg)

    obs, info = env.reset(seed=seed)
    N = cfg.num_zones

    print(f"\nConfig: {N} zones, {cfg.episode_length} steps/episode")
    print(f"Thermal coefficients: a={cfg.a}, b={cfg.b}, g={cfg.g}")
    print(f"Ambient temp: {cfg.ambient_temp}°C")
    print(f"Action space: {env.action_space.shape} (Box, [-1, 1])")
    print(f"Obs space:    {env.observation_space.shape}")
    print(f"Initial temps: {info['temperatures']}")
    print(f"Initial workloads: {info['workloads']} (total={info['total_workload']:.4f})")

    initial_total_workload = info["total_workload"]

    # --- Run episode ---
    total_reward = 0.0
    max_temp_seen = 0.0
    min_temp_seen = 1000.0
    steps = 0
    terminated = truncated = False
    errors = []

    while not (terminated or truncated):
        action = env.action_space.sample()
        obs, reward, terminated, truncated, info = env.step(action)

        steps += 1

        # Check invariants
        if np.any(np.isnan(obs)):
            errors.append(f"Step {steps}: NaN in observation")
        if not np.isfinite(reward):
            errors.append(f"Step {steps}: Non-finite reward ({reward})")
        if obs.shape != env.observation_space.shape:
            errors.append(f"Step {steps}: Wrong obs shape {obs.shape}")

        total_reward += reward
        max_temp_seen = max(max_temp_seen, info["max_temp"])
        min_temp_seen = min(min_temp_seen, float(np.min(info["temperatures"])))

        # Progress bar
        if steps % 50 == 0 or steps == cfg.episode_length:
            print(
                f"  Step {steps:4d}/{cfg.episode_length} | "
                f"MaxT={info['max_temp']:6.1f}°C | "
                f"PUE={info['episode_pue']:.3f} | "
                f"TotalW={info['total_workload']:.4f} | "
                f"Reward={reward:+.2f}"
            )

    # --- Final checks ---
    final_total_workload = info["total_workload"]
    workload_drift = abs(final_total_workload - initial_total_workload)

    print(f"\n{'=' * 70}")
    print(f"Episode complete: {steps} steps")
    print(f"  Total reward:     {total_reward:+.2f}")
    print(f"  Max temp seen:    {max_temp_seen:.1f}°C")
    print(f"  Min temp seen:    {min_temp_seen:.1f}°C")
    print(f"  Final PUE:        {info['episode_pue']:.3f}")
    print(f"  Workload drift:   {workload_drift:.2e} (initial={initial_total_workload:.4f}, final={final_total_workload:.4f})")
    print(f"  Terminated:       {terminated}")
    print(f"  Truncated:        {truncated}")

    # Check episode-level PUE
    if not np.isfinite(info["episode_pue"]):
        errors.append("Episode PUE is not finite")
    if info["episode_pue"] < 1.0:
        errors.append(f"Episode PUE < 1.0: {info['episode_pue']}")

    # Check workload conservation
    if workload_drift > 1e-6:
        errors.append(f"Workload not conserved: drift={workload_drift:.2e}")

    # Check episode length
    if steps != cfg.episode_length:
        errors.append(f"Expected {cfg.episode_length} steps, got {steps}")

    # Check termination
    if not truncated:
        errors.append("Episode should end via truncation")

    if errors:
        print(f"\n[FAIL] VALIDATION FAILED -- {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        return False
    else:
        print(f"\n[PASS] VALIDATION PASSED -- Phase 1 is functional")
        return True


def main() -> int:
    success = run_validation(seed=42)
    if success:
        # Run a second seed to double-check
        print("\n")
        success = run_validation(seed=123)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
