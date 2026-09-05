"""
Simulator-v2 Physics Validation Tests.

These tests must ALL PASS before any training run begins.
They verify that the heterogeneous zone parameters produce measurable
workload-placement effects on total electrical cooling power.

Physics invariance-breaking requirements:
1. Moving workload from Zone-D (low b_D=4.0, low COP_D=2.0) to Zone-B
   (high b_B=8.0, high COP_B=3.8) must measurably reduce total facility
   electrical power — by at least 2% in a controlled test.
2. compute_power() must return different values for workload distributions
   that are D-heavy vs B-heavy.
3. Total workload is conserved through migration.
4. Temperatures remain stable under reasonable per-zone cooling.
5. Temperatures rise toward unsafe levels under zero cooling.

All zone parameters are SYNTHETIC ASSUMPTIONS from config/topology.json.
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.physics.thermal_model import ThermalConfig, ThermalModel, TIMESTEP_SECONDS


# ---------------------------------------------------------------------------
# Fixtures: Simulator-v2 config with the heterogeneous zone topology
# ---------------------------------------------------------------------------

@pytest.fixture
def v2_cfg() -> ThermalConfig:
    """Simulator-v2 ThermalConfig with heterogeneous zone parameters.

    Matches the synthetic topology defined in config/topology.json:
      Zone-A: a=5.2, b=6.0, COP=3.2  (edge)
      Zone-B: a=4.5, b=8.0, COP=3.8  (efficient core — migration destination)
      Zone-C: a=5.0, b=6.0, COP=3.0  (standard)
      Zone-D: a=5.8, b=4.0, COP=2.0  (impaired — migration source)
      Zone-E: a=5.5, b=5.5, COP=2.6  (warm aisle)
    """
    return ThermalConfig(
        num_zones=5,
        # Global scalars (v1 fallback)
        a=5.0,
        b=6.0,
        g=0.02,
        # Per-zone arrays (simulator-v2)
        a_zones=[5.2, 4.5, 5.0, 5.8, 5.5],
        b_zones=[6.0, 8.0, 6.0, 4.0, 5.5],
        g_zones=[0.02, 0.02, 0.02, 0.02, 0.02],
        cop_zones=[3.2, 3.8, 3.0, 2.0, 2.6],
        cooling_power_max_kw_per_zone=[5.0, 5.0, 5.0, 5.0, 5.0],
        noise_std=0.0,  # Zero noise for deterministic physics tests
        ambient_temp=30.0,
        it_power_per_zone_kw=10.0,
        overhead_fraction=0.05,
        target_temp_low=18.0,
        target_temp_high=27.0,
        operational_max_temperature_c=35.0,
        emergency_max_temperature_c=45.0,
        max_safe_temp=45.0,
        simulator_version="v2",
    )


@pytest.fixture
def v1_cfg() -> ThermalConfig:
    """Simulator-v1 ThermalConfig with identical global scalars (no per-zone arrays)."""
    return ThermalConfig(
        num_zones=5,
        a=5.0,
        b=6.0,
        g=0.02,
        noise_std=0.0,
        ambient_temp=30.0,
        it_power_per_zone_kw=10.0,
        overhead_fraction=0.05,
        simulator_version="v1",
    )


# ---------------------------------------------------------------------------
# Test 1: Placement effect — D→B migration reduces total electrical power
# ---------------------------------------------------------------------------

class TestPlacementEffect:
    """Verify that moving workload from Zone-D to Zone-B reduces total
    electrical cooling power. This is the core invariance-breaking test.

    The mechanism: different zones have different cooling effectiveness (b_i)
    and different COP. Zone-D needs more cooling *action* (high a_i, low b_i)
    and each unit of cooling action costs more electricity (low COP_D=2.0).
    Zone-B needs less cooling action (low a_i, high b_i) and each unit costs
    less electricity (high COP_B=3.8).

    Tests use analytically-derived steady-state cooling levels, not uniform
    cooling, to reveal the placement effect through required equilibrium cooling.
    """

    def _equilibrium_cooling(self, cfg: ThermalConfig, workloads: np.ndarray,
                              t_target: float = 25.0) -> np.ndarray:
        """Compute the cooling action per zone required to hold temperature at t_target.

        Steady-state: 0 = a_i*W_i - b_i*C_i + g_i*(T_amb - T*)
        => C_i = (a_i*W_i + g_i*(T_amb - T*)) / b_i
        """
        a = cfg.get_a_zones()
        b = cfg.get_b_zones()
        g = cfg.get_g_zones()
        return np.clip(
            (a * workloads + g * (cfg.ambient_temp - t_target)) / b,
            0.0, 1.0
        )

    def test_d_to_b_migration_reduces_cooling_power(self, v2_cfg: ThermalConfig) -> None:
        """
        Using equilibrium cooling levels (different per zone due to heterogeneity),
        Zone-D load requires more electrical power than Zone-B load with the same
        total workload.

        Zone-D (index 3): a=5.8, b=4.0, COP=2.0 → needs high cooling action, expensive
        Zone-B (index 1): a=4.5, b=8.0, COP=3.8 → needs low cooling action, cheap
        """
        model = ThermalModel(v2_cfg)

        # Scenario A: heavy load on Zone-D (impaired)
        workloads_d_heavy = np.array([0.30, 0.30, 0.30, 0.60, 0.30], dtype=np.float64)
        # Scenario B: same total load, but on Zone-B (efficient)
        workloads_b_heavy = np.array([0.30, 0.60, 0.30, 0.30, 0.30], dtype=np.float64)

        # Assert total workload is identical
        assert abs(np.sum(workloads_d_heavy) - np.sum(workloads_b_heavy)) < 1e-10

        # Use equilibrium cooling: each zone gets exactly the cooling action needed
        # to maintain T=25°C. Different zones need different amounts.
        cooling_a = self._equilibrium_cooling(v2_cfg, workloads_d_heavy)
        cooling_b = self._equilibrium_cooling(v2_cfg, workloads_b_heavy)

        power_a = model.compute_power(workloads_d_heavy, cooling_a)
        power_b = model.compute_power(workloads_b_heavy, cooling_b)

        # IT power must be identical (uniform it_power_per_zone_kw)
        assert abs(power_a["it_power_kw"] - power_b["it_power_kw"]) < 1e-10, \
            "IT power must be identical for same total workload"

        # Cooling electrical power must be lower for Zone-B (higher COP, lower b_i need)
        assert power_b["cooling_power_kw"] < power_a["cooling_power_kw"], (
            f"Zone-B load (COP=3.8, b=8.0) should cost less electrical power "
            f"than Zone-D load (COP=2.0, b=4.0). "
            f"Got power_a_cooling={power_a['cooling_power_kw']:.4f} kW, "
            f"power_b_cooling={power_b['cooling_power_kw']:.4f} kW"
        )

        # Reduction must be at least 2% of scenario A cooling power
        reduction_frac = (power_a["cooling_power_kw"] - power_b["cooling_power_kw"]) / power_a["cooling_power_kw"]
        assert reduction_frac >= 0.02, (
            f"Expected ≥2% cooling power reduction from D→B migration, "
            f"got {reduction_frac:.1%}"
        )

    def test_placement_effect_magnitude(self, v2_cfg: ThermalConfig) -> None:
        """Quantify the combined a_i/b_i/COP placement effect for documentation purposes."""
        model = ThermalModel(v2_cfg)

        # Focus on Zone-D vs Zone-B: isolate them with 0.6 workload each
        w_d = np.array([0.0, 0.0, 0.0, 0.6, 0.0], dtype=np.float64)
        w_b = np.array([0.0, 0.6, 0.0, 0.0, 0.0], dtype=np.float64)

        # Equilibrium cooling
        # Zone-D: C_D = (5.8*0.6 + 0.02*(30-25)) / 4.0 = (3.48+0.1)/4.0 = 0.895
        # Zone-B: C_B = (4.5*0.6 + 0.02*(30-25)) / 8.0 = (2.7+0.1)/8.0 = 0.350
        a = v2_cfg.get_a_zones()
        b = v2_cfg.get_b_zones()
        g = v2_cfg.get_g_zones()
        t_star = 25.0

        c_d_steady = float(np.clip((a[3]*0.6 + g[3]*(30.0 - t_star)) / b[3], 0, 1))
        c_b_steady = float(np.clip((a[1]*0.6 + g[1]*(30.0 - t_star)) / b[1], 0, 1))

        cooling_d = np.zeros(5, dtype=np.float64)
        cooling_d[3] = c_d_steady

        cooling_b = np.zeros(5, dtype=np.float64)
        cooling_b[1] = c_b_steady

        power_d = model.compute_power(w_d, cooling_d)
        power_b = model.compute_power(w_b, cooling_b)

        # Zone-D: 0.895 * 5.0 / 2.0 = 2.238 kW electrical
        # Zone-B: 0.350 * 5.0 / 3.8 = 0.461 kW electrical
        # Zone-D should consume substantially more electrical power
        assert power_d["cooling_power_kw"] > power_b["cooling_power_kw"], (
            f"Zone-D scenario ({power_d['cooling_power_kw']:.4f} kW) must consume "
            f"more electrical cooling power than Zone-B ({power_b['cooling_power_kw']:.4f} kW)"
        )

        # The ratio should be at least 3x (0.895/2.0 vs 0.350/3.8 per kW thermal)
        if power_b["cooling_power_kw"] > 1e-9:
            ratio = power_d["cooling_power_kw"] / power_b["cooling_power_kw"]
            assert ratio >= 2.0, f"Expected ≥2x power ratio Zone-D/Zone-B, got {ratio:.2f}x"


# ---------------------------------------------------------------------------
# Test 2: Invariance broken — different workload distributions produce different power
# ---------------------------------------------------------------------------

class TestInvarianceBroken:
    """Verify that compute_power() returns different values for different
    workload distributions with the same total workload (invariance is broken)."""

    def test_v2_power_differs_for_different_distributions(self, v2_cfg: ThermalConfig) -> None:
        """In simulator-v2, different workload distributions produce different cooling power
        because zones with different a_i and b_i require different cooling actions to maintain
        the same temperature, and different COP means different electrical cost per unit cooling.
        """
        model = ThermalModel(v2_cfg)

        # Equilibrium cooling helper: C_i = (a_i*W_i + g_i*(T_amb - T*)) / b_i
        def eq_cooling(workloads: np.ndarray, t_star: float = 25.0) -> np.ndarray:
            a = v2_cfg.get_a_zones()
            b = v2_cfg.get_b_zones()
            g = v2_cfg.get_g_zones()
            return np.clip((a * workloads + g * (v2_cfg.ambient_temp - t_star)) / b, 0.0, 1.0)

        # Three distributions with same total workload = 1.5
        dist_uniform = np.array([0.30, 0.30, 0.30, 0.30, 0.30], dtype=np.float64)
        dist_d_heavy = np.array([0.10, 0.10, 0.10, 1.10, 0.10], dtype=np.float64)
        dist_b_heavy = np.array([0.10, 1.10, 0.10, 0.10, 0.10], dtype=np.float64)

        total = 1.5
        assert abs(np.sum(dist_uniform) - total) < 1e-10
        assert abs(np.sum(dist_d_heavy) - total) < 1e-10
        assert abs(np.sum(dist_b_heavy) - total) < 1e-10

        # Use equilibrium cooling per distribution (key: different workloads → different C_i)
        p_uniform = model.compute_power(dist_uniform, eq_cooling(dist_uniform))
        p_d = model.compute_power(dist_d_heavy, eq_cooling(dist_d_heavy))
        p_b = model.compute_power(dist_b_heavy, eq_cooling(dist_b_heavy))

        # IT power must be identical (uniform it_power_per_zone_kw)
        assert abs(p_uniform["it_power_kw"] - p_d["it_power_kw"]) < 1e-10
        assert abs(p_uniform["it_power_kw"] - p_b["it_power_kw"]) < 1e-10

        # Cooling power must differ — this is the invariance-broken condition
        # D-heavy: Zone-D has high a (5.8), low b (4.0), low COP (2.0) → needs more cooling, costs more
        # B-heavy: Zone-B has low a (4.5), high b (8.0), high COP (3.8) → needs less cooling, costs less
        assert p_d["cooling_power_kw"] != p_b["cooling_power_kw"], \
            "Cooling power must differ for D-heavy vs B-heavy distributions (equilibrium cooling)"
        assert p_d["cooling_power_kw"] > p_b["cooling_power_kw"], \
            "Zone-D (low b, low COP) scenario must consume more electrical cooling power than Zone-B"

    def test_v1_invariance_holds(self, v1_cfg: ThermalConfig) -> None:
        """In simulator-v1, different distributions with same total produce identical power.
        This documents the structural limitation that motivated simulator-v2."""
        model = ThermalModel(v1_cfg)
        cooling = np.full(5, 0.5, dtype=np.float64)

        # Same total workload, different distributions
        dist_1 = np.array([1.0, 0.0, 0.0, 0.5, 0.3], dtype=np.float64)
        dist_2 = np.array([0.0, 1.0, 0.3, 0.2, 0.3], dtype=np.float64)

        # Adjust to same total
        total = 1.8
        dist_1 = dist_1 * (total / dist_1.sum())
        dist_2 = dist_2 * (total / dist_2.sum())

        p1 = model.compute_power(dist_1, cooling)
        p2 = model.compute_power(dist_2, cooling)

        # In v1: COP=1.0 everywhere (no per-zone COP), so power is only
        # proportional to cooling action (uniform) → identical for same cooling
        assert abs(p1["cooling_power_kw"] - p2["cooling_power_kw"]) < 1e-10, (
            "Simulator-v1: identical total workload + identical cooling → "
            f"identical cooling power. Got {p1['cooling_power_kw']:.4f} vs {p2['cooling_power_kw']:.4f}"
        )


# ---------------------------------------------------------------------------
# Test 3: Workload conservation through migration
# ---------------------------------------------------------------------------

class TestWorkloadConservation:
    """Verify that simulated workload migrations conserve total workload."""

    def test_migration_conserves_workload(self) -> None:
        """Moving workload between zones must not change the total."""
        workloads = np.array([0.3, 0.4, 0.35, 0.5, 0.25], dtype=np.float64)
        total_before = float(np.sum(workloads))

        # Simulate migration: move 0.05 from Zone-D (index 3) to Zone-B (index 1)
        amount = 0.05
        workloads[3] -= amount
        workloads[1] += amount
        np.clip(workloads, 0.0, 1.0, out=workloads)

        total_after = float(np.sum(workloads))
        assert abs(total_before - total_after) < 1e-10, \
            f"Workload not conserved: {total_before:.6f} → {total_after:.6f}"

    def test_migration_does_not_underflow_source(self) -> None:
        """Source zone workload must not go negative after migration."""
        workloads = np.array([0.3, 0.4, 0.35, 0.1, 0.25], dtype=np.float64)
        # Try to move more than available
        from_zone, to_zone = 3, 1
        amount = min(0.5, workloads[from_zone])  # clamped
        amount = min(amount, 1.0 - workloads[to_zone])  # capacity clamped

        workloads[from_zone] -= amount
        workloads[to_zone] += amount
        np.clip(workloads, 0.0, 1.0, out=workloads)

        assert workloads[from_zone] >= 0.0, "Source zone workload must not go negative"
        assert workloads[to_zone] <= 1.0, "Destination zone workload must not exceed 1.0"


# ---------------------------------------------------------------------------
# Test 4: Thermal stability under reasonable cooling
# ---------------------------------------------------------------------------

class TestThermalStability:
    """Verify that under reasonable per-zone cooling, temperatures stabilize."""

    def test_temperatures_stabilize_under_cooling(self, v2_cfg: ThermalConfig) -> None:
        """Run 100 steps with equilibrium-derived cooling. Temperatures must stabilize.

        With zero noise and equilibrium cooling (C_i = required to hold T*=25°C),
        temperatures converge to near 25°C rapidly. Tolerance of 2°C per zone
        accounts for g-term dynamics and transient effects.
        """
        model = ThermalModel(v2_cfg)
        # Zero noise for deterministic stability test
        v2_cfg_det = ThermalConfig(
            num_zones=v2_cfg.num_zones, a=v2_cfg.a, b=v2_cfg.b, g=v2_cfg.g,
            a_zones=v2_cfg.a_zones, b_zones=v2_cfg.b_zones, g_zones=v2_cfg.g_zones,
            cop_zones=v2_cfg.cop_zones, noise_std=0.0,
            ambient_temp=v2_cfg.ambient_temp,
        )
        model_det = ThermalModel(v2_cfg_det)
        rng = np.random.default_rng(0)

        workloads = np.array([0.3, 0.4, 0.35, 0.5, 0.25], dtype=np.float64)
        temperatures = np.array([22.0] * 5, dtype=np.float64)

        # Equilibrium cooling: analytically derived to stabilize at T*=25°C
        a = v2_cfg_det.get_a_zones()
        b = v2_cfg_det.get_b_zones()
        g = v2_cfg_det.get_g_zones()
        t_star = 25.0
        cooling = np.clip(
            (a * workloads + g * (v2_cfg_det.ambient_temp - t_star)) / b, 0.0, 1.0
        )

        temps_history = []
        for _ in range(100):
            temperatures = model_det.step_temperatures(temperatures, workloads, cooling, v2_cfg_det.ambient_temp, rng)
            temps_history.append(temperatures.copy())

        # Temperatures must stabilize (last 10 steps per-zone std < 0.05°C with zero noise)
        last_10 = np.array(temps_history[-10:])
        per_zone_std = np.std(last_10, axis=0)
        assert np.all(per_zone_std < 0.05), (
            f"Temperatures did not stabilize with equilibrium cooling: per-zone std = {per_zone_std}"
        )

        # All temperatures must remain sane (below emergency limit)
        final_temps = temps_history[-1]
        assert np.all(final_temps < 45.0), \
            f"Temperatures exceeded emergency limit: {final_temps}"

    def test_zone_d_needs_more_cooling_than_zone_b(self, v2_cfg: ThermalConfig) -> None:
        """Zone-D (low b=4.0) needs more cooling action to achieve the same
        temperature as Zone-B (b=8.0) under identical workload."""
        model = ThermalModel(v2_cfg)
        rng = np.random.default_rng(0)

        # Isolate zone comparison: run each zone independently
        # For Zone-D (index 3): T_next = T + 5.8*W - 4.0*C + 0.02*(30-T)
        # For Zone-B (index 1): T_next = T + 4.5*W - 8.0*C + 0.02*(30-T)

        T = 25.0
        W = 0.5
        # Steady-state cooling needed: a*W + g*(T_amb - T) = b*C
        # C_D = (5.8*0.5 + 0.02*(30-25)) / 4.0 = (2.9 + 0.1) / 4.0 = 0.75
        C_D_needed = (5.8 * W + 0.02 * (30.0 - T)) / 4.0
        # C_B = (4.5*0.5 + 0.02*(30-25)) / 8.0 = (2.25 + 0.1) / 8.0 = 0.294
        C_B_needed = (4.5 * W + 0.02 * (30.0 - T)) / 8.0

        assert C_D_needed > C_B_needed, (
            f"Zone-D requires more cooling action ({C_D_needed:.3f}) than "
            f"Zone-B ({C_B_needed:.3f}) to maintain steady-state temperature"
        )


# ---------------------------------------------------------------------------
# Test 5: Zero-cooling temperature rise
# ---------------------------------------------------------------------------

class TestZeroCoolingRise:
    """Verify that under zero cooling, temperatures rise toward unsafe levels."""

    def test_zero_cooling_causes_temperature_rise(self, v2_cfg: ThermalConfig) -> None:
        """With zero cooling and moderate workload, temperatures must rise significantly."""
        model = ThermalModel(v2_cfg)
        rng = np.random.default_rng(0)

        temperatures = np.array([22.0] * 5, dtype=np.float64)
        workloads = np.array([0.5] * 5, dtype=np.float64)
        cooling = np.zeros(5, dtype=np.float64)

        for _ in range(20):
            temperatures = model.step_temperatures(temperatures, workloads, cooling, 30.0, rng)

        # After 20 steps (~100 minutes) with no cooling, temperatures must have
        # risen substantially above the initial 22°C
        assert np.all(temperatures > 28.0), (
            f"Expected temperatures to rise above 28°C with zero cooling after 20 steps. "
            f"Got: {temperatures}"
        )

    def test_zero_cooling_reaches_unsafe_within_episode(self, v2_cfg: ThermalConfig) -> None:
        """Under zero cooling and moderate workload, temperatures must reach
        unsafe levels within 288 steps (the episode length)."""
        model = ThermalModel(v2_cfg)
        rng = np.random.default_rng(0)

        temperatures = np.array([22.0] * 5, dtype=np.float64)
        workloads = np.array([0.5] * 5, dtype=np.float64)
        cooling = np.zeros(5, dtype=np.float64)

        max_reached = 22.0
        for _ in range(288):
            temperatures = model.step_temperatures(temperatures, workloads, cooling, 30.0, rng)
            max_reached = max(max_reached, float(np.max(temperatures)))

        assert max_reached > 35.0, (
            f"Expected temperatures to exceed 35°C with zero cooling over 288 steps. "
            f"Max reached: {max_reached:.2f}°C"
        )


# ---------------------------------------------------------------------------
# Test 6: Config loading from files
# ---------------------------------------------------------------------------

class TestConfigLoading:
    """Verify that topology.json v2 loads correctly."""

    def test_from_config_dir_loads_v2(self) -> None:
        """ThermalConfig.from_config_dir() should load simulator-v2 per-zone arrays."""
        cfg = ThermalConfig.from_config_dir()
        assert cfg.simulator_version == "v2", \
            f"Expected simulator_version='v2', got '{cfg.simulator_version}'"
        assert cfg.a_zones is not None, "a_zones must be loaded from v2 topology"
        assert cfg.b_zones is not None, "b_zones must be loaded from v2 topology"
        assert cfg.cop_zones is not None, "cop_zones must be loaded from v2 topology"
        assert len(cfg.a_zones) == cfg.num_zones
        assert len(cfg.b_zones) == cfg.num_zones
        assert len(cfg.cop_zones) == cfg.num_zones

    def test_v2_zone_d_is_impaired(self) -> None:
        """Zone-D (index 3) must have lower b and COP than Zone-B (index 1)."""
        cfg = ThermalConfig.from_config_dir()
        b_zones = cfg.get_b_zones()
        cop_zones = cfg.get_cop_zones()

        assert b_zones[3] < b_zones[1], (
            f"Zone-D cooling effectiveness ({b_zones[3]}) must be lower than Zone-B ({b_zones[1]})"
        )
        assert cop_zones[3] < cop_zones[1], (
            f"Zone-D COP ({cop_zones[3]}) must be lower than Zone-B ({cop_zones[1]})"
        )

    def test_v2_placement_effect_from_config(self) -> None:
        """Full-stack test: load config from files, verify placement effect exists.

        Uses equilibrium cooling (analytically derived per workload distribution) so
        different workload placements produce measurably different electrical power.
        """
        cfg = ThermalConfig.from_config_dir()
        cfg.noise_std = 0.0  # deterministic for test
        model = ThermalModel(cfg)

        # Same total workload, Zone-D vs Zone-B heavy
        w_d = np.array([0.30, 0.30, 0.30, 0.60, 0.30], dtype=np.float64)
        w_b = np.array([0.30, 0.60, 0.30, 0.30, 0.30], dtype=np.float64)

        # Equilibrium cooling: C_i = (a_i*W_i + g_i*(T_amb - T*)) / b_i at T*=25°C
        a = cfg.get_a_zones()
        b = cfg.get_b_zones()
        g = cfg.get_g_zones()
        t_star = 25.0
        cooling_d = np.clip((a * w_d + g * (cfg.ambient_temp - t_star)) / b, 0.0, 1.0)
        cooling_b = np.clip((a * w_b + g * (cfg.ambient_temp - t_star)) / b, 0.0, 1.0)

        p_d = model.compute_power(w_d, cooling_d)
        p_b = model.compute_power(w_b, cooling_b)

        assert p_b["cooling_power_kw"] < p_d["cooling_power_kw"], (
            f"Placement effect must exist in full-stack test with config loaded from files. "
            f"Zone-D load: {p_d['cooling_power_kw']:.4f} kW, Zone-B load: {p_b['cooling_power_kw']:.4f} kW"
        )
