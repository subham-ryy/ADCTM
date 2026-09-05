"""Shared Pydantic v2 contract schemas for the Data Center Twin API.

These models define the wire format for all REST and WebSocket payloads.
The frontend and backend both depend on these definitions.
"""

from __future__ import annotations

import enum
import time
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class ControllerName(str, enum.Enum):
    RULE_BASED = "rule_based"
    COOLING_ONLY_RL = "cooling_only_rl"
    JOINT_RL = "joint_rl"


class ScenarioName(str, enum.Enum):
    NORMAL = "normal"
    PEAK_LOAD = "peak_load"
    AMBIENT_HEAT = "ambient_heat"
    COOLING_FAILURE = "cooling_failure"


class RunStatus(str, enum.Enum):
    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"
    FAILED = "failed"


class RiskLevel(str, enum.Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EMERGENCY = "EMERGENCY"


class CommandName(str, enum.Enum):
    START = "start"
    PAUSE = "pause"
    RESUME = "resume"
    STEP = "step"
    RESET = "reset"
    STOP = "stop"
    SET_SPEED = "set_speed"


# ---------------------------------------------------------------------------
# Nested sub-models
# ---------------------------------------------------------------------------
class PowerInfo(BaseModel):
    it_power_kw: float
    cooling_power_kw: float
    overhead_kw: float
    total_power_kw: float


class EnergyInfo(BaseModel):
    it_energy_kwh: float
    cooling_energy_kwh: float
    overhead_energy_kwh: float
    total_facility_energy_kwh: float


class SLAInfo(BaseModel):
    sla_uptime_pct: float
    operational_violations: int
    emergency_violations: int
    operational_degree_minutes: float


class MigrationEvent(BaseModel):
    from_zone: int
    to_zone: int
    amount: float


class ShieldInfo(BaseModel):
    corrections_applied: int
    zone_corrections: list[str]
    move_rejected: bool


class ControllerAction(BaseModel):
    cooling: list[float]
    from_zone: int
    to_zone: int
    move_fraction: float
    amount: float = 0.0


class FailureInjectionConfig(BaseModel):
    zone_index: int = Field(ge=0, lt=5)
    trigger_step: int = Field(ge=0, lt=288)
    reduced_capacity: float = Field(ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# TelemetryFrame — the core per-step payload
# ---------------------------------------------------------------------------
class TelemetryFrame(BaseModel):
    step: int
    timestamp: float
    temperatures: list[float] = Field(min_length=5, max_length=5)
    workloads: list[float] = Field(min_length=5, max_length=5)
    cooling: list[float] = Field(min_length=5, max_length=5)
    cooling_capacity: list[float] = Field(min_length=5, max_length=5)
    ambient_temp: float
    power: PowerInfo
    pue: float
    cumulative_pue: float
    energy: EnergyInfo
    sla: SLAInfo
    risk: RiskLevel
    max_temp: float
    controller_action: ControllerAction
    applied_action: ControllerAction
    shield_info: ShieldInfo
    migration: Optional[MigrationEvent] = None
    events: list[str] = Field(default_factory=list)
    done: bool


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str = "ok"
    simulator_version: str
    controllers: list[str]
    scenarios: list[str]
    models_loaded: dict[str, bool]


class ConfigResponse(BaseModel):
    simulator_version: str
    num_zones: int
    zone_names: list[str]
    thresholds: dict[str, Any]
    topology: dict[str, Any]
    scenarios: dict[str, Any]


class CreateRunRequest(BaseModel):
    controller: ControllerName
    scenario: ScenarioName = ScenarioName.COOLING_FAILURE
    seed: int = Field(default=42, ge=0)
    auto_play: bool = True
    step_rate_hz: float = Field(default=4.0, ge=0.1, le=100.0)
    custom_failure: Optional[FailureInjectionConfig] = None

    @field_validator("controller", mode="before")
    @classmethod
    def _normalize_controller(cls, v: Any) -> Any:
        if isinstance(v, str):
            v_lower = v.strip().lower()
            if v_lower in ("joint_rl", "joint"):
                return ControllerName.JOINT_RL
            if v_lower in ("cooling_only_rl", "cooling_only", "pid_only"):
                return ControllerName.COOLING_ONLY_RL
            if v_lower in ("rule_based", "baseline"):
                return ControllerName.RULE_BASED
            return v_lower
        return v

    @field_validator("scenario", mode="before")
    @classmethod
    def _normalize_scenario(cls, v: Any) -> Any:
        if isinstance(v, str):
            v_lower = v.strip().lower()
            if v_lower in ("cooling_failure", "failure", "crac trip", "crac_trip"):
                return ScenarioName.COOLING_FAILURE
            if v_lower in ("peak_load", "peak"):
                return ScenarioName.PEAK_LOAD
            if v_lower in ("ambient_heat", "heatwave"):
                return ScenarioName.AMBIENT_HEAT
            if v_lower == "normal":
                return ScenarioName.NORMAL
            return v_lower
        return v


class CommandRequest(BaseModel):
    command: CommandName
    params: Optional[dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_command_request(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cmd = data.get("command") or data.get("action")
            if isinstance(cmd, str):
                cmd_lower = cmd.strip().lower()
                if cmd_lower in ("start", "resume"):
                    data["command"] = CommandName.RESUME
                elif cmd_lower == "pause":
                    data["command"] = CommandName.PAUSE
                elif cmd_lower == "step":
                    data["command"] = CommandName.STEP
                elif cmd_lower == "stop":
                    data["command"] = CommandName.STOP
                elif cmd_lower == "reset":
                    data["command"] = CommandName.RESET
                elif cmd_lower in ("set_speed", "speed"):
                    data["command"] = CommandName.SET_SPEED
                elif cmd_lower in ("set_scenario", "scenario"):
                    data["command"] = CommandName.RESET
                else:
                    data["command"] = cmd_lower
        return data

    @field_validator("params")
    @classmethod
    def validate_params(cls, v: Optional[dict], info) -> Optional[dict]:
        # set_speed requires speed_hz in params
        return v


class RunSummary(BaseModel):
    run_id: str
    status: RunStatus
    controller: ControllerName
    scenario: ScenarioName
    seed: int
    step_rate_hz: float
    current_step: int
    total_steps: int = 288
    telemetry: Optional[TelemetryFrame] = None


class CommandResponse(BaseModel):
    run_id: str
    command: CommandName
    status: RunStatus
    message: str


class BenchmarkSummaryRow(BaseModel):
    controller: str
    pue: float
    max_temp: float
    sla_uptime_pct: float
    operational_violations: float
    emergency_violations: float
    energy_kwh: float
    migrations: float


class BenchmarkMeta(BaseModel):
    benchmark_id: str
    status: str
    simulator_version: str
    timestamp: Optional[float] = None
    test_seeds: list[int] = Field(default_factory=list)
    scenarios: list[str] = Field(default_factory=list)


class BenchmarkResultsResponse(BaseModel):
    benchmark_id: str
    simulator_version: str
    timestamp: Optional[float] = None
    test_seeds: list[int]
    summary_table: list[BenchmarkSummaryRow]
    criteria_results: dict[str, Any] = Field(default_factory=dict)
    all_passed: Optional[bool] = None
    note: str = ""


# ---------------------------------------------------------------------------
# WebSocket envelope
# ---------------------------------------------------------------------------
class WSMessage(BaseModel):
    type: str  # "connected", "telemetry", "run_state", "error"
    run_id: Optional[str] = None
    data: Optional[Any] = None
