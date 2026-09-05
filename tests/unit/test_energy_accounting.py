"""
Unit tests for data center energy accounting and timestep integration.

Verifies:
- Authoritative timestep is 300.0 seconds (5 minutes).
- Episode length of 288 steps represents 24.0 hours (86,400 seconds).
- Power (kW) to energy (kWh) conversion formula: Energy = Power * (timestep_seconds / 3600).
- Historical reconciliation: 7,525 kW-steps corresponds to ~627.1 kWh.
- Aggregate PUE equivalence: PUE computed from energy equals PUE computed from average power.
"""

import pytest
import numpy as np

from engine.physics.thermal_model import (
    TIMESTEP_SECONDS,
    ThermalConfig,
    ThermalModel,
    power_to_energy_kwh,
)
from engine.env import DataCenterEnv


class TestEnergyAccounting:
    def test_authoritative_timestep(self):
        """Authoritative simulation timestep must be exactly 300.0 seconds (5 minutes)."""
        assert TIMESTEP_SECONDS == 300.0

    def test_episode_duration_is_24_hours(self):
        """288 steps of 300.0 seconds must equal exactly 86,400 seconds (24.0 hours)."""
        cfg = ThermalConfig()
        total_seconds = cfg.episode_length * TIMESTEP_SECONDS
        assert total_seconds == 86_400.0
        assert total_seconds / 3600.0 == 24.0

    def test_power_to_energy_single_step(self):
        """10.0 kW over a 300s step must yield 10.0 * (300/3600) = 5/6 kWh (~0.8333 kWh)."""
        power_kw = 10.0
        energy_kwh = power_to_energy_kwh(power_kw)
        expected_kwh = 10.0 * (5.0 / 60.0)
        assert pytest.approx(energy_kwh, rel=1e-6) == expected_kwh
        assert pytest.approx(energy_kwh, rel=1e-4) == 0.83333

    def test_continuous_power_over_full_day(self):
        """Constant 10.0 kW power draw over all 288 steps must equal 240.0 kWh."""
        steps = 288
        power_kw = 10.0
        total_energy_kwh = sum(power_to_energy_kwh(power_kw) for _ in range(steps))
        assert pytest.approx(total_energy_kwh, rel=1e-6) == 240.0

    def test_historical_power_sum_reconciliation(self):
        """Historical ~7,525 kW-steps reconciles to ~627.08 kWh."""
        power_steps = 7525.0
        energy_kwh = power_steps * (TIMESTEP_SECONDS / 3600.0)
        assert pytest.approx(energy_kwh, rel=1e-3) == 627.083

    def test_aggregate_pue_formula(self):
        """PUE from energy must match PUE from power sum."""
        it_power_sum = 5000.0  # kW-steps
        cooling_power_sum = 2000.0  # kW-steps
        overhead_power_sum = 250.0  # kW-steps
        total_facility_power_sum = it_power_sum + cooling_power_sum + overhead_power_sum

        power_pue = total_facility_power_sum / it_power_sum

        it_energy_kwh = it_power_sum * (TIMESTEP_SECONDS / 3600.0)
        cooling_energy_kwh = cooling_power_sum * (TIMESTEP_SECONDS / 3600.0)
        overhead_energy_kwh = overhead_power_sum * (TIMESTEP_SECONDS / 3600.0)
        total_facility_energy_kwh = it_energy_kwh + cooling_energy_kwh + overhead_energy_kwh

        energy_pue = total_facility_energy_kwh / it_energy_kwh

        assert pytest.approx(energy_pue, rel=1e-9) == power_pue
        assert pytest.approx(energy_pue, rel=1e-4) == 1.4500
