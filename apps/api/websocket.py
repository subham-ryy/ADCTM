"""WebSocket connection manager for server-to-client telemetry.

Server-to-client only.  The WebSocket accepts only connection-management
messages (e.g. ``ping``).  All control commands (pause, resume, step, etc.)
go through the REST ``POST /api/v1/runs/{run_id}/commands`` endpoint.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import WebSocket

from packages.contracts.schemas import WSMessage, TelemetryFrame


class ConnectionManager:
    """Manages active WebSocket client connections."""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast_telemetry(
        self, run_id: str, frame: TelemetryFrame
    ) -> None:
        """Send a telemetry frame to all connected clients."""
        msg = WSMessage(type="telemetry", run_id=run_id, data=frame.model_dump())
        payload = msg.model_dump_json()
        disconnected: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)

    async def broadcast_run_state(
        self, run_id: str, status: str
    ) -> None:
        """Send a run state change to all connected clients."""
        msg = WSMessage(type="run_state", run_id=run_id, data={"status": status})
        payload = msg.model_dump_json()
        disconnected: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)

    @property
    def active_connections(self) -> int:
        return len(self._connections)
