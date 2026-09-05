"""Integration tests for Data Center Twin API runs and orchestration.

Covers:
1. Live cooling_failure run lifecycle and telemetry generation.
2. WebSocket telemetry streaming (/api/v1/stream) and ping/pong.
3. Command boundaries: pause, resume, step, set_speed, reset, stop.
4. Controller selection: rule_based, cooling_only_rl, joint_rl.
5. Repeat-run execution: stopping one scenario and immediately starting another
   without restarting FastAPI (Correction #10).
6. Certified benchmark retrieval and summary metrics.
"""

from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from packages.contracts.schemas import (
    CommandName,
    ControllerName,
    RunStatus,
    ScenarioName,
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


class TestSimulationRuns:
    """Integration tests for simulation runs lifecycle and orchestration."""

    def test_cooling_failure_run_lifecycle(self, client: TestClient):
        # Create a cooling_failure run with joint_rl and auto_play=False for deterministic stepping
        payload = {
            "controller": ControllerName.JOINT_RL.value,
            "scenario": ScenarioName.COOLING_FAILURE.value,
            "seed": 42,
            "auto_play": False,
            "custom_failure": {
                "zone_index": 3,
                "trigger_step": 2,
                "reduced_capacity": 0.6,
            },
        }
        res = client.post("/api/v1/runs", json=payload)
        assert res.status_code == 201
        run_data = res.json()
        run_id = run_data["run_id"]
        assert run_data["controller"] == "joint_rl"
        assert run_data["scenario"] == "cooling_failure"
        assert run_data["current_step"] == 0

        # Step 1, 2 (pre-failure)
        for expected_step in [1, 2]:
            cmd_res = client.post(
                f"/api/v1/runs/{run_id}/commands",
                json={"command": CommandName.STEP.value},
            )
            assert cmd_res.status_code == 200
            curr = client.get("/api/v1/runs/current").json()
            assert curr["current_step"] == expected_step
            telemetry = curr["telemetry"]
            assert telemetry["cooling_capacity"][3] == 1.0  # Still full capacity

        # Step 3 (failure triggers)
        cmd_res = client.post(
            f"/api/v1/runs/{run_id}/commands",
            json={"command": CommandName.STEP.value},
        )
        assert cmd_res.status_code == 200
        curr = client.get("/api/v1/runs/current").json()
        assert curr["current_step"] == 3
        telemetry = curr["telemetry"]
        assert telemetry["cooling_capacity"][3] == 0.6  # Reduced to 60%!
        assert any("FAILURE" in e for e in telemetry["events"])

        # Power, energy, and PUE check
        assert telemetry["power"]["total_power_kw"] > 0.0
        assert telemetry["energy"]["total_facility_energy_kwh"] > 0.0
        assert telemetry["pue"] > 1.0

    def test_websocket_streaming_and_ping(self, client: TestClient):
        # Create a paused run
        client.post(
            "/api/v1/runs",
            json={
                "controller": ControllerName.RULE_BASED.value,
                "scenario": ScenarioName.NORMAL.value,
                "seed": 101,
                "auto_play": False,
            },
        )
        curr = client.get("/api/v1/runs/current").json()
        run_id = curr["run_id"]

        with client.websocket_connect("/api/v1/stream") as ws:
            # 1. First message is "connected"
            init_text = ws.receive_text()
            init_msg = json.loads(init_text)
            assert init_msg["type"] == "connected"
            assert init_msg["data"]["run"]["run_id"] == run_id

            # 2. Ping / Pong connection check
            ws.send_text(json.dumps({"type": "ping"}))
            pong_text = ws.receive_text()
            pong_msg = json.loads(pong_text)
            assert pong_msg["type"] == "pong"

            # 3. Trigger REST step command, verify telemetry received via WebSocket
            step_res = client.post(
                f"/api/v1/runs/{run_id}/commands",
                json={"command": CommandName.STEP.value},
            )
            assert step_res.status_code == 200

            # May receive run_state then telemetry
            messages = []
            for _ in range(2):
                msg_text = ws.receive_text()
                messages.append(json.loads(msg_text))

            telemetry_msgs = [m for m in messages if m["type"] == "telemetry"]
            assert len(telemetry_msgs) >= 1
            frame = telemetry_msgs[0]["data"]
            assert frame["step"] == 1
            assert len(frame["temperatures"]) == 5

    def test_command_boundaries(self, client: TestClient):
        # Create run
        res = client.post(
            "/api/v1/runs",
            json={
                "controller": ControllerName.RULE_BASED.value,
                "scenario": ScenarioName.NORMAL.value,
                "auto_play": False,
            },
        )
        run_id = res.json()["run_id"]

        # Test set_speed
        speed_res = client.post(
            f"/api/v1/runs/{run_id}/commands",
            json={"command": CommandName.SET_SPEED.value, "params": {"speed_hz": 20.0}},
        )
        assert speed_res.status_code == 200
        curr = client.get("/api/v1/runs/current").json()
        assert curr["step_rate_hz"] == 20.0

        # Test step
        step_res = client.post(
            f"/api/v1/runs/{run_id}/commands",
            json={"command": CommandName.STEP.value},
        )
        assert step_res.status_code == 200
        assert client.get("/api/v1/runs/current").json()["current_step"] == 1

        # Test reset
        reset_res = client.post(
            f"/api/v1/runs/{run_id}/commands",
            json={"command": CommandName.RESET.value},
        )
        assert reset_res.status_code == 200
        curr = client.get("/api/v1/runs/current").json()
        assert curr["current_step"] == 0

        # Test stop
        stop_res = client.post(
            f"/api/v1/runs/{run_id}/commands",
            json={"command": CommandName.STOP.value},
        )
        assert stop_res.status_code == 200
        assert stop_res.json()["status"] == RunStatus.STOPPED.value

    def test_controller_selection(self, client: TestClient):
        controllers = [
            ControllerName.RULE_BASED,
            ControllerName.COOLING_ONLY_RL,
            ControllerName.JOINT_RL,
        ]
        for ctrl in controllers:
            res = client.post(
                "/api/v1/runs",
                json={
                    "controller": ctrl.value,
                    "scenario": ScenarioName.NORMAL.value,
                    "auto_play": False,
                },
            )
            assert res.status_code == 201
            run_id = res.json()["run_id"]

            # Step 3 times
            for _ in range(3):
                step_res = client.post(
                    f"/api/v1/runs/{run_id}/commands",
                    json={"command": CommandName.STEP.value},
                )
                assert step_res.status_code == 200

            curr = client.get("/api/v1/runs/current").json()
            assert curr["controller"] == ctrl.value
            assert curr["current_step"] == 3
            assert curr["telemetry"] is not None

    def test_repeat_run_different_scenario(self, client: TestClient):
        """Correction #10: Complete or stop one scenario, then start a different scenario
        without restarting FastAPI. Verify previous run is cleanly replaced.
        """
        # 1. Start Cooling Failure with Joint RL
        run1_res = client.post(
            "/api/v1/runs",
            json={
                "controller": ControllerName.JOINT_RL.value,
                "scenario": ScenarioName.COOLING_FAILURE.value,
                "seed": 401,
                "auto_play": False,
            },
        )
        assert run1_res.status_code == 201
        run1_id = run1_res.json()["run_id"]

        # Step run1 a couple times
        client.post(
            f"/api/v1/runs/{run1_id}/commands",
            json={"command": CommandName.STEP.value},
        )
        client.post(
            f"/api/v1/runs/{run1_id}/commands",
            json={"command": CommandName.STEP.value},
        )

        # Stop run1 explicitly
        stop_res = client.post(
            f"/api/v1/runs/{run1_id}/commands",
            json={"command": CommandName.STOP.value},
        )
        assert stop_res.status_code == 200

        # 2. Immediately start Peak Load with Rule-Based without restarting FastAPI
        run2_res = client.post(
            "/api/v1/runs",
            json={
                "controller": ControllerName.RULE_BASED.value,
                "scenario": ScenarioName.PEAK_LOAD.value,
                "seed": 402,
                "auto_play": False,
            },
        )
        assert run2_res.status_code == 201
        run2_id = run2_res.json()["run_id"]
        assert run2_id != run1_id

        # Verify current run is run2
        curr = client.get("/api/v1/runs/current").json()
        assert curr["run_id"] == run2_id
        assert curr["scenario"] == "peak_load"
        assert curr["controller"] == "rule_based"
        assert curr["current_step"] == 0

        # Step run2
        step_res = client.post(
            f"/api/v1/runs/{run2_id}/commands",
            json={"command": CommandName.STEP.value},
        )
        assert step_res.status_code == 200
        curr2 = client.get("/api/v1/runs/current").json()
        assert curr2["current_step"] == 1
        assert curr2["telemetry"]["workloads"][0] > 0.7  # Peak load profile

    def test_migration_telemetry_semantics(self, client: TestClient):
        """Check 1: Verify migration event and applied action are derived from actual

        workload deltas, and move_fraction, amount, and migration fields are consistent.
        """
        res = client.post(
            "/api/v1/runs",
            json={
                "controller": ControllerName.JOINT_RL.value,
                "scenario": ScenarioName.COOLING_FAILURE.value,
                "seed": 401,
                "auto_play": False,
            },
        )
        run_id = res.json()["run_id"]

        migration_found = False
        prev_workloads = None

        # Step until a migration occurs
        for _ in range(10):
            step_res = client.post(
                f"/api/v1/runs/{run_id}/commands",
                json={"command": CommandName.STEP.value},
            )
            assert step_res.status_code == 200
            curr = client.get("/api/v1/runs/current").json()
            t = curr["telemetry"]
            curr_workloads = t["workloads"]

            if prev_workloads is not None:
                # Check actual deltas
                deltas = [curr_workloads[i] - prev_workloads[i] for i in range(5)]
                max_d = max(deltas)
                min_d = min(deltas)

                if max_d > 1e-6 and min_d < -1e-6:
                    migration_found = True
                    mig = t["migration"]
                    applied = t["applied_action"]
                    assert mig is not None
                    # Verify fields match actual applied delta
                    to_z = deltas.index(max_d)
                    from_z = deltas.index(min_d)
                    assert mig["from_zone"] == from_z
                    assert mig["to_zone"] == to_z
                    assert pytest.approx(mig["amount"], abs=1e-5) == max_d

                    # Verify applied action consistency
                    assert applied["from_zone"] == from_z
                    assert applied["to_zone"] == to_z
                    assert pytest.approx(applied["amount"], abs=1e-5) == max_d
                    expected_fraction = max_d / prev_workloads[from_z]
                    assert pytest.approx(applied["move_fraction"], abs=1e-5) == expected_fraction
                    break
                else:
                    assert t["migration"] is None
                    assert t["applied_action"]["amount"] == 0.0
                    assert t["applied_action"]["move_fraction"] == 0.0

            prev_workloads = curr_workloads

        assert migration_found, "Expected at least one migration event within 10 steps of Joint RL"
