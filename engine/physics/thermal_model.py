"""
Test-validated synthetic thermal simulation model for the data center digital twin.

Simulator Version
-----------------
This module supports two simulator modes:

**Simulator-v1 (legacy):** All zones share identical thermal coefficients (global scalars
a, b, g). Under conserved total workload, total cooling demand is mathematically
invariant to workload placement — migration cannot create a PUE advantage.
Simulator-v1 results (archived in outputs/phase4_final_benchmark_results.json) are
historical and not directly comparable to simulator-v2 results.

**Simulator-v2 (current):** Zones have independently configurable heat-gain coefficients
(a_i), cooling-effectiveness coefficients (b_i), ambient-coupling coefficients (g_i),
and cooling-unit electrical efficiency (COP_i). This breaks the placement invariance:
moving workload from a thermally-impaired or electrically-inefficient zone (e.g., Zone-D:
b_D=4.0, COP_D=2.0) to an efficient zone (e.g., Zone-B: b_B=8.0, COP_B=3.8) measurably
reduces total electrical cooling power, even with identical total heat load.

All zone-specific parameters are SYNTHETIC ASSUMPTIONS, documented in config/topology.json,
frozen before any training run. Parameters are NOT chosen by running RL until it wins.

Thermal Update Equation (per zone, per timestep)
-------------------------------------------------
    T_next_i = T_i + a_i * W_i - b_i * C_i + g_i * (T_amb - T_i) + noise_i

where a_i, b_i, g_i are per-zone coefficients loaded from topology.json.

Power Accounting
----------------
    IT Power   = sum(W_i * it_power_per_zone_kw)         [kW, proportional to workload]
    Cooling Electrical Power = sum(thermal_removal_i / COP_i)
                            = sum(C_i * cooling_power_max_kw_i / COP_i)  [kW]
    Overhead   = IT Power * overhead_fraction
    Total Facility Power = IT + Cooling Electrical + Overhead
    PUE = Total Facility Power / IT Power

Historical Note on Energy Accounting
--------------------------------------
Earlier Phase 2 & 3 reporting cited ~7,525 kWh for 288-step episodes. That quantity
represented the instantaneous power sum in kW-steps (sum of kW across steps).
With authoritative timestep Delta_t = 300.0 seconds (5 minutes, 288 steps = 24.0 hours),
true integrated energy is:
    Energy (kWh) = sum(Power_t in kW) * (300.0 / 3600.0) = sum(Power_t) * (5 / 60)
which scales 7,525 kW-steps to ~627.1 kWh.
The dimensionless PUE ratio (Total Energy / IT Energy) is identical in both units.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# Authoritative simulation timestep and energy conversion
# ---------------------------------------------------------------------------
TIMESTEP_SECONDS: float = 300.0  # 5 minutes per step (288 steps = 24 hours)


def power_to_energy_kwh(power_kw: float, timestep_seconds: float = TIMESTEP_SECONDS) -> float:
    """Convert power in kW over one simulation step to energy in kWh.

    Energy (kWh) = Power (kW) * (timestep_seconds / 3600.0)
    """
    return float(power_kw * (timestep_seconds / 3600.0))


# ---------------------------------------------------------------------------
# Default config path (relative to repo root)
# ---------------------------------------------------------------------------
_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


@dataclass
class ThermalConfig:
    """All tuneable parameters for the thermal simulation.

    Can be loaded from config/topology.json + config/thresholds.json or
    constructed directly for tests.

    Simulator-v2 extends the v1 configuration with per-zone arrays for
    heat gain (a_zones), cooling effectiveness (b_zones), ambient coupling
    (g_zones), COP (cop_zones), and an adjacency matrix for thermal
    recirculation. All per-zone values are SYNTHETIC ASSUMPTIONS.
    """

    # --- Zone layout ---
    num_zones: int = 5

    # --- Global thermal coefficients (v1 backward-compatibility, used as fallback) ---
    a: float = 5.0       # heat generated per unit workload per step
    b: float = 6.0       # heat removed per unit cooling per step
    g: float = 0.02      # ambient coupling coefficient

    # --- Per-zone thermal coefficients (simulator-v2) ---
    # SYNTHETIC ASSUMPTIONS: frozen before training. See config/topology.json.
    # If None, falls back to global scalar for all zones.
    a_zones: Optional[list[float]] = None   # per-zone heat-gain coefficients
    b_zones: Optional[list[float]] = None   # per-zone cooling-effectiveness coefficients
    g_zones: Optional[list[float]] = None   # per-zone ambient-coupling coefficients
    cop_zones: Optional[list[float]] = None  # per-zone cooling unit COP (electrical efficiency)
    adjacency_matrix: Optional[list[list[float]]] = None  # thermal recirculation (NxN)

    # Maximum thermal power removal per zone cooling unit [kW] — used with COP
    cooling_power_max_kw_per_zone: Optional[list[float]] = None

    # --- Noise ---
    noise_std: float = 0.1

    # --- Initial conditions ---
    initial_temperatures: list[float] = field(default_factory=lambda: [22.0] * 5)
    initial_workloads: list[float] = field(default_factory=lambda: [0.3, 0.4, 0.35, 0.5, 0.25])
    default_cooling_capacity: list[float] = field(default_factory=lambda: [1.0] * 5)
    ambient_temp: float = 30.0

    # --- Thresholds (simulated IT inlet/zone temperatures in Celsius) ---
    target_temperature_c: float = 22.0          # Chosen operating target within ASHRAE 18-27C recommended envelope
    target_temp_low: float = 18.0               # ASHRAE recommended lower bound
    target_temp_high: float = 27.0              # ASHRAE recommended upper bound
    operational_max_temperature_c: float = 35.0 # ASHRAE Class A2 allowable maximum (operational SLA boundary)
    emergency_max_temperature_c: float = 45.0   # Project-defined simulator emergency threshold (safety shield trip)
    warning_temp: float = 35.0      # backward-compatibility alias for operational_max_temperature_c
    critical_temp: float = 40.0     # escalation threshold between operational and emergency
    max_safe_temp: float = 45.0     # backward-compatibility alias for emergency_max_temperature_c

    # --- Episode ---
    episode_length: int = 288   # ~24h at 5-min intervals

    # --- Power model ---
    it_power_per_zone_kw: float = 10.0      # max IT power draw per zone at full load
    cooling_power_coefficient_kw: float = 5.0  # max thermal cooling power per zone (used in v1 power model)
    overhead_fraction: float = 0.05           # lighting, networking, misc as fraction of IT power

    # --- Simulator version ---
    simulator_version: str = "v1"  # set to "v2" when per-zone arrays are loaded

    # ------------------------------------------------------------------
    # Derived accessors (always return per-zone arrays of length num_zones)
    # ------------------------------------------------------------------

    def get_a_zones(self) -> np.ndarray:
        """Return per-zone heat-gain coefficients (falls back to global scalar)."""
        if self.a_zones is not None and len(self.a_zones) == self.num_zones:
            return np.array(self.a_zones, dtype=np.float64)
        return np.full(self.num_zones, self.a, dtype=np.float64)

    def get_b_zones(self) -> np.ndarray:
        """Return per-zone cooling-effectiveness coefficients (falls back to global scalar)."""
        if self.b_zones is not None and len(self.b_zones) == self.num_zones:
            return np.array(self.b_zones, dtype=np.float64)
        return np.full(self.num_zones, self.b, dtype=np.float64)

    def get_g_zones(self) -> np.ndarray:
        """Return per-zone ambient-coupling coefficients (falls back to global scalar)."""
        if self.g_zones is not None and len(self.g_zones) == self.num_zones:
            return np.array(self.g_zones, dtype=np.float64)
        return np.full(self.num_zones, self.g, dtype=np.float64)

    def get_cop_zones(self) -> np.ndarray:
        """Return per-zone COP values (falls back to 1.0 — no COP scaling in v1)."""
        if self.cop_zones is not None and len(self.cop_zones) == self.num_zones:
            return np.array(self.cop_zones, dtype=np.float64)
        return np.ones(self.num_zones, dtype=np.float64)

    def get_cooling_power_max_kw(self) -> np.ndarray:
        """Return per-zone max thermal cooling power [kW]."""
        if (self.cooling_power_max_kw_per_zone is not None
                and len(self.cooling_power_max_kw_per_zone) == self.num_zones):
            return np.array(self.cooling_power_max_kw_per_zone, dtype=np.float64)
        return np.full(self.num_zones, self.cooling_power_coefficient_kw, dtype=np.float64)

    def get_adjacency_matrix(self) -> Optional[np.ndarray]:
        """Return adjacency matrix as NxN numpy array, or None if all zeros / not set."""
        if self.adjacency_matrix is None:
            return None
        mat = np.array(self.adjacency_matrix, dtype=np.float64)
        if mat.shape != (self.num_zones, self.num_zones):
            return None
        if np.all(mat == 0.0):
            return None  # All-zero: no recirculation, skip computation
        return mat

    @classmethod
    def from_config_dir(cls, config_dir: Optional[Path] = None) -> "ThermalConfig":
        """Load config from topology.json + thresholds.json."""
        d = Path(config_dir) if config_dir else _CONFIG_DIR

        with open(d / "topology.json", "r") as f:
            topo = json.load(f)
        with open(d / "thresholds.json", "r") as f:
            thresh = json.load(f)

        tc = topo.get("thermal_coefficients", {})
        op_max = thresh.get("operational_max_temperature_c", thresh.get("warning_temp", 35.0))
        em_max = thresh.get("emergency_max_temperature_c", thresh.get("max_safe_temp", 45.0))
        target_c = thresh.get("target_temperature_c", 22.0)

        sim_version = topo.get("simulator_version", "v1")

        # Per-zone arrays (simulator-v2 only; None if not present)
        a_zones = topo.get("zone_heat_gain_coefficients", None)
        b_zones = topo.get("zone_cooling_effectiveness", None)
        g_zones = topo.get("zone_ambient_coupling", None)
        cop_zones = topo.get("zone_cop", None)
        adjacency = topo.get("zone_adjacency_matrix", None)
        cooling_max_kw = topo.get("cooling_power_max_kw_per_zone", None)

        return cls(
            num_zones=topo.get("num_zones", 5),
            a=tc.get("a", 5.0),
            b=tc.get("b", 6.0),
            g=tc.get("g", 0.02),
            a_zones=a_zones,
            b_zones=b_zones,
            g_zones=g_zones,
            cop_zones=cop_zones,
            adjacency_matrix=adjacency,
            cooling_power_max_kw_per_zone=cooling_max_kw,
            noise_std=topo.get("noise_std", 0.1),
            initial_temperatures=list(topo.get("initial_temperatures", [22.0] * 5)),
            initial_workloads=list(topo.get("initial_workloads", [0.3, 0.4, 0.35, 0.5, 0.25])),
            default_cooling_capacity=list(topo.get("default_cooling_capacity", [1.0] * 5)),
            ambient_temp=topo.get("ambient_temp", 30.0),
            target_temperature_c=target_c,
            target_temp_low=thresh.get("target_temp_low", 18.0),
            target_temp_high=thresh.get("target_temp_high", 27.0),
            operational_max_temperature_c=op_max,
            emergency_max_temperature_c=em_max,
            warning_temp=op_max,
            critical_temp=thresh.get("critical_temp", 40.0),
            max_safe_temp=em_max,
            episode_length=thresh.get("episode_length", 288),
            it_power_per_zone_kw=topo.get("it_power_per_zone_kw", 10.0),
            cooling_power_coefficient_kw=topo.get("cooling_power_coefficient_kw", 5.0),
            overhead_fraction=topo.get("overhead_fraction", 0.05),
            simulator_version=sim_version,
        )


class ThermalModel:
    """Stateless thermal physics + power accounting.

    All methods are pure functions operating on arrays — no internal mutable
    state. The mutable simulation state lives in the Gymnasium environment.

    Supports both simulator-v1 (global coefficients) and simulator-v2
    (per-zone coefficients + COP-based electrical power accounting).
    """

    def __init__(self, config: Optional[ThermalConfig] = None):
        self.cfg = config or ThermalConfig()
        # Cache per-zone arrays for efficiency
        self._a_zones = self.cfg.get_a_zones()
        self._b_zones = self.cfg.get_b_zones()
        self._g_zones = self.cfg.get_g_zones()
        self._cop_zones = self.cfg.get_cop_zones()
        self._cooling_max_kw = self.cfg.get_cooling_power_max_kw()
        self._adjacency = self.cfg.get_adjacency_matrix()

    # ------------------------------------------------------------------
    # Core thermal update
    # ------------------------------------------------------------------
    def step_temperatures(
        self,
        temperatures: np.ndarray,
        workloads: np.ndarray,
        cooling: np.ndarray,
        ambient_temp: float,
        rng: np.random.Generator,
    ) -> np.ndarray:
        """Apply the per-zone thermal update equation to all zones.

        Simulator-v2 equation (per zone i):
            T_next_i = T_i + a_i*W_i - b_i*C_i + g_i*(T_amb - T_i) + noise_i
            + sum_j(adjacency[j][i] * T_j)   [optional recirculation term]

        Parameters
        ----------
        temperatures : (N,) current zone temperatures in Celsius
        workloads    : (N,) zone utilisation in [0, 1]
        cooling      : (N,) effective cooling action in [0, 1]
        ambient_temp : scalar ambient temperature
        rng          : seeded numpy Generator for reproducibility

        Returns
        -------
        new_temperatures : (N,) updated zone temperatures
        """
        noise = rng.normal(0.0, self.cfg.noise_std, size=temperatures.shape)

        t_next = (
            temperatures
            + self._a_zones * workloads
            - self._b_zones * cooling
            + self._g_zones * (ambient_temp - temperatures)
            + noise
        )

        # Optional thermal recirculation (only computed if adjacency is non-zero)
        if self._adjacency is not None:
            # adjacency[j][i] = fraction of zone j's temperature that heats zone i
            recirculation = self._adjacency.T @ temperatures  # shape (N,)
            t_next += recirculation

        return t_next

    # ------------------------------------------------------------------
    # Power accounting (for PUE)
    # ------------------------------------------------------------------
    def compute_power(
        self,
        workloads: np.ndarray,
        cooling: np.ndarray,
    ) -> dict[str, float]:
        """Compute instantaneous power draw for this timestep.

        Simulator-v2 power model:
        - IT power: proportional to workload (hardware-determined, not cooling-unit).
        - Cooling electrical power: thermal_removal_kw / COP_i per zone.
          Zones with lower COP draw more electricity for the same thermal removal.
          This is the key mechanism by which workload migration reduces total power.
        - Overhead: fixed fraction of IT power.

        Returns a dict with all components and PUE.
        """
        it_power = float(np.sum(workloads * self.cfg.it_power_per_zone_kw))

        # Thermal removal [kW] per zone: cooling action * max thermal capacity
        thermal_removal_kw = cooling * self._cooling_max_kw  # shape (N,)

        # Electrical power consumed [kW] per zone: thermal_removal / COP
        cooling_electrical_kw = thermal_removal_kw / self._cop_zones  # shape (N,)
        cooling_power = float(np.sum(cooling_electrical_kw))

        overhead = it_power * self.cfg.overhead_fraction
        total_facility = it_power + cooling_power + overhead

        # PUE = Total Facility Power / IT Equipment Power
        # Guard against division by zero (idle data center)
        pue = total_facility / it_power if it_power > 1e-9 else 1.0

        return {
            "it_power_kw": it_power,
            "cooling_power_kw": cooling_power,
            "overhead_kw": overhead,
            "total_facility_power_kw": total_facility,
            "pue": pue,
            # Detailed breakdown for diagnostics
            "thermal_removal_kw": thermal_removal_kw.tolist(),
            "cooling_electrical_kw_per_zone": cooling_electrical_kw.tolist(),
        }

    # ------------------------------------------------------------------
    # Reward function
    # ------------------------------------------------------------------
    def compute_reward(
        self,
        temperatures: np.ndarray,
        workloads: np.ndarray,
        cooling: np.ndarray,
        prev_cooling: np.ndarray,
        *,
        w1: float = 8.0,
        w2: float = 8.0,
        w3: float = 0.05,
        w4: float = 0.01,
    ) -> float:
        """Compute the scalar reward for this timestep.

        Components
        ----------
        temperature_penalty : exponential, harsh near critical temp
        energy_cost         : linear, proportional to total cooling electrical power
        jitter_penalty      : quadratic, penalises rapid cooling changes
        target_drift        : deviation from ideal operating temp band [target_low, target_high]

        Emergency override: if any zone exceeds critical_temp, jitter_penalty
        is zeroed for this step so safety response isn't penalised for abruptness.
        """
        cfg = self.cfg

        # --- temperature penalty (exponential, per zone) ---
        # Grows rapidly as temperature exceeds operational_max_temperature_c towards emergency limit
        temp_excess = np.maximum(temperatures - cfg.operational_max_temperature_c, 0.0)
        temp_excess_scaled = np.clip(temp_excess / 3.0, 0.0, 6.0)
        temperature_penalty = float(np.sum(np.exp(temp_excess_scaled) - 1.0))

        # --- energy cost (linear, in cooling action units — proxy for electrical cost) ---
        energy_cost = float(np.sum(cooling))

        # --- jitter penalty (quadratic change in cooling actions) ---
        jitter_penalty = float(np.sum((cooling - prev_cooling) ** 2))

        # --- target drift (deviation from ideal band) ---
        below = np.maximum(cfg.target_temp_low - temperatures, 0.0)
        above = np.maximum(temperatures - cfg.target_temp_high, 0.0)
        target_drift = float(np.sum(below + above))

        # Emergency override: zero jitter penalty when any zone is critical
        if np.any(temperatures > cfg.critical_temp):
            jitter_penalty = 0.0

        reward = -(
            w1 * temperature_penalty
            + w2 * energy_cost
            + w3 * jitter_penalty
            + w4 * target_drift
        )
        return reward
