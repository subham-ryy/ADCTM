"""
Unit tests for the safety shield (engine/safety/safety_shield.py).

Covers the four required cases:
(a) Unsafe cooling that would let a zone overheat -> overridden to max
(b) Wasteful over-cooling on a cold zone -> floored down
(c) Workload move that would overheat destination -> rejected
(d) A safe action -> passes through unmodified

Plus additional edge cases:
- Bypass flag passes actions through untouched
- Reduced cooling capacity is respected
- Shield info structure is correct
"""

import numpy as np
import pytest

from engine.physics.thermal_model import ThermalConfig, ThermalModel
from engine.safety.safety_shield import (
    CORRECTION_CAPPED_HIGH,
    CORRECTION_FLOORED_LOW,
    CORRECTION_MOVE_REJECTED,
    CORRECTION_NONE,
    apply_safety_shield,
    decode_raw_action,
)


def _make_config(**overrides) -> ThermalConfig:
    """Create a ThermalConfig with zero noise for deterministic tests."""
    defaults = dict(
        num_zones=5,
        a=5.0,
        b=6.0,
        g=0.02,
        noise_std=0.0,
        initial_temperatures=[22.0] * 5,
        initial_workloads=[0.5] * 5,
        ambient_temp=30.0,
        target_temp_low=18.0,
        target_temp_high=27.0,
        max_safe_temp=45.0,
        episode_length=288,
    )
    defaults.update(overrides)
    return ThermalConfig(**defaults)


def _make_state(
    temperatures: list[float],
    workloads: list[float] | None = None,
    cooling_capacity: list[float] | None = None,
    ambient_temp: float = 30.0,
) -> dict:
    N = len(temperatures)
    return {
        "temperatures": temperatures,
        "workloads": workloads or [0.5] * N,
        "cooling_prev": [0.0] * N,
        "cooling_capacity": cooling_capacity or [1.0] * N,
        "ambient_temp": ambient_temp,
        "time_step": 0,
    }


def _make_action(
    cooling: list[float],
    from_zone: int = 0,
    to_zone: int = 0,
    move_fraction: float = 0.0,
) -> dict:
    return {
        "cooling": np.array(cooling, dtype=np.float64),
        "from_zone": from_zone,
        "to_zone": to_zone,
        "move_fraction": move_fraction,
    }


class TestOverheatPrevention:
    """(a) Unsafe cooling that would let a zone overheat -> overridden."""

    def test_zone_near_max_safe_with_zero_cooling(self):
        """Zone at 43C with high workload and zero cooling would exceed 45C.
        Shield must force cooling to max."""
        cfg = _make_config()
        # T_next = 43 + 5*0.8 - 6*0 + 0.02*(30-43) = 43 + 4 - 0 - 0.26 = 46.74 > 45
        state = _make_state(
            temperatures=[43.0, 22.0, 22.0, 22.0, 22.0],
            workloads=[0.8, 0.3, 0.3, 0.3, 0.3],
        )
        action = _make_action(cooling=[0.0, 0.3, 0.3, 0.3, 0.3])

        corrected, info = apply_safety_shield(action, state, cfg)

        assert corrected["cooling"][0] == 1.0, (
            f"Zone 0 cooling should be forced to max, got {corrected['cooling'][0]}"
        )
        assert info["zone_corrections"][0] == CORRECTION_CAPPED_HIGH
        assert info["corrections_applied"] >= 1

    def test_multiple_zones_overheating(self):
        """Multiple zones near limit -- all should be capped."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[44.0, 44.0, 22.0, 22.0, 22.0],
            workloads=[0.8, 0.8, 0.2, 0.2, 0.2],
        )
        action = _make_action(cooling=[0.1, 0.1, 0.3, 0.3, 0.3])

        corrected, info = apply_safety_shield(action, state, cfg)

        assert corrected["cooling"][0] == 1.0
        assert corrected["cooling"][1] == 1.0
        assert info["zone_corrections"][0] == CORRECTION_CAPPED_HIGH
        assert info["zone_corrections"][1] == CORRECTION_CAPPED_HIGH

    def test_overheat_with_reduced_capacity(self):
        """Cooling forced to max available (0.6), not 1.0, during failure."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[44.0, 22.0, 22.0, 22.0, 22.0],
            workloads=[0.5, 0.3, 0.3, 0.3, 0.3],
            cooling_capacity=[0.6, 1.0, 1.0, 1.0, 1.0],
        )
        action = _make_action(cooling=[0.1, 0.3, 0.3, 0.3, 0.3])

        corrected, info = apply_safety_shield(action, state, cfg)

        assert corrected["cooling"][0] == 0.6, (
            f"Zone 0 should be capped at capacity 0.6, got {corrected['cooling'][0]}"
        )
        assert info["zone_corrections"][0] == CORRECTION_CAPPED_HIGH


class TestOvercoolPrevention:
    """(b) Wasteful over-cooling on a cold zone -> floored down."""

    def test_cold_zone_with_full_cooling(self):
        """Zone at 10C (well below target_low=18) with full cooling is wasteful.
        Even with zero cooling, T_next = 10 + 5*0.1 + 0.02*(30-10) = 10.9 < 18.
        Shield should floor cooling to zero."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[10.0, 25.0, 25.0, 25.0, 25.0],
            workloads=[0.1, 0.5, 0.5, 0.5, 0.5],
        )
        action = _make_action(cooling=[1.0, 0.5, 0.5, 0.5, 0.5])

        corrected, info = apply_safety_shield(action, state, cfg)

        assert corrected["cooling"][0] == 0.0, (
            f"Zone 0 cooling should be floored to 0, got {corrected['cooling'][0]}"
        )
        assert info["zone_corrections"][0] == CORRECTION_FLOORED_LOW

    def test_mild_overcooling_floors_to_needed(self):
        """Zone where proposed cooling would push temp below target_low,
        but zone needs *some* cooling to stay near target_low.
        Shield should solve for minimum needed cooling analytically."""
        cfg = _make_config()
        # T_next without cooling = 24 + 5*0.3 + 0.02*(30-24) = 24 + 1.5 + 0.12 = 25.62
        # That's above target_low (18), so zone does need cooling.
        # But with cooling=1.0: T_next = 24 + 1.5 - 6.0 + 0.12 = 19.62 -- wait, that's above 18.
        # Let's use a case that clearly over-cools:
        # temp=20, workload=0.1: T_next(c=0) = 20+0.5+0.2 = 20.7 > 18, needs some cooling
        # T_next(c=1.0) = 20+0.5-6+0.2 = 14.7 < 18 -> over-cooling!
        state = _make_state(
            temperatures=[20.0, 25.0, 25.0, 25.0, 25.0],
            workloads=[0.1, 0.5, 0.5, 0.5, 0.5],
        )
        action = _make_action(cooling=[1.0, 0.5, 0.5, 0.5, 0.5])

        corrected, info = apply_safety_shield(action, state, cfg)

        # Cooling should be reduced (not zero, since zone needs some)
        assert corrected["cooling"][0] < 1.0, "Should be reduced from 1.0"
        assert corrected["cooling"][0] >= 0.0, "Should not go negative"
        assert info["zone_corrections"][0] == CORRECTION_FLOORED_LOW

        # Verify: predicted temp with corrected cooling should be near target_low
        predictor = ThermalModel(ThermalConfig(
            num_zones=1, a=cfg.a, b=cfg.b, g=cfg.g, noise_std=0.0
        ))
        t_pred = predictor.step_temperatures(
            np.array([20.0]), np.array([0.1]),
            np.array([corrected["cooling"][0]]),
            30.0, np.random.default_rng(0),
        )[0]
        assert abs(t_pred - cfg.target_temp_low) < 0.1, (
            f"Predicted temp {t_pred} should be near target_low {cfg.target_temp_low}"
        )

    def test_safety_wins_over_efficiency(self):
        """If a zone is both dangerously hot AND the over-cool check might
        trigger on another zone, safety cap takes priority."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[44.0, 10.0, 25.0, 25.0, 25.0],
            workloads=[0.8, 0.1, 0.5, 0.5, 0.5],
        )
        action = _make_action(cooling=[0.0, 1.0, 0.5, 0.5, 0.5])

        corrected, info = apply_safety_shield(action, state, cfg)

        # Zone 0: safety cap (overheating)
        assert corrected["cooling"][0] == 1.0
        assert info["zone_corrections"][0] == CORRECTION_CAPPED_HIGH

        # Zone 1: efficiency floor (over-cooling)
        assert corrected["cooling"][1] < 1.0
        assert info["zone_corrections"][1] == CORRECTION_FLOORED_LOW


class TestWorkloadMoveRejection:
    """(c) Workload move that would overheat destination -> rejected."""

    def test_move_to_hot_zone_rejected(self):
        """Moving workload to a zone already near max_safe_temp should be blocked.
        Zone 3 at 44C, workload=0.8, cooling=0.2:
        Without move: T_next = 44 + 5*0.8 - 6*0.2 + 0.02*(30-44) = 44+4-1.2-0.28 = 46.52 > 45
        Even without the move it would overheat, so shield caps cooling.
        But with a move adding more workload, the predicted temp is even higher.
        We need a case where the zone is SAFE without the move but UNSAFE with it.

        Zone 3: T=42, workload=0.5, cooling=0.5
        Without move: T_next = 42 + 5*0.5 - 6*0.5 + 0.02*(30-42) = 42+2.5-3-0.24 = 41.26 < 45 (safe)
        Move 0.15 of zone 0 workload (0.8*0.15=0.12) to zone 3 -> workload=0.62
        With move:    T_next = 42 + 5*0.62 - 6*0.5 + 0.02*(30-42) = 42+3.1-3-0.24 = 41.86 < 45 (still safe)
        Need higher workload or temp. Try T=43.5, workload=0.7, cooling=0.1:
        Without move: T_next = 43.5 + 5*0.7 - 6*0.1 + 0.02*(30-43.5) = 43.5+3.5-0.6-0.27 = 46.13 > 45
        That triggers overheat cap first. Use cooling=0.5:
        Without move: T_next = 43.5 + 5*0.7 - 6*0.5 + 0.02*(30-43.5) = 43.5+3.5-3-0.27 = 43.73 < 45 (safe)
        With move (add 0.12): workload=0.82
        T_next = 43.5 + 5*0.82 - 6*0.5 + 0.02*(30-43.5) = 43.5+4.1-3-0.27 = 44.33 < 45 (still safe!)
        Need to push harder. T=44, workload=0.8, cooling=0.3:
        Without move: T_next = 44 + 5*0.8 - 6*0.3 + 0.02*(30-44) = 44+4-1.8-0.28 = 45.92 > 45
        That's unsafe without move. We need the *marginal* move to be the thing that tips it.
        T=43, workload=0.6, cooling=0.25:
        Without move: T_next = 43 + 5*0.6 - 6*0.25 + 0.02*(30-43) = 43+3-1.5-0.26 = 44.24 < 45 (safe)
        With move (0.12 added): workload=0.72
        T_next = 43 + 5*0.72 - 6*0.25 + 0.02*(30-43) = 43+3.6-1.5-0.26 = 44.84 < 45 (still safe!)
        Try larger move or more extreme. T=43, workload=0.7, cooling=0.15:
        Without move: T_next = 43 + 5*0.7 - 6*0.15 + 0.02*(30-43) = 43+3.5-0.9-0.26 = 45.34 > 45
        Unsafe without move. Let's use T=43, workload=0.55, cooling=0.1:
        Without: T_next = 43+2.75-0.6-0.26 = 44.89 < 45 (safe)
        With 20% of zone 0's 0.9 workload (0.18) added: workload=0.73
        T_next = 43+3.65-0.6-0.26 = 45.79 > 45 (UNSAFE!)
        """
        cfg = _make_config()
        state = _make_state(
            temperatures=[22.0, 22.0, 22.0, 43.0, 22.0],
            workloads=[0.9, 0.3, 0.3, 0.55, 0.3],
        )
        # Move workload from zone 0 to zone 3 with large fraction
        action = _make_action(
            cooling=[0.5, 0.5, 0.5, 0.1, 0.5],
            from_zone=0,
            to_zone=3,
            move_fraction=0.2,
        )

        corrected, info = apply_safety_shield(action, state, cfg)

        assert info["move_rejected"] is True
        assert corrected["from_zone"] == corrected["to_zone"], "Move should be no-op"
        assert corrected["move_fraction"] == 0.0

    def test_safe_move_passes_through(self):
        """Moving workload to a cool zone with low load should be allowed."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[22.0, 22.0, 22.0, 22.0, 22.0],
            workloads=[0.8, 0.3, 0.3, 0.1, 0.3],
        )
        # Move from zone 0 to zone 3 (cool and lightly loaded)
        action = _make_action(
            cooling=[0.5, 0.5, 0.5, 0.5, 0.5],
            from_zone=0,
            to_zone=3,
            move_fraction=0.1,
        )

        corrected, info = apply_safety_shield(action, state, cfg)

        assert info["move_rejected"] is False
        assert corrected["from_zone"] == 0
        assert corrected["to_zone"] == 3
        assert corrected["move_fraction"] == 0.1


class TestSafeActionPassthrough:
    """(d) A safe action passes through unmodified."""

    def test_safe_action_unchanged(self):
        """Normal temps, moderate cooling, no move -> no corrections."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[25.0, 24.0, 26.0, 23.0, 25.0],
            workloads=[0.5, 0.4, 0.5, 0.3, 0.4],
        )
        cooling_vals = [0.4, 0.35, 0.45, 0.3, 0.35]
        action = _make_action(cooling=cooling_vals)

        corrected, info = apply_safety_shield(action, state, cfg)

        # Check cooling wasn't modified (verify this action IS safe first)
        predictor = ThermalModel(ThermalConfig(
            num_zones=5, a=cfg.a, b=cfg.b, g=cfg.g, noise_std=0.0,
        ))
        predicted = predictor.step_temperatures(
            np.array(state["temperatures"]),
            np.array(state["workloads"]),
            np.array(cooling_vals),
            state["ambient_temp"],
            np.random.default_rng(0),
        )
        # Verify this truly is a safe scenario
        assert np.all(predicted <= cfg.max_safe_temp), "Test setup error: action isn't safe"
        assert np.all(predicted >= cfg.target_temp_low), "Test setup error: action over-cools"

        np.testing.assert_array_almost_equal(
            corrected["cooling"], cooling_vals,
            err_msg="Safe action should pass through unmodified",
        )
        assert all(c == CORRECTION_NONE for c in info["zone_corrections"])
        assert info["corrections_applied"] == 0
        assert info["move_rejected"] is False


class TestBypassFlag:
    """Bypass mode passes actions through untouched."""

    def test_bypass_skips_all_corrections(self):
        """Even a dangerous action passes through with bypass=True."""
        cfg = _make_config()
        state = _make_state(
            temperatures=[44.0, 44.0, 44.0, 44.0, 44.0],
            workloads=[1.0, 1.0, 1.0, 1.0, 1.0],
        )
        action = _make_action(cooling=[0.0, 0.0, 0.0, 0.0, 0.0])

        corrected, info = apply_safety_shield(action, state, cfg, bypass=True)

        np.testing.assert_array_equal(corrected["cooling"], [0.0] * 5)
        assert info["corrections_applied"] == 0


class TestDecodeRawAction:
    """Test the flat-action to dict decoder helper."""

    def test_round_trip_shapes(self):
        raw = np.zeros(8, dtype=np.float32)  # 5 + 3
        result = decode_raw_action(raw, 5, np.ones(5))
        assert result["cooling"].shape == (5,)
        assert isinstance(result["from_zone"], int)
        assert isinstance(result["to_zone"], int)
        assert isinstance(result["move_fraction"], float)

    def test_cooling_maps_correctly(self):
        """raw=-1 -> cooling=0, raw=+1 -> cooling=1."""
        raw = np.array([-1, -1, -1, -1, -1, 0, 0, 0], dtype=np.float32)
        result = decode_raw_action(raw, 5, np.ones(5))
        np.testing.assert_array_almost_equal(result["cooling"], [0.0] * 5)

        raw = np.array([1, 1, 1, 1, 1, 0, 0, 0], dtype=np.float32)
        result = decode_raw_action(raw, 5, np.ones(5))
        np.testing.assert_array_almost_equal(result["cooling"], [1.0] * 5)


class TestShieldInfoStructure:
    """Shield info dict has the correct structure."""

    def test_info_keys(self):
        cfg = _make_config()
        state = _make_state(temperatures=[25.0] * 5)
        action = _make_action(cooling=[0.5] * 5)

        _, info = apply_safety_shield(action, state, cfg)

        assert "zone_corrections" in info
        assert "move_rejected" in info
        assert "corrections_applied" in info
        assert len(info["zone_corrections"]) == 5
        assert isinstance(info["move_rejected"], bool)
        assert isinstance(info["corrections_applied"], int)
