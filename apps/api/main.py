"""FastAPI application entrypoint for the Data Center Twin API.

Launch:
    uvicorn apps.api.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from packages.contracts.schemas import ControllerName, ScenarioName
from apps.api.model_loader import registry
from apps.api.routes import router, session_mgr, ws_mgr, websocket_stream


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load pretrained models and config at startup."""
    registry.load()

    # Wire WebSocket broadcast callback into the session manager
    async def _broadcast(run_id: str, frame):
        await ws_mgr.broadcast_telemetry(run_id, frame)

    session_mgr.set_broadcast_callback(_broadcast)

    # Auto-initialize active simulation run for immediate telemetry
    try:
        session_mgr.create_session(
            cfg=registry.cfg,
            controller_name=ControllerName.JOINT_RL,
            scenario_name=ScenarioName.COOLING_FAILURE,
            seed=42,
            step_rate_hz=2.0,
            cooling_only_model=registry.cooling_only_model,
            joint_rl_model=registry.joint_rl_model,
        )
        await session_mgr.start_playback()
    except Exception as e:
        print(f"Initial run auto-start notice: {e}")

    yield  # Application runs

    # Cleanup: stop any active run
    await session_mgr.stop()


app = FastAPI(
    title="Data Center Twin API",
    version="1.0.0",
    description=(
        "Autonomous Data Center Thermal + Workload Controller. "
        "Simulator-v2 with heterogeneous zones."
    ),
    lifespan=lifespan,
)

# CORS — allow all origins for hackathon demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    """WebSocket telemetry endpoint matching frontend VITE_WS_URL."""
    await websocket_stream(ws)
