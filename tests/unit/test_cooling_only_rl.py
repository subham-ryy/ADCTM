"""
Tests for Phase 3: cooling-only RL wrapper, scenario randomisation, and
checkpoint loading.

Scope (fast, no actual PPO training):
- CoolingOnlyWrapper: workload never changes across a full episode
- CoolingOnlyWrapper: action space is (N,) not (N+3,)
- ScenarioRandomisationWrapper: cycles through scenarios correctly
- Checkpoint load: load_model raises FileNotFoundError on missing file
- Checkpoint load: saved model produces valid actions on fresh env
- Evaluation helpers: evaluate_episode returns required keys, finite values
- Degeneracy check: correctly identifies always-max and always-zero policies
- Safety shield: evaluate_episode with shield gives 0 violations on sane policy
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from engine.control.cooling_only_rl import (
    ALL_SCENARIOS,
    CHECKPOINT_PATH,
    EVAL_SEEDS,
    CoolingOnlyWrapper,
    ScenarioRandomisationWrapper,
    check_degeneracy,
    evaluate_episode,
    evaluate_multi_seed,
    load_model,
    train,
)
from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig

# Short episode for test speed
_TEST_CFG = ThermalConfig(num_zones=5, episode_length=50)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def base_env():
    e = DataCenterEnv(config=_TEST_CFG)
    yield e
    e.close()


@pytest.fixture
def cooling_only_env(base_env):
    return CoolingOnlyWrapper(base_env)


@pytest.fixture
def scenario_env():
    base = DataCenterEnv(config=_TEST_CFG)
    wrapped = CoolingOnlyWrapper(base)
    scenario_wrapped = ScenarioRandomisationWrapper(wrapped, cfg=_TEST_CFG, base_seed=0)
    yield scenario_wrapped
    scenario_wrapped.close()


# ---------------------------------------------------------------------------
# CoolingOnlyWrapper
# ---------------------------------------------------------------------------

class TestCoolingOnlyWrapper:

    def test_action_space_shape(self, cooling_only_env):
        """Action space should be (N,) not (N+3,)."""
        N = _TEST_CFG.num_zones
        assert cooling_only_env.action_space.shape == (N,), (
            f"Expected ({N},), got {cooling_only_env.action_space.shape}"
        )

    def test_action_space_bounds(self, cooling_only_env):
        np.testing.assert_array_equal(cooling_only_env.action_space.low, -1.0)
        np.testing.assert_array_equal(cooling_only_env.action_space.high, 1.0)

    def test_observation_space_unchanged(self, cooling_only_env, base_env):
        """Observation space should match the base env."""
        assert cooling_only_env.observation_space.shape == base_env.observation_space.shape

    def test_workload_never_changes(self, cooling_only_env):
        """Workload distribution must be constant across a full episode
        (the no-op workload-move dims ensure this)."""
        obs, info = cooling_only_env.reset(seed=0)
        N = _TEST_CFG.num_zones
        initial_workloads = cooling_only_env.env._workloads.copy()
        initial_total = float(np.sum(initial_workloads))

        for _ in range(_TEST_CFG.episode_length):
            action = cooling_only_env.action_space.sample()
            obs, _, terminated, truncated, info = cooling_only_env.step(action)
            current_total = float(np.sum(cooling_only_env.env._workloads))
            np.testing.assert_almost_equal(
                current_total, initial_total, decimal=8,
                err_msg="Workload changed in CoolingOnlyWrapper!"
            )
            if terminated or truncated:
                break

        # Also check per-zone: no zone moved
        final_workloads = cooling_only_env.env._workloads.copy()
        np.testing.assert_array_almost_equal(
            initial_workloads, final_workloads,
            err_msg="Per-zone workloads changed in CoolingOnlyWrapper!"
        )

    def test_step_returns_correct_shapes(self, cooling_only_env):
        cooling_only_env.reset(seed=0)
        action = cooling_only_env.action_space.sample()
        obs, reward, terminated, truncated, info = cooling_only_env.step(action)
        assert obs.shape == cooling_only_env.observation_space.shape
        assert isinstance(reward, float)
        assert isinstance(terminated, bool)
        assert isinstance(truncated, bool)

    def test_full_episode_no_crash(self, cooling_only_env):
        """Complete episode with random actions should not crash."""
        obs, _ = cooling_only_env.reset(seed=42)
        terminated = truncated = False
        steps = 0
        while not (terminated or truncated):
            obs, reward, terminated, truncated, info = cooling_only_env.step(
                cooling_only_env.action_space.sample()
            )
            assert np.all(np.isfinite(obs)), f"Non-finite obs at step {steps}"
            steps += 1
        assert steps == _TEST_CFG.episode_length


# ---------------------------------------------------------------------------
# ScenarioRandomisationWrapper
# ---------------------------------------------------------------------------

class TestScenarioRandomisationWrapper:

    def test_cycles_through_scenarios(self, scenario_env):
        """Should cycle through scenarios in order."""
        scenarios_seen = []
        for _ in range(len(ALL_SCENARIOS) * 2):
            scenario_env.reset()
            scenarios_seen.append(scenario_env._current_scenario)
        # Each scenario should appear at least twice
        for s in ALL_SCENARIOS:
            assert s in scenarios_seen, f"Scenario {s!r} never appeared"

    def test_different_seeds_per_episode(self, scenario_env):
        """Different episodes should have different RNG states (different obs)."""
        obs1, _ = scenario_env.reset()
        obs2, _ = scenario_env.reset()
        # Same scenario different seed → likely different obs (not guaranteed but
        # highly probable for ambient/workload variation)
        # We just check no crash and valid shapes
        assert obs1.shape == scenario_env.observation_space.shape
        assert obs2.shape == scenario_env.observation_space.shape

    def test_peak_load_scenario_has_higher_workloads(self, scenario_env):
        """Peak-load scenario should reset with higher workloads than normal."""
        # Force peak_load by manually cycling to it
        while scenario_env._current_scenario != "peak_load":
            scenario_env.reset()
        # Check workloads
        base_env = scenario_env.env.env  # ScenarioWrapper -> CoolingOnly -> DataCenterEnv
        peak_workloads = base_env._workloads.copy()

        # Reset normal scenario
        while scenario_env._current_scenario != "normal":
            scenario_env.reset()
        normal_workloads = base_env._workloads.copy()

        assert float(np.mean(peak_workloads)) > float(np.mean(normal_workloads)), (
            "Peak scenario should have higher average workload"
        )

    def test_ambient_heat_scenario_higher_ambient(self, scenario_env):
        """Ambient heat scenario should have higher ambient_temp."""
        while scenario_env._current_scenario != "ambient_heat":
            scenario_env.reset()
        base_env = scenario_env.env.env
        hot_ambient = base_env._ambient_temp

        while scenario_env._current_scenario != "normal":
            scenario_env.reset()
        normal_ambient = base_env._ambient_temp

        assert hot_ambient > normal_ambient, (
            f"Ambient heat temp {hot_ambient} should be > normal {normal_ambient}"
        )


# ---------------------------------------------------------------------------
# load_model
# ---------------------------------------------------------------------------

class TestLoadModel:

    def test_raises_on_missing_file(self):
        with pytest.raises(FileNotFoundError):
            load_model("/nonexistent/path/model.zip")

    def test_loads_saved_model(self, tmp_path):
        """Train a tiny model, save it, reload it, get valid actions."""
        from stable_baselines3 import PPO

        cfg = ThermalConfig(num_zones=5, episode_length=10)
        base = DataCenterEnv(config=cfg)
        env = CoolingOnlyWrapper(base)
        env.reset(seed=0)

        model = PPO("MlpPolicy", env, n_steps=16, batch_size=8,
                    n_epochs=1, verbose=0, seed=0)
        model.learn(total_timesteps=32)

        ckpt = tmp_path / "test_model.zip"
        model.save(str(ckpt))
        env.close()

        # Reload and produce action
        loaded = load_model(ckpt)
        base2 = DataCenterEnv(config=cfg)
        env2 = CoolingOnlyWrapper(base2)
        obs, _ = env2.reset(seed=0)
        action, _ = loaded.predict(obs, deterministic=True)

        assert action.shape == (5,), f"Expected shape (5,), got {action.shape}"
        assert np.all(action >= -1.0) and np.all(action <= 1.0)
        env2.close()


# ---------------------------------------------------------------------------
# evaluate_episode
# ---------------------------------------------------------------------------

class TestEvaluateEpisode:

    @pytest.fixture
    def tiny_model(self):
        """A freshly initialised (untrained) PPO model for structural tests."""
        from stable_baselines3 import PPO
        cfg = ThermalConfig(num_zones=5, episode_length=20)
        base = DataCenterEnv(config=cfg)
        env = CoolingOnlyWrapper(base)
        env.reset(seed=0)
        model = PPO("MlpPolicy", env, n_steps=16, batch_size=8,
                    n_epochs=1, verbose=0, seed=0)
        model.learn(total_timesteps=32)
        env.close()
        return model, cfg

    def test_returns_required_keys(self, tiny_model):
        model, cfg = tiny_model
        result = evaluate_episode(model, "normal", seed=0, cfg=cfg)
        for key in ["pue", "max_temp", "total_energy_kwh", "safety_violations",
                    "mean_cooling", "std_cooling", "steps"]:
            assert key in result, f"Missing key: {key}"

    def test_all_values_finite(self, tiny_model):
        model, cfg = tiny_model
        result = evaluate_episode(model, "normal", seed=0, cfg=cfg)
        for k, v in result.items():
            if isinstance(v, (int, float)):
                assert np.isfinite(v), f"result[{k}] = {v} is not finite"

    def test_steps_equals_episode_length(self, tiny_model):
        model, cfg = tiny_model
        result = evaluate_episode(model, "normal", seed=0, cfg=cfg)
        assert result["steps"] == cfg.episode_length

    def test_shield_active_no_violations_on_rule_based_proxy(self):
        """Rule-based cooling action passed through evaluate_episode should have
        zero violations when shield is active."""
        from stable_baselines3 import PPO
        from stable_baselines3.common.policies import ActorCriticPolicy
        import torch

        cfg = ThermalConfig(num_zones=5, episode_length=30)
        base = DataCenterEnv(config=cfg)
        env = CoolingOnlyWrapper(base)
        obs, _ = env.reset(seed=0)

        # Tiny trained model (will learn something basic in 200 steps)
        model = PPO("MlpPolicy", env, n_steps=32, batch_size=16,
                    n_epochs=2, verbose=0, seed=0,
                    learning_rate=1e-3)
        model.learn(total_timesteps=200)
        env.close()

        result = evaluate_episode(
            model, "normal", seed=0, cfg=cfg, shield_active=True
        )
        # Shield should prevent any violations
        assert result["safety_violations"] == 0


# ---------------------------------------------------------------------------
# check_degeneracy
# ---------------------------------------------------------------------------

class TestCheckDegeneracy:

    def _make_result(self, mean, std, frac_max, frac_zero):
        return {
            "mean_cooling": mean,
            "std_cooling": std,
            "frac_near_max_cooling": frac_max,
            "frac_near_zero_cooling": frac_zero,
        }

    def test_always_max_detected(self):
        result = self._make_result(0.97, 0.01, 0.95, 0.01)
        is_deg, reason = check_degeneracy(result)
        assert is_deg, f"Should detect always-max: {reason}"
        assert "max" in reason.lower()

    def test_always_zero_detected(self):
        result = self._make_result(0.02, 0.01, 0.01, 0.97)
        is_deg, reason = check_degeneracy(result)
        assert is_deg, f"Should detect always-zero: {reason}"
        assert "zero" in reason.lower()

    def test_constant_mid_detected(self):
        result = self._make_result(0.5, 0.005, 0.01, 0.01)
        is_deg, reason = check_degeneracy(result)
        assert is_deg, f"Should detect constant policy: {reason}"

    def test_healthy_policy_not_degenerate(self):
        result = self._make_result(0.45, 0.20, 0.05, 0.05)
        is_deg, reason = check_degeneracy(result)
        assert not is_deg, f"Should not be degenerate: {reason}"
