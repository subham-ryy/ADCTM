"""Contract tests for Data Center Twin API schemas.

Validates that all REST endpoints return data conforming strictly to the
Pydantic v2 contract models in packages.contracts.schemas, and that input
validation strictly enforces constraints.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from packages.contracts.schemas import (
    BenchmarkMeta,
    BenchmarkResultsResponse,
    CommandName,
    CommandResponse,
    ConfigResponse,
    ControllerName,
    HealthResponse,
    RunStatus,
    RunSummary,
    ScenarioName,
    TelemetryFrame,
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


class TestAPIContracts:
    """Validate endpoint responses against declared Pydantic schemas."""

    def test_health_contract(self, client: TestClient):
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        validated = HealthResponse.model_validate(data)
        assert validated.status == "ok"
        assert validated.simulator_version == "v2"
        assert "rule_based" in validated.controllers
        assert "cooling_only_rl" in validated.controllers
        assert "joint_rl" in validated.controllers
        assert "cooling_failure" in validated.scenarios
        assert validated.models_loaded["joint_rl"] is True
        assert validated.models_loaded["cooling_only_rl"] is True
        assert validated.models_loaded["rule_based"] is True

    def test_config_contract(self, client: TestClient):
        response = client.get("/api/v1/config")
        assert response.status_code == 200
        data = response.json()
        validated = ConfigResponse.model_validate(data)
        assert validated.simulator_version == "v2"
        assert validated.num_zones == 5
        assert len(validated.zone_names) == 5
        assert "target_temperature_c" in validated.thresholds
        assert "operational_max_temperature_c" in validated.thresholds
        assert "emergency_max_temperature_c" in validated.thresholds
        assert "zone_heat_gain_coefficients" in validated.topology
        assert "zone_cooling_effectiveness" in validated.topology
        assert "zone_cop" in validated.topology
        assert "cooling_failure" in validated.scenarios

    def test_create_run_and_current_contract(self, client: TestClient):
        # Create a run in paused / manual stepping mode
        payload = {
            "controller": ControllerName.JOINT_RL.value,
            "scenario": ScenarioName.COOLING_FAILURE.value,
            "seed": 42,
            "auto_play": False,
            "step_rate_hz": 10.0,
        }
        create_res = client.post("/api/v1/runs", json=payload)
        assert create_res.status_code == 201
        run_data = create_res.json()
        validated_run = RunSummary.model_validate(run_data)
        assert validated_run.status in (RunStatus.CREATED, RunStatus.PAUSED)
        assert validated_run.controller == ControllerName.JOINT_RL
        assert validated_run.scenario == ScenarioName.COOLING_FAILURE
        assert validated_run.seed == 42
        assert validated_run.total_steps == 288

        # Verify GET /runs/current returns identical contract
        current_res = client.get("/api/v1/runs/current")
        assert current_res.status_code == 200
        current_data = current_res.json()
        validated_current = RunSummary.model_validate(current_data)
        assert validated_current.run_id == validated_run.run_id

    def test_command_contract_and_telemetry_frame(self, client: TestClient):
        # Current run exists from previous test; step it once
        current_res = client.get("/api/v1/runs/current")
        run_id = current_res.json()["run_id"]

        cmd_payload = {"command": CommandName.STEP.value}
        step_res = client.post(f"/api/v1/runs/{run_id}/commands", json=cmd_payload)
        assert step_res.status_code == 200
        cmd_data = step_res.json()
        validated_cmd = CommandResponse.model_validate(cmd_data)
        assert validated_cmd.run_id == run_id
        assert validated_cmd.command == CommandName.STEP

        # Verify telemetry in current run satisfies TelemetryFrame schema
        curr = client.get("/api/v1/runs/current").json()
        telemetry = curr.get("telemetry")
        assert telemetry is not None
        frame = TelemetryFrame.model_validate(telemetry)
        assert frame.step == 1
        assert len(frame.temperatures) == 5
        assert len(frame.workloads) == 5
        assert len(frame.cooling) == 5
        assert len(frame.cooling_capacity) == 5
        assert frame.power.total_power_kw > 0
        assert frame.energy.total_facility_energy_kwh > 0
        assert frame.pue > 1.0
        assert frame.cumulative_pue > 1.0
        assert frame.risk in ("NORMAL", "WARNING", "CRITICAL", "EMERGENCY")
        assert len(frame.controller_action.cooling) == 5
        assert len(frame.applied_action.cooling) == 5
        assert len(frame.shield_info.zone_corrections) == 5

    def test_benchmarks_contracts(self, client: TestClient):
        # POST /benchmarks
        meta_res = client.post("/api/v1/benchmarks")
        assert meta_res.status_code == 200
        meta = BenchmarkMeta.model_validate(meta_res.json())
        assert meta.benchmark_id == "phase4_v2"
        assert meta.simulator_version == "v2"

        # GET /benchmarks/{id}
        get_meta = client.get(f"/api/v1/benchmarks/{meta.benchmark_id}")
        assert get_meta.status_code == 200
        BenchmarkMeta.model_validate(get_meta.json())

        # GET /benchmarks/{id}/results
        results_res = client.get(f"/api/v1/benchmarks/{meta.benchmark_id}/results")
        assert results_res.status_code == 200
        results = BenchmarkResultsResponse.model_validate(results_res.json())
        assert results.benchmark_id == "phase4_v2"
        assert len(results.summary_table) == 3
        controllers = [r.controller for r in results.summary_table]
        assert "Rule-Based" in controllers
        assert "Cooling-Only RL" in controllers
        assert "Joint RL" in controllers

        # Joint RL row validation
        joint_row = next(r for r in results.summary_table if r.controller == "Joint RL")
        assert joint_row.pue < 1.21
        assert joint_row.sla_uptime_pct == 100.0


class TestInputValidation:
    """Validate that invalid payloads are rejected with 422 Unprocessable Entity."""

    def test_invalid_controller_rejected(self, client: TestClient):
        payload = {
            "controller": "non_existent_controller",
            "scenario": "cooling_failure",
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 422

    def test_invalid_scenario_rejected(self, client: TestClient):
        payload = {
            "controller": "joint_rl",
            "scenario": "tornado_disaster",
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 422

    def test_invalid_seed_rejected(self, client: TestClient):
        payload = {
            "controller": "joint_rl",
            "scenario": "normal",
            "seed": -5,
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 422

    def test_invalid_speed_rejected(self, client: TestClient):
        payload = {
            "controller": "joint_rl",
            "step_rate_hz": 500.0,  # exceeds max 100.0
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 422

    def test_invalid_custom_failure_rejected(self, client: TestClient):
        payload = {
            "controller": "joint_rl",
            "custom_failure": {
                "zone_index": 10,  # only 5 zones (0-4)
                "trigger_step": 50,
                "reduced_capacity": 0.5,
            },
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 422
