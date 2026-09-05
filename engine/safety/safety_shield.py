"""
Deterministic safety shield for the data center controller.

This is a pure function layer that sits between the controller (RL or
rule-based) and the simulator.  It has no learned components.  Every
proposed action passes through here before being executed.

    controller  -->  apply_safety_shield(...)  -->  simulator.step(...)

The shield enforces three constraints, applied in this priority order:

1. **Clamp cooling** to [0, cooling_capacity] per zone.
2. **Over-heat prevention (safety-critical):**  If the predicted
   next-step temperature for a zone would exceed MAX_SAFE_TEMP, force
   that zone's cooling to its maximum available capacity.
3. **Over-cool prevention (efficiency):**  If even at reduced cooling a
   zone's predicted temperature would stay comfortably below the target
   band's lower bound, floor that zone's cooling down to save energy.
   This never overrides constraint 2 -- safety always wins.
4. **Workload-move rejection:**  If the proposed workload move would push
   the destination zone's predicted temperature above MAX_SAFE_TEMP,
   convert the move to a no-op.

Temperature prediction uses the thermal equation with **zero noise**
(worst-case-ish deterministic estimate).  This is intentionally
conservative: the shield should never rely on favourable noise to keep
a zone safe.

Returns
-------
corrected_action : dict
    Same structure as the input action with corrected values.
shield_info : dict
    Per-zone correction type and whether the workload move was rejected.
    Consumed by the frontend decision panel in later phases.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from engine.physics.thermal_model import ThermalConfig, ThermalModel


# ---------------------------------------------------------------------------
# Correction labels (used in shield_info for the frontend decision panel)
# ---------------------------------------------------------------------------
CORRECTION_NONE = "none"
CORRECTION_CAPPED_HIGH = "capped_high"       # cooling forced to max (overheat risk)
CORRECTION_FLOORED_LOW = "floored_low"        # cooling reduced (over-cooling waste)
CORRECTION_MOVE_REJECTED = "move_rejected"    # workload move blocked


def apply_safety_shield(
    proposed_action: dict[str, Any],
    current_state: dict[str, Any],
    config: ThermalConfig,
    *,
    bypass: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Apply all safety constraints to a proposed action.

    Parameters
    ----------
    proposed_action : dict with keys:
        "cooling"       : np.ndarray (N,) in [0, 1]
        "from_zone"     : int   (source zone index for workload move)
        "to_zone"       : int   (destination zone index)
        "move_fraction" : float (fraction of source zone's workload to move)
    current_state : dict with keys matching env.get_state_dict():
        "temperatures"     : list/ndarray (N,)
        "workloads"        : list/ndarray (N,)
        "cooling_prev"     : list/ndarray (N,)  (unused by shield, present for completeness)
        "cooling_capacity" : list/ndarray (N,)
        "ambient_temp"     : float
        "time_step"        : int                (unused by shield)
    config : ThermalConfig
        Provides thermal coefficients and safety thresholds.
    bypass : bool
        If True, skip all corrections and return the action as-is.
        **Must be explicitly set to True** -- never the default.
        Intended only for raw-policy diagnostics during training.

    Returns
    -------
    corrected_action : dict  (same keys as proposed_action)
    shield_info : dict with keys:
        "zone_corrections" : list[str] of length N
            Per-zone label: "none", "capped_high", or "floored_low"
        "move_rejected"    : bool
        "corrections_applied" : int  (total number of corrections)
    """
    N = config.num_zones
    model = ThermalModel(config)

    # --- Unpack state ---
    temperatures = np.asarray(current_state["temperatures"], dtype=np.float64)
    workloads = np.asarray(current_state["workloads"], dtype=np.float64)
    cooling_capacity = np.asarray(current_state["cooling_capacity"], dtype=np.float64)
    ambient_temp = float(current_state["ambient_temp"])

    # --- Copy proposed action ---
    cooling = np.array(proposed_action["cooling"], dtype=np.float64).copy()
    from_zone = int(proposed_action["from_zone"])
    to_zone = int(proposed_action["to_zone"])
    move_fraction = float(proposed_action["move_fraction"])

    # --- Initialize tracking ---
    zone_corrections: list[str] = [CORRECTION_NONE] * N
    move_rejected = False
    corrections_applied = 0

    # --- Bypass mode (training diagnostics only) ---
    if bypass:
        corrected = {
            "cooling": cooling,
            "from_zone": from_zone,
            "to_zone": to_zone,
            "move_fraction": move_fraction,
        }
        info = {
            "zone_corrections": zone_corrections,
            "move_rejected": False,
            "corrections_applied": 0,
        }
        return corrected, info

    # ==================================================================
    # CONSTRAINT 1: Clamp cooling to [0, cooling_capacity]
    # ==================================================================
    cooling = np.clip(cooling, 0.0, cooling_capacity)

    # Predictor model with zero noise and per-zone coefficients from config.
    # Uses simulator-v2 per-zone arrays (a_i, b_i, g_i) if present; falls back
    # to global scalars for v1 backward-compatibility — matches the physical
    # simulator exactly.
    zero_noise_cfg = ThermalConfig(
        num_zones=N,
        a=config.a,
        b=config.b,
        g=config.g,
        noise_std=0.0,
        a_zones=config.a_zones,
        b_zones=config.b_zones,
        g_zones=config.g_zones,
        cop_zones=config.cop_zones,
        adjacency_matrix=config.adjacency_matrix,
        cooling_power_max_kw_per_zone=config.cooling_power_max_kw_per_zone,
    )
    predictor = ThermalModel(zero_noise_cfg)
    dummy_rng = np.random.default_rng(0)

    # Safety margin of 0.5C (5 * noise_std) to account for Gaussian noise
    # in the physical environment, achieving zero emergency violations across the tested seeds.
    SAFETY_MARGIN = 0.5

    # ==================================================================
    # CONSTRAINT 2: Workload-move rejection
    # If a proposed workload move would push destination zone temperature
    # above MAX_SAFE_TEMP (accounting for safety margin), reject the move
    # entirely (convert to no-op).  This is evaluated before cooling
    # overrides so that emergency cooling doesn't falsely enable unsafe moves.
    # ==================================================================
    effective_workloads = workloads.copy()
    if from_zone != to_zone and move_fraction > 1e-6:
        # Simulate the workload transfer
        test_workloads = workloads.copy()
        amount = test_workloads[from_zone] * move_fraction
        amount = min(amount, test_workloads[from_zone])
        amount = min(amount, 1.0 - test_workloads[to_zone])
        amount = max(amount, 0.0)

        test_workloads[from_zone] -= amount
        test_workloads[to_zone] += amount

        # Predict destination zone temperature after the move
        predicted_dest = predictor.step_temperatures(
            temperatures, test_workloads, cooling, ambient_temp,
            dummy_rng,
        )

        if predicted_dest[to_zone] > (config.max_safe_temp - SAFETY_MARGIN):
            # Reject the move -- convert to no-op
            from_zone = 0
            to_zone = 0
            move_fraction = 0.0
            move_rejected = True
            corrections_applied += 1
        else:
            effective_workloads = test_workloads

    # ==================================================================
    # CONSTRAINT 3 (safety-critical): Over-heat prevention
    # Predict next-step temperature under effective workloads.  If any zone
    # would exceed MAX_SAFE_TEMP, force that zone's cooling to max capacity.
    # ==================================================================
    predicted_temps = predictor.step_temperatures(
        temperatures, effective_workloads, cooling, ambient_temp, dummy_rng,
    )

    for i in range(N):
        if predicted_temps[i] > (config.max_safe_temp - SAFETY_MARGIN):
            cooling[i] = cooling_capacity[i]
            zone_corrections[i] = CORRECTION_CAPPED_HIGH
            corrections_applied += 1

    # ==================================================================
    # CONSTRAINT 4 (efficiency): Over-cool prevention
    # If a zone's predicted temp even with *zero* cooling would be below
    # target_temp_low, then cooling is wasteful.  Find the minimum
    # cooling that keeps the zone near target_temp_low and floor there.
    #
    # Only applies to zones NOT already capped high (safety wins).
    # ==================================================================

    # Predict temperature with zero cooling to find uncooled trajectory
    zero_cooling = np.zeros(N, dtype=np.float64)
    predicted_temps_no_cool = predictor.step_temperatures(
        temperatures, effective_workloads, zero_cooling, ambient_temp,
        dummy_rng,
    )

    # Per-zone coefficients for analytical floor calculation (v2 or v1 fallback)
    a_zones_arr = config.get_a_zones()
    b_zones_arr = config.get_b_zones()
    g_zones_arr = config.get_g_zones()

    for i in range(N):
        if zone_corrections[i] == CORRECTION_CAPPED_HIGH:
            continue  # safety override already applied -- don't touch

        if predicted_temps_no_cool[i] < config.target_temp_low:
            # Zone is cold even without cooling -- floor cooling to zero
            if cooling[i] > 0.0:
                cooling[i] = 0.0
                zone_corrections[i] = CORRECTION_FLOORED_LOW
                corrections_applied += 1
        else:
            # Zone needs *some* cooling.  Check if proposed cooling would
            # push it far below the target band.
            predicted_with_proposed = predictor.step_temperatures(
                temperatures[i:i+1], effective_workloads[i:i+1], cooling[i:i+1],
                ambient_temp, dummy_rng,
            )[0]

            if predicted_with_proposed < config.target_temp_low:
                # Analytically solve for the cooling that lands exactly at
                # target_temp_low using per-zone a_i, b_i, g_i:
                #   T_target = T_cur + a_i*W - b_i*c + g_i*(T_amb - T_cur)
                #   c = (T_cur + a_i*W + g_i*(T_amb - T_cur) - T_target) / b_i
                ai = float(a_zones_arr[i])
                bi = float(b_zones_arr[i])
                gi = float(g_zones_arr[i])
                needed = (
                    temperatures[i]
                    + ai * effective_workloads[i]
                    + gi * (ambient_temp - temperatures[i])
                    - config.target_temp_low
                ) / bi

                needed = float(np.clip(needed, 0.0, cooling_capacity[i]))

                if needed < cooling[i]:
                    cooling[i] = needed
                    zone_corrections[i] = CORRECTION_FLOORED_LOW
                    corrections_applied += 1


    # ==================================================================
    # Build result
    # ==================================================================
    corrected_action = {
        "cooling": cooling,
        "from_zone": from_zone,
        "to_zone": to_zone,
        "move_fraction": move_fraction,
    }

    shield_info = {
        "zone_corrections": zone_corrections,
        "move_rejected": move_rejected,
        "corrections_applied": corrections_applied,
    }

    return corrected_action, shield_info


# ---------------------------------------------------------------------------
# Helper: decode the flat PPO action into the dict the shield expects
# ---------------------------------------------------------------------------

def decode_raw_action(
    raw_action: np.ndarray,
    num_zones: int,
    cooling_capacity: np.ndarray,
    max_move_fraction: float = 0.2,
) -> dict[str, Any]:
    """Convert a flat Box action from the env action space to a shield-compatible dict.

    Parameters
    ----------
    raw_action       : (N+3,) flat array in [-1, 1]
    num_zones        : N
    cooling_capacity : (N,) current capacity per zone
    max_move_fraction: maximum fraction of workload that can be moved

    Returns
    -------
    dict with keys: cooling, from_zone, to_zone, move_fraction
    """
    N = num_zones
    raw = np.asarray(raw_action, dtype=np.float64).flatten()

    cooling = np.clip((raw[:N] + 1.0) / 2.0, 0.0, 1.0)
    cooling = np.minimum(cooling, cooling_capacity)

    from_zone = int(np.clip(np.floor((raw[N] + 1.0) / 2.0 * N), 0, N - 1))
    to_zone = int(np.clip(np.floor((raw[N + 1] + 1.0) / 2.0 * N), 0, N - 1))
    move_fraction = float(np.clip((raw[N + 2] + 1.0) / 2.0, 0.0, 1.0)) * max_move_fraction

    return {
        "cooling": cooling,
        "from_zone": from_zone,
        "to_zone": to_zone,
        "move_fraction": move_fraction,
    }
