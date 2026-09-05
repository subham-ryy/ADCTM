"""
Rule-based baseline controller for the data center.

A fixed-threshold controller with no learning.  Cooling is set
proportional to how far each zone's temperature is above the target
band, saturating at full cooling near MAX_SAFE_TEMP and near-zero
cooling when comfortably within the band.

No workload movement -- this baseline only controls cooling, by design.
It represents what a real ops team's static thresholds look like today.

Simulator-v2 note: This controller has 100% SLA and zero violations in all
tested scenarios. It cannot exploit zone heterogeneity because it never moves
workload. In simulator-v2, with per-zone COP and cooling-effectiveness
coefficients, a joint RL controller that migrates workload from impaired zones
(low b_i, low COP) to efficient zones (high b_i, high COP) should be able to
achieve lower total electrical cooling power — which is the advantage that
joint RL is designed to demonstrate. The rule-based controller is a challenging,
not a trivially weak, baseline.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from engine.physics.thermal_model import ThermalConfig


class RuleBasedController:
    """Proportional-threshold cooling controller.

    Policy per zone:
        - temp <= target_temp_high : cooling = base_idle  (near-zero)
        - target_temp_high < temp < max_safe_temp :
              cooling = linear ramp from base_idle to 1.0
        - temp >= max_safe_temp : cooling = 1.0  (full blast)

    Cooling is then clamped to [0, cooling_capacity].
    No workload movement is ever proposed.
    """

    # Small residual cooling even at safe temps (keeps some airflow)
    BASE_IDLE_COOLING: float = 0.05

    def __init__(self, config: ThermalConfig):
        self.cfg = config

    def act(self, state: dict[str, Any]) -> dict[str, Any]:
        """Given the current state dict, return a proposed action dict.

        Parameters
        ----------
        state : dict matching env.get_state_dict() keys

        Returns
        -------
        action : dict with keys matching safety shield input:
            cooling, from_zone, to_zone, move_fraction
        """
        temperatures = np.asarray(state["temperatures"], dtype=np.float64)
        cooling_capacity = np.asarray(state["cooling_capacity"], dtype=np.float64)
        N = len(temperatures)

        cooling = np.zeros(N, dtype=np.float64)
        t_low = self.cfg.target_temp_high   # lower edge of the ramp
        t_high = self.cfg.max_safe_temp     # upper edge -- full cooling

        for i in range(N):
            t = temperatures[i]
            if t <= t_low:
                cooling[i] = self.BASE_IDLE_COOLING
            elif t >= t_high:
                cooling[i] = 1.0
            else:
                # Linear ramp between [base_idle, 1.0]
                frac = (t - t_low) / (t_high - t_low)
                cooling[i] = self.BASE_IDLE_COOLING + frac * (1.0 - self.BASE_IDLE_COOLING)

        # Clamp to available capacity
        cooling = np.minimum(cooling, cooling_capacity)

        return {
            "cooling": cooling,
            "from_zone": 0,
            "to_zone": 0,
            "move_fraction": 0.0,
        }

    def act_raw(self, state: dict[str, Any], num_zones: int) -> np.ndarray:
        """Return a flat raw action array compatible with env.step().

        Maps the dict-style action back into the [-1, 1] flat Box encoding.
        """
        action_dict = self.act(state)
        N = num_zones
        raw = np.zeros(N + 3, dtype=np.float32)

        # cooling: [0,1] -> [-1,1]
        raw[:N] = action_dict["cooling"].astype(np.float32) * 2.0 - 1.0

        # workload move: no-op (from_zone == to_zone == 0, amount = 0)
        # Map zone 0 back: raw = 2*(0+0.5)/N - 1
        raw[N] = 2.0 * 0.5 / N - 1.0
        raw[N + 1] = 2.0 * 0.5 / N - 1.0
        raw[N + 2] = -1.0  # amount = 0

        return raw
