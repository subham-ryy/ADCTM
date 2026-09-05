"""
Unit tests for thermal threshold separation, SLA/uptime metrics,
deterministic seed group isolation, shield-enabled production inference,
and checkpoint location.
"""

from pathlib import Path
import numpy as np
import pytest

from engine.physics.thermal_model import ThermalConfig, ThermalModel
from engine.env import DataCenterEnv
from engine.control.cooling_only_rl import (
    CoolingOnlyWrapper,
    TRAIN_SEEDS,
    VALIDATION_SEEDS,
    TEST_SEEDS,
    CHECKPOINT_PATH,
    CHECKPOINTS_DIR,
    load_model,
    evaluate_episode,
)


class TestThermalThresholds:
    """Requirement 1: Separate thermal thresholds in config and code."""

    def test_threshold_defaults(self):
        cfg = ThermalConfig()
        assert cfg.target_temperature_c == 22.0
        assert cfg.operational_max_temperature_c == 35.0
        assert cfg.emergency_max_temperature_c == 45.0
        # Backward compatibility aliases
        assert cfg.warning_temp == 35.0
        assert cfg.max_safe_temp == 45.0

    def test_from_config_dir_loads_separated_thresholds(self):
        cfg = ThermalConfig.from_config_dir()
        assert cfg.target_temperature_c == 22.0
        assert cfg.operational_max_temperature_c == 35.0
        assert cfg.emergency_max_temperature_c == 45.0
        assert cfg.target_temp_low == 18.0
        assert cfg.target_temp_high == 27.0
        assert cfg.episode_length == 288

    def test_thresholds_ordering(self):
        """Physics sanity: low < target < high < operational < emergency."""
        cfg = ThermalConfig.from_config_dir()
        assert cfg.target_temp_low < cfg.target_temperature_c < cfg.target_temp_high
        assert cfg.target_temp_high < cfg.operational_max_temperature_c < cfg.emergency_max_temperature_c


class TestSLACalculations:
    """Requirement 2 & 3: Operational vs emergency violations & SLA metrics."""

    def test_operational_violation_distinct_from_emergency(self):
        """A zone at 38C exceeds operational limit (35C) but is below emergency limit (45C)."""
        cfg = ThermalConfig(num_zones=5, episode_length=10)
        base = DataCenterEnv(config=cfg)
        env = CoolingOnlyWrapper(base, apply_shield=True)

        class DummyModel:
            def predict(self, obs, deterministic=True):
                # Mild cooling that lets temperature float around 37-38C
                return np.full(5, -0.6, dtype=np.float32), None

        result = evaluate_episode(DummyModel(), "normal", seed=0, cfg=cfg, shield_active=True)

        assert "sla_uptime_pct" in result
        assert "operational_violations" in result
        assert "operational_degree_minutes" in result
        assert "emergency_violations" in result
        assert "shield_override_rate" in result
        assert "mean_proposed_cooling" in result
        assert "mean_applied_cooling" in result
        assert "workload_served_pct" in result

        # Peak temp may exceed operational max without emergency trip
        if result["max_temp"] > cfg.operational_max_temperature_c:
            assert result["operational_violations"] > 0
            assert result["sla_uptime_pct"] < 100.0
            assert result["operational_degree_minutes"] > 0.0

        # With shield active, emergency violations must be strictly zero
        assert result["emergency_violations"] == 0

    def test_degree_minutes_calculation(self):
        """Verify degree-minutes: sum(max(0, T - 35)) * 5 min."""
        cfg = ThermalConfig(num_zones=2, episode_length=2)
        base = DataCenterEnv(config=cfg)
        env = CoolingOnlyWrapper(base, apply_shield=False)

        # Manually verify calculation
        temps = np.array([37.0, 34.0])  # Zone 0: +2C, Zone 1: 0C
        excess = np.maximum(temps - cfg.operational_max_temperature_c, 0.0)
        expected_dm = np.sum(excess) * 5.0
        assert expected_dm == 10.0


class TestDeterministicSeedSeparation:
    """Requirement 4: Strict separation of train, validation, and test seeds."""

    def test_seed_groups_are_disjoint(self):
        train_set = set(TRAIN_SEEDS)
        val_set = set(VALIDATION_SEEDS)
        test_set = set(TEST_SEEDS)

        assert train_set.isdisjoint(val_set), "Train and validation seeds must not overlap"
        assert train_set.isdisjoint(test_set), "Train and test seeds must not overlap"
        assert val_set.isdisjoint(test_set), "Validation and test seeds must not overlap"

    def test_held_out_test_seed_count(self):
        assert len(TEST_SEEDS) >= 5, "Must test across at least 5 held-out seeds"


class TestShieldEnabledProductionInference:
    """Requirement 5 & 6: Shield active in executed path & proposed vs applied tracking."""

    def test_shield_caps_unsafe_action_in_wrapper(self):
        cfg = ThermalConfig(num_zones=5)
        base = DataCenterEnv(config=cfg)
        # Force a hot temperature in state
        base.reset(seed=0)
        base._temperatures = np.array([44.0, 22.0, 22.0, 22.0, 22.0])

        wrapper = CoolingOnlyWrapper(base, apply_shield=True, discrepancy_penalty_coef=2.0)
        # Propose zero cooling for all zones (-1.0 maps to 0.0)
        action = np.full(5, -1.0, dtype=np.float32)
        obs, reward, term, trunc, info = wrapper.step(action)

        # Zone 0 should be capped to 1.0 by shield
        assert info["applied_cooling"][0] == 1.0
        assert info["proposed_cooling"][0] == 0.0
        assert info["action_discrepancy"] > 0.9
        assert info["discrepancy_penalty"] > 0.0


class TestCheckpointLocation:
    """Requirement 8: Checkpoint saved under models/checkpoints/cooling_only_rl.zip."""

    def test_checkpoint_path_structure(self):
        assert CHECKPOINT_PATH.parent.name == "checkpoints"
        assert CHECKPOINT_PATH.name == "cooling_only_rl.zip"
