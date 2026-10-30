from __future__ import annotations

import asyncio
import ipaddress
from dataclasses import dataclass, field as dataclass_field
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlsplit

from .models import MediaSessionCreate, MediaSessionStatus
from .settings import settings
from .webrtc import WhipPublisher


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class ManagedSession:
    request: MediaSessionCreate
    status: MediaSessionStatus
    publisher: Optional[WhipPublisher] = None
    operation_lock: asyncio.Lock = dataclass_field(default_factory=asyncio.Lock)
    expiry_task: Optional[asyncio.Task] = None


def _validate_publish_url(value: str) -> None:
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("PUBLISH_HOST_NOT_ALLOWED")

    allowed = settings.allowed_publish_hosts
    if not any(host == suffix or host.endswith("." + suffix) for suffix in allowed):
        raise ValueError("PUBLISH_HOST_NOT_ALLOWED")


class SessionManager:
    def __init__(self, cameras):
        self.cameras = cameras
        self.sessions: dict[str, ManagedSession] = {}
        self._lock = asyncio.Lock()

    def summary_for_camera(self, device_id: str) -> dict:
        sessions = [
            s.status
            for s in self.sessions.values()
            if s.status.deviceId == device_id
            and s.status.state in {"STARTING", "LIVE", "STOPPING"}
        ]

        if any(s.state == "LIVE" for s in sessions):
            state = "LIVE"
        elif any(s.state == "STARTING" for s in sessions):
            state = "STARTING"
        elif any(s.state == "STOPPING" for s in sessions):
            state = "STOPPING"
        else:
            camera = self.cameras.get(device_id)
            state = "IDLE" if camera and camera.video_available else "OFFLINE"

        return {
            "streamState": state,
            "activeMediaSessions": len(sessions),
            "activeViewers": sum(int(s.activeViewers or 0) for s in sessions),
        }

    async def create(self, req: MediaSessionCreate) -> MediaSessionStatus:
        _validate_publish_url(req.publishUrl)
        now = datetime.now(timezone.utc)
        expiry = req.expiresAt.astimezone(timezone.utc)
        if expiry <= now:
            raise RuntimeError("MEDIA_SESSION_EXPIRED")
        expiry = min(expiry, now + timedelta(seconds=settings.session_max_seconds))

        async with self._lock:
            if req.sessionId in self.sessions:
                return self.sessions[req.sessionId].status

            camera = self.cameras.get(req.deviceId)
            if not camera:
                raise KeyError("CAMERA_NOT_FOUND")
            if "CAMERA.LIVE_VIEW" not in camera.capabilities:
                raise PermissionError("CAPABILITY_NOT_SUPPORTED")
            if not camera.video_available:
                raise RuntimeError("CAMERA_UNAVAILABLE")

            status = MediaSessionStatus(
                sessionId=req.sessionId,
                deviceId=req.deviceId,
                state="STARTING",
            )
            managed = ManagedSession(request=req, status=status)
            self.sessions[req.sessionId] = managed

        async with managed.operation_lock:
            publisher = WhipPublisher(
                camera=camera,
                publish_url=req.publishUrl,
                publisher_token=req.publisherToken,
                ice_servers=[x.model_dump() for x in req.iceServers],
                timeout_seconds=settings.whip_timeout_seconds,
            )
            managed.publisher = publisher
            try:
                await publisher.start()
                managed.status.state = "LIVE"
                managed.status.startedAt = utc_now()
                remaining = max(0.0, (expiry - datetime.now(timezone.utc)).total_seconds())
                managed.expiry_task = asyncio.create_task(
                    self._expire(req.sessionId, remaining),
                    name=f"edge-media-expiry-{req.sessionId}",
                )
                return managed.status
            except Exception:
                managed.status.state = "FAILED"
                managed.status.failureCode = "WEBRTC_PUBLISH_FAILED"
                managed.status.failureMessage = "Publisher connection failed; check local service logs."
                try:
                    await publisher.stop()
                except Exception:
                    pass
                managed.publisher = None
                managed.request.publisherToken = ""
                managed.request.publishUrl = ""
                raise

    async def _expire(self, session_id: str, delay: float) -> None:
        await asyncio.sleep(delay)
        try:
            await self.stop(session_id)
        except KeyError:
            return

    async def stop(self, session_id: str) -> MediaSessionStatus:
        managed = self.sessions.get(session_id)
        if not managed:
            raise KeyError("MEDIA_SESSION_NOT_FOUND")

        async with managed.operation_lock:
            if managed.status.state == "IDLE":
                return managed.status
            if managed.expiry_task and managed.expiry_task is not asyncio.current_task():
                managed.expiry_task.cancel()
            if managed.status.state not in {"FAILED", "OFFLINE"}:
                managed.status.state = "STOPPING"

            if managed.publisher:
                await managed.publisher.stop()
                managed.publisher = None

            managed.status.state = "IDLE"
            managed.status.stoppedAt = utc_now()
            managed.request.publisherToken = ""
            managed.request.publishUrl = ""
            return managed.status

    def get(self, session_id: str) -> MediaSessionStatus:
        managed = self.sessions.get(session_id)
        if not managed:
            raise KeyError("MEDIA_SESSION_NOT_FOUND")
        return managed.status

    def set_viewers(self, session_id: str, count: int) -> MediaSessionStatus:
        status = self.get(session_id)
        status.activeViewers = int(count)
        return status

    async def shutdown(self):
        for session_id in list(self.sessions):
            managed = self.sessions[session_id]
            if managed.status.state in {"STARTING", "LIVE", "STOPPING"}:
                try:
                    await self.stop(session_id)
                except Exception:
                    pass
