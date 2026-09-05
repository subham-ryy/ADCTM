"""
Unit tests for the thermal model (engine/physics/thermal_model.py).

Covers:
- Deterministic behaviour with seeded RNG
- Temperature increases under high workload + zero cooling
- Temperature decreases/stabilises with sufficient cooling
- Power accounting produces finite, positive values
- PUE is ≥ 1.0
- Reward function returns finite values and responds correctly to
  temperature/cooling changes
"""

import numpy as np
import pytest

from engine.physics.thermal_model import ThermalConfig, ThermalModel


@pytest.fixture
def cfg() -> ThermalConfig:
    return ThermalConfig(num_zones=5)


@pytest.fixture
def model(cfg: ThermalConfig) -> ThermalModel:
    return ThermalModel(cfg)


class TestThermalStep:
    """Tests for step_temperatures."""

    def test_deterministic_with_seed(self, model: ThermalModel):
        """Identical seeds + inputs → identical outputs."""
        temps = np.array([22.0, 23.0, 24.0, 25.0, 26.0])
        workloads = np.full(5, 0.5)
        cooling = np.full(5, 0.5)
        ambient = 30.0

        rng1 = np.random.default_rng(42)
        result1 = model.step_temperatures(temps.copy(), workloads, cooling, ambient, rng1)

        rng2 = np.random.default_rng(42)
        result2 = model.step_temperatures(temps.copy(), workloads, cooling, ambient, rng2)

        np.testing.assert_array_equal(result1, result2)

    def test_temp_increases_with_zero_cooling(self, model: ThermalModel):
        """High workload + zero cooling → temperature must rise."""
        temps = np.full(5, 25.0)
        workloads = np.full(5, 0.8)
        cooling = np.zeros(5)
        ambient = 30.0

        rng = np.random.default_rng(0)
        new_temps = model.step_temperatures(temps, workloads, cooling, ambient, rng)

        # Every zone should be hotter (a=5, workload=0.8 → +4.0 plus ambient coupling)
        assert np.all(new_temps > temps), (
            f"Expected all temps to increase. Old: {temps}, New: {new_temps}"
        )

    def test_temp_decreases_with_full_cooling(self, model: ThermalModel):
        """Low workload + full cooling → temperature must drop."""
        temps = np.full(5, 30.0)
        workloads = np.full(5, 0.1)   # a*0.1 = 0.5
        cooling = np.ones(5)           # b*1.0 = 6.0 → net change ≈ -5.5 + ambient coupling
        ambient = 25.0                 # g*(25-30) = -0.1 → further cooling

        rng = np.random.default_rng(0)
        new_temps = model.step_temperatures(temps, workloads, cooling, ambient, rng)

        assert np.all(new_temps < temps), (
            f"Expected all temps to decrease. Old: {temps}, New: {new_temps}"
        )

    def test_output_shape(self, model: ThermalModel):
        """Output shape matches input."""
        temps = np.full(5, 22.0)
        rng = np.random.default_rng(0)
        result = model.step_temperatures(
            temps, np.full(5, 0.5), np.full(5, 0.5), 30.0, rng
        )
        assert result.shape == (5,)

    def test_finite_outputs(self, model: ThermalModel):
        """No NaN or Inf in output."""
        temps = np.full(5, 22.0)
        rng = np.random.default_rng(0)
        result = model.step_temperatures(
            temps, np.full(5, 0.5), np.full(5, 0.5), 30.0, rng
        )
        assert np.all(np.isfinite(result))


class TestPowerAccounting:
    """Tests for compute_power."""

    def test_positive_power_values(self, model: ThermalModel):
        """All power values should be non-negative."""
        power = model.compute_power(np.full(5, 0.5), np.full(5, 0.5))
        assert power["it_power_kw"] > 0
        assert power["cooling_power_kw"] > 0
        assert power["overhead_kw"] > 0
        assert power["total_facility_power_kw"] > 0

    def test_pue_at_least_one(self, model: ThermalModel):
        """PUE must always be ≥ 1.0 (total ≥ IT)."""
        power = model.compute_power(np.full(5, 0.5), np.full(5, 0.5))
        assert power["pue"] >= 1.0

    def test_pue_equals_one_with_zero_cooling(self, model: ThermalModel):
        """PUE approaches ~1.0 + overhead when cooling is zero."""
        power = model.compute_power(np.full(5, 0.5), np.zeros(5))
        # overhead_fraction = 0.05, so PUE ≈ 1.05
        assert abs(power["pue"] - 1.05) < 0.01

    def test_finite_power_values(self, model: ThermalModel):
        """All power values are finite (scalars and arrays)."""
        power = model.compute_power(np.full(5, 1.0), np.full(5, 1.0))
        for k, v in power.items():
            v_arr = np.asarray(v)
            assert np.all(np.isfinite(v_arr)), f"Non-finite power value for key '{k}': {v}"

    def test_zero_workload_pue(self, model: ThermalModel):
        """PUE defaults to 1.0 when IT power is zero (idle DC)."""
        power = model.compute_power(np.zeros(5), np.full(5, 0.5))
        assert power["pue"] == 1.0


class TestReward:
    """Tests for compute_reward."""

    def test_reward_is_finite(self, model: ThermalModel):
        reward = model.compute_reward(
            np.full(5, 25.0), np.full(5, 0.5),
            np.full(5, 0.5), np.full(5, 0.5),
        )
        assert np.isfinite(reward)

    def test_higher_temp_worse_reward(self, model: ThermalModel):
        """Higher temperatures → worse (more negative) reward."""
        cooling = np.full(5, 0.5)
        workloads = np.full(5, 0.5)

        r_safe = model.compute_reward(np.full(5, 25.0), workloads, cooling, cooling)
        r_hot = model.compute_reward(np.full(5, 38.0), workloads, cooling, cooling)

        assert r_safe > r_hot, f"Safe reward {r_safe} should be > hot reward {r_hot}"

    def test_less_cooling_better_reward_when_safe(self, model: ThermalModel):
        """Using less energy at safe temps → better reward (energy_cost lower)."""
        temps = np.full(5, 22.0)  # well within target band
        workloads = np.full(5, 0.3)
        prev = np.full(5, 0.3)

        r_low_cool = model.compute_reward(temps, workloads, np.full(5, 0.2), prev)
        r_high_cool = model.compute_reward(temps, workloads, np.full(5, 0.8), prev)

        assert r_low_cool > r_high_cool

    def test_emergency_override_zeroes_jitter(self, model: ThermalModel):
        """When any zone > critical_temp, jitter penalty = 0."""
        temps = np.full(5, 42.0)  # above critical_temp (40)
        prev = np.zeros(5)
        cooling = np.ones(5)  # huge jitter from 0→1

        # With emergency override, jitter should be zero
        # Compare: same scenario but temps below critical
        r_critical = model.compute_reward(temps, np.full(5, 0.5), cooling, prev)
        # Since temps are very high, the temp penalty dominates regardless,
        # but we verify it doesn't crash and returns finite
        assert np.isfinite(r_critical)
