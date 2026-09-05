"""
Scenario configuration helpers.

Translates named scenarios (from config/scenarios.json) into environment
options dicts and mid-episode failure injections.  All scenario logic lives
here so it doesn't pollute the env or controllers.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import numpy as np

from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig

_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

# Peak-load workload levels per zone (higher utilisation)
_PEAK_WORKLOADS = [0.85, 0.90, 0.80, 0.88, 0.82]


def load_scenarios() -> dict[str, Any]:
    with open(_CONFIG_DIR / "scenarios.json", "r") as f:
        return json.load(f)["scenarios"]


def get_reset_options(
    scenario_name: str,
    cfg: ThermalConfig,
    rng: Optional[np.random.Generator] = None,
) -> dict[str, Any]:
    """Return the options dict to pass to env.reset() for a given scenario.

    Parameters
    ----------
    scenario_name : one of "normal", "peak_load", "ambient_heat", "cooling_failure"
    cfg           : ThermalConfig for defaults
    rng           : optional Generator for workload jitter
    """
    scenarios = load_scenarios()
    s = scenarios[scenario_name]
    options: dict[str, Any] = {}

    # Ambient temperature
    ambient_delta = float(s.get("ambient_delta", 0.0))
    options["ambient_temp"] = cfg.ambient_temp + ambient_delta

    # Workload profile
    profile = s.get("workload_profile", "constant")
    if profile == "peak":
        workloads = list(_PEAK_WORKLOADS[: cfg.num_zones])
        # Pad if needed
        while len(workloads) < cfg.num_zones:
            workloads.append(0.85)
        options["initial_workloads"] = workloads
    elif profile == "constant":
        options["initial_workloads"] = list(cfg.initial_workloads[: cfg.num_zones])

    # Cooling capacity (initially full; failure injection applied mid-episode)
    options["cooling_capacity"] = list(cfg.default_cooling_capacity[: cfg.num_zones])

    return options


def apply_failure_injection(
    env: DataCenterEnv,
    scenario_name: str,
    current_step: int,
) -> bool:
    """Apply mid-episode failure injection if the scenario calls for it.

    Must be called every step.  Returns True if an injection was applied
    this step.
    """
    scenarios = load_scenarios()
    s = scenarios.get(scenario_name, {})
    fi = s.get("failure_injection")
    if fi is None:
        return False

    if current_step == fi["trigger_step"]:
        zone_idx = int(fi["zone_index"])
        reduced = float(fi["reduced_capacity"])
        env._cooling_capacity[zone_idx] = reduced
        return True

    return False


def make_scenario_env(
    scenario_name: str,
    cfg: Optional[ThermalConfig] = None,
    seed: Optional[int] = None,
) -> tuple[DataCenterEnv, dict[str, Any]]:
    """Create and reset an env configured for the given scenario.

    Returns (env, info_from_reset).
    """
    cfg = cfg or ThermalConfig()
    env = DataCenterEnv(config=cfg)
    options = get_reset_options(scenario_name, cfg)
    obs, info = env.reset(seed=seed, options=options)
    return env, info


def apply_scenario_to_env(
    env: DataCenterEnv,
    scenario_name: str,
    current_step: int,
) -> bool:
    """Apply any mid-episode effects (e.g. failure injection) for this step."""
    return apply_failure_injection(env, scenario_name, current_step)
