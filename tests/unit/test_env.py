"""
Unit tests for the data center Gymnasium environment (engine/env.py).

Covers:
- Deterministic reset and stepping with seeds
- Observation and action shapes / bounds
- Workload conservation after movement
- Temperature dynamics direction (high load → heating, full cool → cooling)
- PUE and power values in info dict
- Full episode completion without crashes
"""

import numpy as np
import pytest

from engine.env import DataCenterEnv
from engine.physics.thermal_model import ThermalConfig


@pytest.fixture
def cfg() -> ThermalConfig:
    return ThermalConfig(num_zones=5, episode_length=50)


@pytest.fixture
def env(cfg: ThermalConfig) -> DataCenterEnv:
    e = DataCenterEnv(config=cfg)
    yield e
    e.close()


class TestResetDeterminism:
    """reset(seed=...) produces identical initial states."""

    def test_same_seed_same_obs(self, env: DataCenterEnv):
        obs1, info1 = env.reset(seed=42)
        obs2, info2 = env.reset(seed=42)
        np.testing.assert_array_equal(obs1, obs2)

    def test_different_seed_same_initial_temps(self, env: DataCenterEnv):
        """Initial conditions are deterministic (seed only affects noise)."""
        obs1, _ = env.reset(seed=1)
        obs2, _ = env.reset(seed=2)
        # Temperatures (first N elements) should be identical at reset
        N = env.cfg.num_zones
        np.testing.assert_array_equal(obs1[:N], obs2[:N])


class TestStepDeterminism:
    """Identical seeds + identical actions → identical trajectories."""

    def test_deterministic_trajectory(self, env: DataCenterEnv):
        actions = [env.action_space.sample() for _ in range(10)]

        # Run 1
        env.reset(seed=123)
        obs_seq1 = []
        for a in actions:
            obs, *_ = env.step(a)
            obs_seq1.append(obs.copy())

        # Run 2
        env.reset(seed=123)
        obs_seq2 = []
        for a in actions:
            obs, *_ = env.step(a)
            obs_seq2.append(obs.copy())

        for i, (o1, o2) in enumerate(zip(obs_seq1, obs_seq2)):
            np.testing.assert_array_equal(o1, o2, err_msg=f"Mismatch at step {i}")


class TestObsActionShapes:
    """Observation and action spaces have correct shapes and bounds."""

    def test_obs_shape(self, env: DataCenterEnv):
        obs, _ = env.reset(seed=0)
        N = env.cfg.num_zones
        expected = 4 * N + 2
        assert obs.shape == (expected,), f"Expected obs shape ({expected},), got {obs.shape}"

    def test_obs_dtype(self, env: DataCenterEnv):
        obs, _ = env.reset(seed=0)
        assert obs.dtype == np.float32

    def test_action_shape(self, env: DataCenterEnv):
        N = env.cfg.num_zones
        expected = N + 3
        assert env.action_space.shape == (expected,)

    def test_action_bounds(self, env: DataCenterEnv):
        np.testing.assert_array_equal(env.action_space.low, -1.0)
        np.testing.assert_array_equal(env.action_space.high, 1.0)

    def test_obs_contains_sample(self, env: DataCenterEnv):
        obs, _ = env.reset(seed=0)
        assert env.observation_space.contains(obs), "Observation not in observation_space"


class TestWorkloadConservation:
    """Total workload must be conserved after movement."""

    def test_workload_conserved_on_move(self, env: DataCenterEnv):
        env.reset(seed=0)
        N = env.cfg.num_zones
        total_before = float(np.sum(env._workloads))

        # Craft action that moves workload: from zone 3 to zone 0
        action = np.zeros(N + 3, dtype=np.float32)
        action[:N] = 0.0  # neutral cooling (maps to 0.5)
        # from_zone = 3 → raw = 2 * (3 + 0.5)/5 - 1 = 0.4
        action[N] = 0.4
        # to_zone = 0 → raw = 2 * (0 + 0.5)/5 - 1 = -0.8
        action[N + 1] = -0.8
        # move_amount = 1.0 → max fraction
        action[N + 2] = 1.0

        env.step(action)
        total_after = float(np.sum(env._workloads))

        np.testing.assert_almost_equal(
            total_before, total_after, decimal=10,
            err_msg=f"Workload not conserved: {total_before} → {total_after}"
        )

    def test_workload_stays_in_bounds(self, env: DataCenterEnv):
        """All workloads remain in [0, 1] after any action."""
        env.reset(seed=0)
        N = env.cfg.num_zones

        for _ in range(20):
            action = env.action_space.sample()
            env.step(action)
            assert np.all(env._workloads >= 0.0), f"Negative workload: {env._workloads}"
            assert np.all(env._workloads <= 1.0), f"Workload > 1: {env._workloads}"

    def test_workload_conserved_over_episode(self, env: DataCenterEnv):
        """Total workload conserved across many steps with random actions."""
        env.reset(seed=42)
        total_initial = float(np.sum(env._workloads))

        for _ in range(50):
            action = env.action_space.sample()
            env.step(action)

        total_final = float(np.sum(env._workloads))
        np.testing.assert_almost_equal(
            total_initial, total_final, decimal=8,
            err_msg=f"Workload drifted: {total_initial} → {total_final}"
        )


class TestTemperatureDynamics:
    """Temperature responds correctly to workload and cooling."""

    def test_high_load_zero_cooling_heats_up(self, env: DataCenterEnv):
        """High workload + zero cooling → temperature rises."""
        cfg = ThermalConfig(
            num_zones=5,
            noise_std=0.0,  # eliminate noise for deterministic check
            initial_temperatures=[25.0] * 5,
            initial_workloads=[0.8] * 5,
        )
        e = DataCenterEnv(config=cfg)
        e.reset(seed=0)
        temps_before = e._temperatures.copy()

        N = cfg.num_zones
        # Cooling = 0 (action = -1 maps to 0)
        action = np.full(N + 3, -1.0, dtype=np.float32)
        e.step(action)

        assert np.all(e._temperatures > temps_before), (
            f"Temps should rise. Before: {temps_before}, After: {e._temperatures}"
        )
        e.close()

    def test_low_load_full_cooling_cools_down(self, env: DataCenterEnv):
        """Low workload + full cooling → temperature drops."""
        cfg = ThermalConfig(
            num_zones=5,
            noise_std=0.0,
            initial_temperatures=[30.0] * 5,
            initial_workloads=[0.1] * 5,
            ambient_temp=25.0,
        )
        e = DataCenterEnv(config=cfg)
        e.reset(seed=0)
        temps_before = e._temperatures.copy()

        N = cfg.num_zones
        # Cooling = 1 (action = +1 maps to 1.0)
        action = np.full(N + 3, 1.0, dtype=np.float32)
        e.step(action)

        assert np.all(e._temperatures < temps_before), (
            f"Temps should drop. Before: {temps_before}, After: {e._temperatures}"
        )
        e.close()


class TestPowerAndPUE:
    """Power and PUE values in info dict are correct."""

    def test_info_contains_power(self, env: DataCenterEnv):
        env.reset(seed=0)
        _, _, _, _, info = env.step(env.action_space.sample())
        assert "step_power" in info
        assert "pue" in info["step_power"]

    def test_step_power_finite(self, env: DataCenterEnv):
        env.reset(seed=0)
        _, _, _, _, info = env.step(env.action_space.sample())
        for k, v in info["step_power"].items():
            v_arr = np.asarray(v)
            assert np.all(np.isfinite(v_arr)), f"step_power[{k}] = {v} is not finite"

    def test_episode_pue_finite(self, env: DataCenterEnv):
        env.reset(seed=0)
        for _ in range(10):
            _, _, _, _, info = env.step(env.action_space.sample())
        assert np.isfinite(info["episode_pue"])
        assert info["episode_pue"] >= 1.0


class TestFullEpisode:
    """Run a complete episode with random actions — no crashes."""

    def test_complete_episode_random_actions(self, env: DataCenterEnv):
        obs, info = env.reset(seed=99)
        assert obs.shape == env.observation_space.shape

        total_reward = 0.0
        steps = 0
        terminated = truncated = False

        while not (terminated or truncated):
            action = env.action_space.sample()
            obs, reward, terminated, truncated, info = env.step(action)

            assert np.all(np.isfinite(obs)), f"Non-finite obs at step {steps}"
            assert np.isfinite(reward), f"Non-finite reward at step {steps}"
            total_reward += reward
            steps += 1

        assert steps == env.cfg.episode_length
        assert truncated is True
        assert terminated is False
        assert np.isfinite(total_reward)
        assert np.isfinite(info["episode_pue"])
        assert info["episode_pue"] >= 1.0

    def test_no_nan_in_obs_across_episode(self, env: DataCenterEnv):
        env.reset(seed=7)
        for step in range(env.cfg.episode_length):
            obs, *_ = env.step(env.action_space.sample())
            assert not np.any(np.isnan(obs)), f"NaN in obs at step {step}: {obs}"
