from __future__ import annotations

from contextlib import asynccontextmanager
import hmac
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response

from .camera import CameraSource
from .models import (
    CameraStatus,
    MediaSessionCreate,
    MediaSessionStatus,
    MediaSessionViewersUpdate,
)
from .sessions import SessionManager
from .settings import camera_configs, settings
from .telemetry import TelemetryPublisher


ROOT = Path(__file__).resolve().parents[1]

cameras: dict[str, CameraSource] = {}
for cfg in camera_configs():
    if not cfg.get("enabled", True):
        continue
    camera = CameraSource(cfg)
    cameras[camera.device_id] = camera

sessions = SessionManager(cameras)
telemetry = TelemetryPublisher(cameras, sessions.summary_for_camera)


def camera_status(camera: CameraSource) -> CameraStatus:
    summary = sessions.summary_for_camera(camera.device_id)
    snap = camera.latest()

    return CameraStatus(
        deviceId=camera.device_id,
        sourceType=camera.source_type,
        online=camera.online,
        videoAvailable=camera.video_available,
        width=camera.width,
        height=camera.height,
        fps=camera.fps,
        streamState=summary["streamState"],
        activeMediaSessions=summary["activeMediaSessions"],
        activeViewers=summary["activeViewers"],
        lastFrameAt=snap.captured_at if snap else None,
        location=camera.location,
        zone=camera.zone,
        capabilities=camera.capabilities,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    for camera in cameras.values():
        camera.start()
    telemetry.start()
    yield
    telemetry.stop()
    await sessions.shutdown()
    for camera in cameras.values():
        camera.stop()


app = FastAPI(
    title="Vernatun Edge Media",
    version="1.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def local_auth(request: Request, call_next):
    if request.url.path.startswith("/v1/"):
        if not settings.api_key:
            return Response(
                content='{"error":"edge_media_auth_not_configured"}',
                media_type="application/json",
                status_code=503,
            )
        supplied = request.headers.get("X-Vernatun-Edge-Key", "")
        if not hmac.compare_digest(supplied, settings.api_key):
            return Response(
                content='{"error":"edge_media_unauthorized"}',
                media_type="application/json",
                status_code=401,
            )
    return await call_next(request)


@app.get("/health")
def health():
    online = sum(1 for c in cameras.values() if c.online)
    live = sum(
        1
        for s in sessions.sessions.values()
        if s.status.state == "LIVE"
    )
    return {
        "status": "ok",
        "service": "Vernatun Edge Media",
        "version": "1.0.0",
        "edgeId": settings.edge_id,
        "cameras": len(cameras),
        "camerasOnline": online,
        "activeStreams": live,
    }


@app.get("/v1/cameras", response_model=list[CameraStatus])
def list_cameras(x_vernatun_edge_key: str | None = Header(default=None)):
    return [camera_status(c) for c in cameras.values()]


@app.get("/v1/cameras/{device_id}", response_model=CameraStatus)
def get_camera(device_id: str):
    camera = cameras.get(device_id)
    if not camera:
        raise HTTPException(404, detail="CAMERA_NOT_FOUND")
    return camera_status(camera)


@app.post("/v1/cameras/{device_id}/snapshot")
def snapshot(device_id: str):
    camera = cameras.get(device_id)
    if not camera:
        raise HTTPException(404, detail="CAMERA_NOT_FOUND")
    if "CAMERA.SNAPSHOT" not in camera.capabilities:
        raise HTTPException(403, detail="CAPABILITY_NOT_SUPPORTED")

    try:
        jpeg, captured_at = camera.snapshot_jpeg(settings.snapshot_quality)
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc))

    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={
            "X-Vernatun-Device-Id": device_id,
            "X-Vernatun-Captured-At": captured_at,
            "Cache-Control": "no-store",
        },
    )


@app.post("/v1/media/sessions", response_model=MediaSessionStatus)
async def start_media_session(req: MediaSessionCreate):
    try:
        return await sessions.create(req)
    except KeyError as exc:
        raise HTTPException(404, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(403, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))
    except Exception:
        # Keep provider URLs, stream keys and response bodies out of API errors.
        raise HTTPException(502, detail="MEDIA_PUBLISH_FAILED")


@app.get("/v1/media/sessions/{session_id}", response_model=MediaSessionStatus)
def get_media_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError:
        raise HTTPException(404, detail="MEDIA_SESSION_NOT_FOUND")


@app.patch(
    "/v1/media/sessions/{session_id}/viewers",
    response_model=MediaSessionStatus,
)
def set_media_session_viewers(
    session_id: str,
    body: MediaSessionViewersUpdate,
):
    try:
        return sessions.set_viewers(session_id, body.activeViewers)
    except KeyError:
        raise HTTPException(404, detail="MEDIA_SESSION_NOT_FOUND")


@app.delete(
    "/v1/media/sessions/{session_id}",
    response_model=MediaSessionStatus,
)
async def stop_media_session(session_id: str):
    try:
        return await sessions.stop(session_id)
    except KeyError:
        raise HTTPException(404, detail="MEDIA_SESSION_NOT_FOUND")
