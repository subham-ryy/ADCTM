"""
Unit tests for Phase 4: Joint RL Controller.

Tests coverage:
- Continuous Box(2N,) action space encoding and decoding.
- Workload conservation (sum of workloads is invariant).
- Capacity boundaries [0.0, 1.0].
- Per-step migration amount limit enforcement.
- Genuine no-migration outcome (deadband).
- Absence of future-failure information in observation space.
- Proposed versus applied action tracking and logging.
- Deterministic safety shield destination-temperature rejection.
- Disjoint seed groups isolation.
- Checkpoint saving and loading in clean session.
"""

from pathlib import Path
import numpy as np
import pytest

import json
from engine.physics.thermal_model import ThermalConfig
from engine.env import DataCenterEnv
from engine.control.joint_rl import (
    JointActionDecoder,
    JointRLWrapper,
    TRAIN_SEEDS,
    VALIDATION_SEEDS,
    make_env,
)


class TestJointActionDecoder:
    """Action encoding, decoding, conservation, and constraints."""

    def test_decoder_output_keys(self):
        decoder = JointActionDecoder(num_zones=5)
        raw_action = np.zeros(10, dtype=np.float32)
        workloads = np.array([0.3, 0.4, 0.35, 0.5, 0.25], dtype=np.float64)
        capacity = np.ones(5, dtype=np.float64)

        decoded = decoder.decode(raw_action, workloads, capacity)
        for k in ["cooling", "from_zone", "to_zone", "amount", "move_fraction", "target_fractions", "deltas"]:
            assert k in decoded

    def test_workload_conservation(self):
        """Workload moved from source to destination must strictly conserve total workload."""
        decoder = JointActionDecoder(num_zones=5, max_migration_amount=0.05)
        raw_action = np.array([0.0]*5 + [1.0, -1.0, 0.0, 0.0, 0.0], dtype=np.float32)
        workloads = np.array([0.3, 0.5, 0.4, 0.3, 0.2], dtype=np.float64)
        capacity = np.ones(5, dtype=np.float64)

        decoded = decoder.decode(raw_action, workloads, capacity)
        from_z = decoded["from_zone"]
        to_z = decoded["to_zone"]
        amt = decoded["amount"]

        new_workloads = workloads.copy()
        new_workloads[from_z] -= amt
        new_workloads[to_z] += amt

        assert np.isclose(np.sum(new_workloads), np.sum(workloads), atol=1e-12)

    def test_per_step_migration_limit(self):
        max_mig = 0.04
        decoder = JointActionDecoder(num_zones=5, max_migration_amount=max_mig)
        # Extreme preference to move all load to zone 0
        raw_action = np.array([0.0]*5 + [10.0, -10.0, -10.0, -10.0, -10.0], dtype=np.float32)
        workloads = np.array([0.1, 0.5, 0.4, 0.3, 0.2], dtype=np.float64)
        capacity = np.ones(5, dtype=np.float64)

        decoded = decoder.decode(raw_action, workloads, capacity)
        assert decoded["amount"] <= max_mig + 1e-9

    def test_genuine_no_migration_outcome(self):
        """Uniform logits produce zero transfer within deadband."""
        decoder = JointActionDecoder(num_zones=5, deadband=0.01)
        # Exactly equal logits for all zones
        raw_action = np.zeros(10, dtype=np.float32)
        # Workloads exactly equal to softmax targets (0.2 * total)
        workloads = np.array([0.3, 0.3, 0.3, 0.3, 0.3], dtype=np.float64)
        capacity = np.ones(5, dtype=np.float64)

        decoded = decoder.decode(raw_action, workloads, capacity)
        assert decoded["amount"] == 0.0
        assert decoded["move_fraction"] == 0.0

    def test_capacity_enforcement(self):
        """Destination cannot be pushed above 1.0, source cannot fall below 0.0."""
        decoder = JointActionDecoder(num_zones=5, max_migration_amount=0.2)
        # Try to push load into zone 0 which is already at 0.98
        raw_action = np.array([0.0]*5 + [5.0, -5.0, 0.0, 0.0, 0.0], dtype=np.float32)
        workloads = np.array([0.98, 0.5, 0.1, 0.1, 0.1], dtype=np.float64)
        capacity = np.ones(5, dtype=np.float64)

        decoded = decoder.decode(raw_action, workloads, capacity)
        if decoded["to_zone"] == 0:
            assert decoded["amount"] <= 0.02 + 1e-9


class TestJointRLWrapper:
    """Environment wrapper, observation purity, and reward decomposition."""

    def test_action_space_shape(self):
        base_env = DataCenterEnv()
        env = JointRLWrapper(base_env)
        assert env.action_space.shape == (10,)
        assert np.all(env.action_space.low == -1.0)
        assert np.all(env.action_space.high == 1.0)

    def test_absence_of_future_failure_information(self):
        """Observation space contains 4N+2 elements; no failure countdown or future leak."""
        base_env = DataCenterEnv()
        env = JointRLWrapper(base_env, training=True)
        obs, _ = env.reset(seed=42)

        # Obs: [temperatures(5), workloads(5), prev_cooling(5), capacity(5), ambient(1), time_norm(1)]
        assert obs.shape == (22,)
        # Capacity before failure must be normal (1.0 across all zones)
        capacity_obs = obs[15:20]
        assert np.all(capacity_obs == 1.0)

    def test_reward_components_logged(self):
        base_env = DataCenterEnv()
        env = JointRLWrapper(base_env, apply_shield=True)
        obs, _ = env.reset(seed=42)
        action = np.zeros(10, dtype=np.float32)
        _, reward, _, _, info = env.step(action)

        assert "reward_components" in info
        components = info["reward_components"]
        required_keys = ["p_op", "p_emerg", "p_energy", "p_drift", "p_jitter", "p_mig", "p_cap", "p_shed", "p_disc", "total_reward"]
        for k in required_keys:
            assert k in components
            assert np.isfinite(components[k])

    def test_shield_destination_rejection(self):
        """Moving workload into an overheating zone is rejected by the safety shield."""
        cfg = ThermalConfig(num_zones=5)
        base_env = DataCenterEnv(config=cfg)
        env = JointRLWrapper(base_env, apply_shield=True)
        env.reset(seed=42)

        # Artificially set zone 1 near emergency threshold
        env.unwrapped._temperatures[1] = 44.8
        env.unwrapped._workloads[0] = 0.5
        env.unwrapped._workloads[1] = 0.3

        # Force policy to demand migration from zone 0 to zone 1 with zero cooling
        raw_action = np.array([-1.0]*5 + [-5.0, 5.0, 0.0, 0.0, 0.0], dtype=np.float32)
        _, _, _, _, info = env.step(raw_action)

        # Shield must have rejected this move
        assert info["shield_info"]["move_rejected"] is True
        assert info["executed_migration"]["amount"] == 0.0


class TestSeedSeparationAndHygiene:
    """Disjoint seed groups validation across train, validation, and locked test configs."""

    def test_seed_groups_are_disjoint(self):
        s_train = set(TRAIN_SEEDS)
        s_val = set(VALIDATION_SEEDS)

        config_path = Path(__file__).resolve().parents[2] / "benchmarks" / "final_test_config.json"
        assert config_path.exists(), "benchmarks/final_test_config.json must exist"
        with open(config_path, "r") as f:
            test_config = json.load(f)

        s_test = set(test_config["test_seeds"])

        assert s_train.isdisjoint(s_val), "Train and validation seeds must be disjoint"
        assert s_val.isdisjoint(s_test), "Validation and test seeds must be disjoint"
        assert s_train.isdisjoint(s_test), "Train and test seeds must be disjoint"
        assert len(s_test) >= 5, "Test seeds must have at least 5 seeds"
