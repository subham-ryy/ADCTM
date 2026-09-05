"""FastAPI REST routes for the Data Center Twin API.

All endpoints delegate to the existing engine modules.  No thermal equations,
action decoding, or controller logic is reimplemented here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from packages.contracts.schemas import (
    BenchmarkMeta,
    BenchmarkResultsResponse,
    BenchmarkSummaryRow,
    CommandName,
    CommandRequest,
    CommandResponse,
    ConfigResponse,
    ControllerName,
    CreateRunRequest,
    HealthResponse,
    RunStatus,
    RunSummary,
    WSMessage,
)
from apps.api.model_loader import registry
from apps.api.orchestrator import SessionManager
from apps.api.websocket import ConnectionManager

# ---------------------------------------------------------------------------
# Singletons (initialised by main.py lifespan)
# ---------------------------------------------------------------------------
session_mgr = SessionManager()
ws_mgr = ConnectionManager()

router = APIRouter(prefix="/api/v1")

REPO_ROOT = Path(__file__).resolve().parents[2]
BENCHMARK_V2_PATH = REPO_ROOT / "outputs" / "phase4_final_benchmark_results_v2.json"

# The single benchmark id for the certified v2 results
_BENCHMARK_ID = "phase4_v2"


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------
@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    cfg = registry.cfg
    from engine.scenarios.scenario_env import load_scenarios

    scenarios = load_scenarios()
    return HealthResponse(
        status="ok",
        simulator_version=getattr(cfg, "simulator_version", "v2"),
        controllers=["rule_based", "cooling_only_rl", "joint_rl"],
        scenarios=list(scenarios.keys()),
        models_loaded=registry.models_loaded,
    )


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------
@router.get("/config", response_model=ConfigResponse)
async def config() -> ConfigResponse:
    cfg = registry.cfg
    from engine.scenarios.scenario_env import load_scenarios

    scenarios = load_scenarios()

    # Load raw JSON configs for full transparency
    topology_path = REPO_ROOT / "config" / "topology.json"
    thresholds_path = REPO_ROOT / "config" / "thresholds.json"

    with open(topology_path) as f:
        topology = json.load(f)
    with open(thresholds_path) as f:
        thresholds = json.load(f)

    return ConfigResponse(
        simulator_version=getattr(cfg, "simulator_version", "v2"),
        num_zones=cfg.num_zones,
        zone_names=topology.get("zone_names", [f"Zone-{i}" for i in range(cfg.num_zones)]),
        thresholds=thresholds,
        topology=topology,
        scenarios=scenarios,
    )


# ---------------------------------------------------------------------------
# POST /runs
# ---------------------------------------------------------------------------
@router.post("/runs", response_model=RunSummary, status_code=201)
async def create_run(req: CreateRunRequest) -> RunSummary:
    cfg = registry.cfg

    # Validate custom failure params if provided
    custom_failure = None
    if req.custom_failure is not None:
        custom_failure = {
            "zone_index": req.custom_failure.zone_index,
            "trigger_step": req.custom_failure.trigger_step,
            "reduced_capacity": req.custom_failure.reduced_capacity,
        }

    session = session_mgr.create_session(
        cfg=cfg,
        controller_name=req.controller,
        scenario_name=req.scenario,
        seed=req.seed,
        step_rate_hz=req.step_rate_hz,
        cooling_only_model=registry.cooling_only_model,
        joint_rl_model=registry.joint_rl_model,
        custom_failure=custom_failure,
    )

    # Broadcast run created
    await ws_mgr.broadcast_run_state(session.run_id, session.status.value)

    # Auto-play if requested
    if req.auto_play:
        await session_mgr.start_playback()

    return session.get_summary()


# ---------------------------------------------------------------------------
# GET /runs/current
# ---------------------------------------------------------------------------
@router.get("/runs/current", response_model=RunSummary)
async def get_current_run() -> RunSummary:
    if session_mgr.current_session is None:
        raise HTTPException(status_code=404, detail="No active run")
    return session_mgr.current_session.get_summary()


# ---------------------------------------------------------------------------
# POST /runs/{run_id}/commands
# ---------------------------------------------------------------------------
@router.post("/runs/{run_id}/commands", response_model=CommandResponse)
async def run_command(run_id: str, req: CommandRequest) -> CommandResponse:
    session = session_mgr.current_session
    if session is None or session.run_id != run_id:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    cmd = req.command
    msg = ""

    if cmd == CommandName.START:
        if session.status in (RunStatus.CREATED, RunStatus.PAUSED):
            await session_mgr.start_playback()
            msg = "Run started"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot start run in state {session.status.value}",
            )

    elif cmd == CommandName.PAUSE:
        if session.status == RunStatus.RUNNING:
            await session_mgr.pause()
            msg = "Run paused"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot pause run in state {session.status.value}",
            )

    elif cmd == CommandName.RESUME:
        if session.status == RunStatus.PAUSED:
            await session_mgr.resume()
            msg = "Run resumed"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot resume run in state {session.status.value}",
            )

    elif cmd == CommandName.STEP:
        frame = await session_mgr.step_one()
        if frame is None:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot step run in state {session.status.value}",
            )
        msg = f"Stepped to {frame.step}"

    elif cmd == CommandName.RESET:
        summary = await session_mgr.reset()
        msg = "Run reset to step 0"

    elif cmd == CommandName.STOP:
        await session_mgr.stop()
        msg = "Run stopped"

    elif cmd == CommandName.SET_SPEED:
        if req.params is None or "speed_hz" not in req.params:
            raise HTTPException(
                status_code=400,
                detail="set_speed requires params.speed_hz",
            )
        hz = float(req.params["speed_hz"])
        if hz < 0.1 or hz > 100.0:
            raise HTTPException(
                status_code=400,
                detail="speed_hz must be between 0.1 and 100.0",
            )
        session_mgr.set_speed(hz)
        msg = f"Speed set to {hz} Hz"

    # Broadcast state change
    await ws_mgr.broadcast_run_state(session.run_id, session.status.value)

    return CommandResponse(
        run_id=session.run_id,
        command=cmd,
        status=session.status,
        message=msg,
    )


# ---------------------------------------------------------------------------
# POST /benchmarks
# ---------------------------------------------------------------------------
@router.post("/benchmarks", response_model=BenchmarkMeta, status_code=200)
async def create_benchmark() -> BenchmarkMeta:
    """Return metadata for the certified Phase 4 v2 benchmark.

    Returns the pre-computed, multi-seed benchmark results from the
    certified v2 evaluation.  Does not run benchmarks live.
    """
    if not BENCHMARK_V2_PATH.exists():
        return BenchmarkMeta(
            benchmark_id=_BENCHMARK_ID,
            status="unavailable",
            simulator_version="v2",
            timestamp=None,
            test_seeds=[],
            scenarios=[],
        )

    with open(BENCHMARK_V2_PATH) as f:
        data = json.load(f)

    return BenchmarkMeta(
        benchmark_id=_BENCHMARK_ID,
        status="completed",
        simulator_version=data.get("simulator_version", "v2"),
        timestamp=data.get("benchmark_timestamp"),
        test_seeds=data.get("test_seeds", []),
        scenarios=list(data.get("scenarios", {}).keys()),
    )


# ---------------------------------------------------------------------------
# GET /benchmarks/{benchmark_id}
# ---------------------------------------------------------------------------
@router.get("/benchmarks/{benchmark_id}", response_model=BenchmarkMeta)
async def get_benchmark(benchmark_id: str) -> BenchmarkMeta:
    if benchmark_id != _BENCHMARK_ID:
        raise HTTPException(status_code=404, detail=f"Benchmark {benchmark_id} not found")
    return await create_benchmark()


# ---------------------------------------------------------------------------
# GET /benchmarks/{benchmark_id}/results
# ---------------------------------------------------------------------------
@router.get(
    "/benchmarks/{benchmark_id}/results",
    response_model=BenchmarkResultsResponse,
)
async def get_benchmark_results(benchmark_id: str) -> BenchmarkResultsResponse:
    if benchmark_id != _BENCHMARK_ID:
        raise HTTPException(status_code=404, detail=f"Benchmark {benchmark_id} not found")

    if not BENCHMARK_V2_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Benchmark results unavailable. "
                f"Expected file at {BENCHMARK_V2_PATH} does not exist."
            ),
        )

    with open(BENCHMARK_V2_PATH) as f:
        data = json.load(f)

    # Build summary table from canonical scenario averages
    canonical = data.get("scenarios", {}).get("canonical_cooling_failure", {})
    summary_rows = []
    for ctrl_key, ctrl_label in [
        ("rule_based", "Rule-Based"),
        ("cooling_only", "Cooling-Only RL"),
        ("joint_rl", "Joint RL"),
    ]:
        ctrl_data = canonical.get(ctrl_key, {})
        if not ctrl_data:
            continue
        summary_rows.append(
            BenchmarkSummaryRow(
                controller=ctrl_label,
                pue=ctrl_data.get("pue", 0.0) if isinstance(ctrl_data.get("pue"), (int, float)) else _avg_field(ctrl_data, "pue"),
                max_temp=_avg_field(ctrl_data, "max_temp"),
                sla_uptime_pct=_avg_field(ctrl_data, "sla_uptime_pct"),
                operational_violations=_avg_field(ctrl_data, "operational_violations"),
                emergency_violations=_avg_field(ctrl_data, "emergency_violations"),
                energy_kwh=_avg_field(ctrl_data, "total_facility_energy_kwh"),
                migrations=_avg_field(ctrl_data, "migration_count"),
            )
        )

    return BenchmarkResultsResponse(
        benchmark_id=_BENCHMARK_ID,
        simulator_version=data.get("simulator_version", "v2"),
        timestamp=data.get("benchmark_timestamp"),
        test_seeds=data.get("test_seeds", []),
        summary_table=summary_rows,
        criteria_results=data.get("criteria_results", {}),
        all_passed=data.get("all_passed"),
        note=data.get("note", ""),
    )


def _avg_field(ctrl_data: dict, field: str) -> float:
    """Average a metric across per_seed entries, or return direct value."""
    # Direct value at top level
    if field in ctrl_data and isinstance(ctrl_data[field], (int, float)):
        return float(ctrl_data[field])
    # Per-seed entries
    per_seed = ctrl_data.get("per_seed", [])
    if not per_seed:
        return 0.0
    vals = [s.get(field, 0.0) for s in per_seed if isinstance(s.get(field), (int, float))]
    return float(sum(vals) / max(len(vals), 1))


# ---------------------------------------------------------------------------
# WS /stream
# ---------------------------------------------------------------------------
@router.websocket("/stream")
async def websocket_stream(ws: WebSocket) -> None:
    """Server-to-client telemetry WebSocket.

    Accepts only ``ping`` messages from the client (connection management).
    All run commands go through REST POST /runs/{id}/commands.
    """
    await ws_mgr.connect(ws)

    # Send initial connected message
    session = session_mgr.current_session
    connected_data: dict[str, Any] = {"connections": ws_mgr.active_connections}
    if session is not None:
        connected_data["run"] = session.get_summary().model_dump()
    msg = WSMessage(type="connected", data=connected_data)
    await ws.send_text(msg.model_dump_json())

    try:
        while True:
            # Listen for client messages (only ping accepted)
            raw = await ws.receive_text()
            try:
                client_msg = json.loads(raw)
                if client_msg.get("type") == "ping":
                    pong = WSMessage(type="pong")
                    await ws.send_text(pong.model_dump_json())
            except (json.JSONDecodeError, AttributeError):
                pass  # Ignore malformed messages
    except WebSocketDisconnect:
        ws_mgr.disconnect(ws)
    except Exception:
        ws_mgr.disconnect(ws)
