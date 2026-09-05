"""
Gymnasium environment for the data center thermal + workload controller.

Action Space Encoding (PPO-compatible, Box)
--------------------------------------------
The action is a single flat numpy array of shape (N + 3,) where N = num_zones:

    [ c_0, c_1, ..., c_{N-1},  from_zone_raw, to_zone_raw, move_amount ]

    - c_i ∈ [-1, 1]  → mapped to [0, 1] cooling for zone i
    - from_zone_raw ∈ [-1, 1]  → mapped to zone index via floor((x+1)/2 * N), clamped
    - to_zone_raw   ∈ [-1, 1]  → same mapping
    - move_amount   ∈ [-1, 1]  → mapped to [0, max_move_fraction] of from_zone's workload

All actions live in a single continuous Box so SB3's PPO works out-of-the-box.
The workload-move part can be a no-op (from == to, or amount ≈ 0).

Observation Space
-----------------
Flat numpy array of shape (4*N + 2,):

    [ T_0..T_{N-1}, W_0..W_{N-1}, C_prev_0..C_prev_{N-1},
      Cap_0..Cap_{N-1}, ambient_temp, time_step_normalised ]

All values bounded and normalised to ranges friendly for neural nets.
"""

from __future__ import annotations

from typing import Any, Optional

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from engine.physics.thermal_model import ThermalConfig, ThermalModel


class DataCenterEnv(gym.Env):
    """Five-zone data center thermal + workload control environment.

    Implements the full joint action space (cooling + workload placement)
    required by AGENTS.md. The safety shield is NOT applied here — it will
    wrap or call this env in Phase 2.
    """

    metadata = {"render_modes": ["human"]}

    # Maximum fraction of a zone's workload that can be moved per step
    MAX_MOVE_FRACTION: float = 0.2

    def __init__(
        self,
        config: Optional[ThermalConfig] = None,
        render_mode: Optional[str] = None,
    ):
        super().__init__()
        self.cfg = config or ThermalConfig()
        self.render_mode = render_mode
        self.thermal = ThermalModel(self.cfg)

        N = self.cfg.num_zones

        # ---- Action space: N cooling dims + 3 workload-move dims ----
        # All in [-1, 1], re-mapped internally
        self.action_space = spaces.Box(
            low=-1.0,
            high=1.0,
            shape=(N + 3,),
            dtype=np.float32,
        )

        # ---- Observation space ----
        # [temperatures (N), workloads (N), prev_cooling (N),
        #  cooling_capacity (N), ambient_temp (1), time_step_norm (1)]
        obs_size = 4 * N + 2
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(obs_size,),
            dtype=np.float32,
        )

        # ---- Internal state (set in reset) ----
        self._temperatures: np.ndarray = np.zeros(N, dtype=np.float64)
        self._workloads: np.ndarray = np.zeros(N, dtype=np.float64)
        self._prev_cooling: np.ndarray = np.zeros(N, dtype=np.float64)
        self._cooling_capacity: np.ndarray = np.ones(N, dtype=np.float64)
        self._ambient_temp: float = self.cfg.ambient_temp
        self._time_step: int = 0
        self._rng: np.random.Generator = np.random.default_rng()

        # Accumulated power for episode-level metrics
        self._cumulative_it_power: float = 0.0
        self._cumulative_cooling_power: float = 0.0
        self._cumulative_overhead: float = 0.0

    # ------------------------------------------------------------------
    # Gymnasium API
    # ------------------------------------------------------------------

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[dict[str, Any]] = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Reset the environment to initial conditions.

        Parameters
        ----------
        seed    : RNG seed for reproducibility.
        options : Optional overrides, e.g. {"ambient_temp": 40.0}.

        Returns
        -------
        observation, info
        """
        super().reset(seed=seed)
        self._rng = np.random.default_rng(seed)

        N = self.cfg.num_zones
        self._temperatures = np.array(self.cfg.initial_temperatures[:N], dtype=np.float64)
        self._workloads = np.array(self.cfg.initial_workloads[:N], dtype=np.float64)
        self._prev_cooling = np.zeros(N, dtype=np.float64)
        self._cooling_capacity = np.array(self.cfg.default_cooling_capacity[:N], dtype=np.float64)
        self._ambient_temp = self.cfg.ambient_temp
        self._time_step = 0

        self._cumulative_it_power = 0.0
        self._cumulative_cooling_power = 0.0
        self._cumulative_overhead = 0.0

        # Allow overrides via options
        if options:
            if "ambient_temp" in options:
                self._ambient_temp = float(options["ambient_temp"])
            if "initial_workloads" in options:
                self._workloads = np.array(options["initial_workloads"][:N], dtype=np.float64)
            if "cooling_capacity" in options:
                self._cooling_capacity = np.array(options["cooling_capacity"][:N], dtype=np.float64)

        obs = self._get_obs()
        info = self._get_info()
        return obs, info

    def step(
        self, action: np.ndarray
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        """Execute one timestep.

        Parameters
        ----------
        action : flat array of shape (N+3,) — see module docstring.

        Returns
        -------
        observation, reward, terminated, truncated, info
        """
        N = self.cfg.num_zones
        action = np.asarray(action, dtype=np.float64).flatten()

        # --- Decode action ---
        cooling_raw = action[:N]
        from_zone_raw = action[N]
        to_zone_raw = action[N + 1]
        move_amount_raw = action[N + 2]

        # Map cooling from [-1,1] to [0,1], then clip to cooling capacity
        cooling = np.clip((cooling_raw + 1.0) / 2.0, 0.0, 1.0)
        cooling = np.minimum(cooling, self._cooling_capacity)

        # Map workload move indices
        from_zone = int(np.clip(np.floor((from_zone_raw + 1.0) / 2.0 * N), 0, N - 1))
        to_zone = int(np.clip(np.floor((to_zone_raw + 1.0) / 2.0 * N), 0, N - 1))
        move_fraction = float(np.clip((move_amount_raw + 1.0) / 2.0, 0.0, 1.0)) * self.MAX_MOVE_FRACTION

        # --- Apply workload move ---
        self._apply_workload_move(from_zone, to_zone, move_fraction)

        # --- Thermal update ---
        self._temperatures = self.thermal.step_temperatures(
            self._temperatures,
            self._workloads,
            cooling,
            self._ambient_temp,
            self._rng,
        )

        # --- Power accounting ---
        power = self.thermal.compute_power(self._workloads, cooling)
        self._cumulative_it_power += power["it_power_kw"]
        self._cumulative_cooling_power += power["cooling_power_kw"]
        self._cumulative_overhead += power["overhead_kw"]

        # --- Reward ---
        reward = self.thermal.compute_reward(
            self._temperatures,
            self._workloads,
            cooling,
            self._prev_cooling,
        )

        # --- Update bookkeeping ---
        self._prev_cooling = cooling.copy()
        self._time_step += 1

        # --- Termination ---
        terminated = False  # no early termination; shield handles safety
        truncated = self._time_step >= self.cfg.episode_length

        obs = self._get_obs()
        info = self._get_info(power=power)
        return obs, float(reward), terminated, truncated, info

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _apply_workload_move(
        self, from_zone: int, to_zone: int, move_fraction: float
    ) -> None:
        """Move workload between zones, conserving total workload.

        Phase 1: basic input clipping only (no safety shield).
        """
        if from_zone == to_zone or move_fraction < 1e-6:
            return  # no-op

        amount = self._workloads[from_zone] * move_fraction

        # Clip: don't take source below 0 or push destination above 1
        amount = min(amount, self._workloads[from_zone])
        amount = min(amount, 1.0 - self._workloads[to_zone])
        amount = max(amount, 0.0)

        self._workloads[from_zone] -= amount
        self._workloads[to_zone] += amount

        # Defensive clamp to [0, 1]
        np.clip(self._workloads, 0.0, 1.0, out=self._workloads)

    def _get_obs(self) -> np.ndarray:
        """Build the flat observation vector."""
        obs = np.concatenate([
            self._temperatures,
            self._workloads,
            self._prev_cooling,
            self._cooling_capacity,
            [self._ambient_temp],
            [self._time_step / max(self.cfg.episode_length, 1)],  # normalised
        ])
        return obs.astype(np.float32)

    def _get_info(self, power: Optional[dict[str, float]] = None) -> dict[str, Any]:
        """Build the info dict returned by reset/step."""
        total_it = self._cumulative_it_power
        total_cooling = self._cumulative_cooling_power
        total_overhead = self._cumulative_overhead
        total_facility = total_it + total_cooling + total_overhead
        episode_pue = total_facility / total_it if total_it > 1e-9 else 1.0

        info: dict[str, Any] = {
            "temperatures": self._temperatures.copy(),
            "workloads": self._workloads.copy(),
            "prev_cooling": self._prev_cooling.copy(),
            "cooling_capacity": self._cooling_capacity.copy(),
            "ambient_temp": self._ambient_temp,
            "time_step": self._time_step,
            "max_temp": float(np.max(self._temperatures)),
            "total_workload": float(np.sum(self._workloads)),
            "episode_pue": episode_pue,
        }
        if power is not None:
            info["step_power"] = power
        return info

    # ------------------------------------------------------------------
    # Convenience: structured state dict (for API / visualization)
    # ------------------------------------------------------------------

    def get_state_dict(self) -> dict[str, Any]:
        """Return the full state as a dictionary matching the AGENTS.md schema."""
        return {
            "temperatures": self._temperatures.tolist(),
            "workloads": self._workloads.tolist(),
            "cooling_prev": self._prev_cooling.tolist(),
            "cooling_capacity": self._cooling_capacity.tolist(),
            "ambient_temp": self._ambient_temp,
            "time_step": self._time_step,
        }
