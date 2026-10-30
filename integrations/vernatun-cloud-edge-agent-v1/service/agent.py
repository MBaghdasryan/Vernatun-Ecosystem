import json
import os
import random
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
import websocket
import yaml

AGENT_VERSION = "1.0.0"
CONFIG_PATH = Path(os.getenv("VERNATUN_EDGE_CONFIG", "/app/config/vernatun_edge_cloud_v1.yaml"))
DATA_DIR = Path(os.getenv("VERNATUN_EDGE_DATA_DIR", "/app/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

with CONFIG_PATH.open("r", encoding="utf-8") as f:
    CFG = yaml.safe_load(f)

def cfg(path, default=None):
    cur = CFG
    for key in path.split("."):
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur

def env(name, default=None):
    value = os.getenv(name)
    return value if value not in (None, "") else default

EDGE_ID = env("VERNATUN_EDGE_ID", cfg("identity.edge_id"))
EDGE_NAME = env("VERNATUN_EDGE_NAME", cfg("identity.edge_name"))
TENANT_ID = env("VERNATUN_TENANT_ID", cfg("identity.tenant_id"))
BUILDING_ID = env("VERNATUN_BUILDING_ID", cfg("identity.building_id"))
SITE_CODE = env("VERNATUN_SITE_CODE", cfg("identity.site_code"))

CLOUD_BASE = env("VERNATUN_CLOUD_API_BASE_URL", cfg("cloud.api_base_url")).rstrip("/")
CLOUD_HEALTH = env("VERNATUN_CLOUD_HEALTH_URL", cfg("cloud.health_url"))
BOOTSTRAP_TOKEN = env("VERNATUN_EDGE_BOOTSTRAP_TOKEN", "")
CLIENT_ID = env("VERNATUN_EDGE_CLIENT_ID", "")
CLIENT_SECRET = env("VERNATUN_EDGE_CLIENT_SECRET", "")

LOCAL_COMMAND_URL = env("VERNATUN_EDGE_COMMAND_URL", cfg("local.command_authorization.base_url")).rstrip("/")
LOCAL_COMMAND_KEY = env("VERNATUN_EDGE_LOCAL_API_KEY", "")
MEDIA_URL = env("VERNATUN_EDGE_MEDIA_URL", cfg("local.media.base_url", "http://host.docker.internal:8093")).rstrip("/")
MEDIA_KEY = env("VERNATUN_EDGE_MEDIA_API_KEY", LOCAL_COMMAND_KEY)
TB_URL = env("VERNATUN_TB_URL", cfg("local.thingsboard.base_url")).rstrip("/")
TB_USERNAME = env("VERNATUN_TB_USERNAME", "tenant@thingsboard.org")
TB_PASSWORD = env("VERNATUN_TB_PASSWORD", "tenant")
LOCAL_AGENT_KEY = env("VERNATUN_AGENT_LOCAL_KEY", "")

LISTEN_HOST = cfg("agent.listen_host", "0.0.0.0")
LISTEN_PORT = int(cfg("agent.listen_port", 8092))
HTTP_TIMEOUT = int(cfg("cloud.transport.request_timeout_seconds", 20))
HEARTBEAT_SECONDS = int(cfg("cloud.transport.heartbeat_interval_seconds", 30))
INVENTORY_SECONDS = int(cfg("sync.inventory.interval_seconds", 300))
QUEUE_RETRY_SECONDS = int(cfg("sync.offline_queue.retry_interval_seconds", 10))
MEDIA_HEALTH_SECONDS = int(cfg("local.media.health_interval_seconds", 30))
MEDIA_TIMEOUT = int(cfg("local.media.request_timeout_seconds", 20))

EP = cfg("cloud.endpoints", {})
DB_PATH = DATA_DIR / "cloud-sync.db"

LOCK = threading.RLock()
WS_LOCK = threading.RLock()
STOP = threading.Event()
SESSION = requests.Session()
TB_SESSION = requests.Session()
ACTIVE_WS = {"socket": None}

STATE = {
    "startedAt": None,
    "cloudHealth": "UNKNOWN",
    "cloudHealthHttp": None,
    "cloudHealthError": None,
    "localCommandHealth": "UNKNOWN",
    "registrationState": "STARTING",
    "registrationHttp": None,
    "registrationError": None,
    "websocketState": "DISCONNECTED",
    "lastHeartbeatAt": None,
    "lastHeartbeatStatus": None,
    "lastInventoryAt": None,
    "lastInventoryStatus": None,
    "lastCommandAt": None,
    "lastCommandStatus": None,
    "media": {
        "status": "UNKNOWN",
        "serviceVersion": None,
        "cameras": 0,
        "camerasOnline": 0,
        "activeStreams": 0,
        "cameraPublisher": False,
        "cameraDeviceIds": [],
        "snapshotDeviceIds": [],
        "lastCheckAt": None,
        "lastErrorCode": None,
    },
}
TB_TOKEN = {"token": None, "at": 0}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def log(msg):
    print(f"{now_iso()} {msg}", flush=True)

def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS agent_state(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS outbox(
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            command_id TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_retry_at REAL NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS command_log(
            command_id TEXT PRIMARY KEY,
            idempotency_key TEXT,
            payload_json TEXT NOT NULL,
            result_json TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        """)
        db.commit()

def state_set(key, value):
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            INSERT INTO agent_state(key,value,updated_at) VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """, (key, json.dumps(value, ensure_ascii=False), now_iso()))
        db.commit()

def state_get(key, default=None):
    with sqlite3.connect(DB_PATH) as db:
        row = db.execute("SELECT value FROM agent_state WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row[0])
    except Exception:
        return row[0]

def queue_put(kind, payload, command_id=None):
    item_id = str(uuid.uuid4())
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            INSERT INTO outbox(id,kind,payload_json,command_id,created_at)
            VALUES(?,?,?,?,?)
        """, (item_id, kind, json.dumps(payload, ensure_ascii=False), command_id, now_iso()))
        db.commit()
    return item_id

def queue_depth():
    with sqlite3.connect(DB_PATH) as db:
        return db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]

def current_cloud_token():
    issued = state_get("cloudAccessToken")
    if issued:
        return issued
    if CLIENT_SECRET:
        return CLIENT_SECRET
    return BOOTSTRAP_TOKEN

def cloud_headers(use_bootstrap=False):
    token = BOOTSTRAP_TOKEN if use_bootstrap else current_cloud_token()
    h = {
        "Content-Type": "application/json",
        "X-Vernatun-Edge-Id": EDGE_ID,
        "X-Vernatun-Tenant-Id": TENANT_ID,
        "X-Vernatun-Building-Id": BUILDING_ID,
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    if CLIENT_ID:
        h["X-Vernatun-Client-Id"] = CLIENT_ID
    return h

def identity_ready():
    values = [EDGE_ID, TENANT_ID, BUILDING_ID]
    return all(values) and not any(str(v).startswith("REPLACE_") for v in values)

def cloud_health_check():
    try:
        r = SESSION.get(CLOUD_HEALTH, timeout=HTTP_TIMEOUT)
        with LOCK:
            STATE["cloudHealthHttp"] = r.status_code
            STATE["cloudHealth"] = "REACHABLE" if r.ok else "HTTP_ERROR"
            STATE["cloudHealthError"] = None if r.ok else r.text[:500]
        return r.ok
    except Exception as exc:
        with LOCK:
            STATE["cloudHealth"] = "UNREACHABLE"
            STATE["cloudHealthHttp"] = None
            STATE["cloudHealthError"] = str(exc)
        return False

def local_command_health_check():
    try:
        r = SESSION.get(LOCAL_COMMAND_URL + cfg("local.command_authorization.health_path", "/health"), timeout=5)
        with LOCK:
            STATE["localCommandHealth"] = "OK" if r.ok else f"HTTP_{r.status_code}"
        return r.ok
    except Exception as exc:
        with LOCK:
            STATE["localCommandHealth"] = "UNREACHABLE"
        return False

def registration_payload():
    return {
        "edgeId": EDGE_ID,
        "edgeName": EDGE_NAME,
        "tenantId": TENANT_ID,
        "buildingId": BUILDING_ID,
        "siteCode": SITE_CODE,
        "agentVersion": AGENT_VERSION,
        "platform": "Vernatun Edge",
        "connectionMode": "OUTBOUND",
        "transports": ["WEBSOCKET", "HTTPS"],
        "capabilities": {
            "commandAuthorization": True,
            "offlineQueue": True,
            "inventorySync": True,
            "telemetryQueue": True,
            "eventsQueue": True,
            "alarmsQueue": True,
        }
    }

def register_edge():
    if not identity_ready():
        with LOCK:
            STATE["registrationState"] = "WAITING_IDENTITY"
            STATE["registrationError"] = "edge_id/tenant_id/building_id must be configured"
        return False

    if not BOOTSTRAP_TOKEN:
        with LOCK:
            STATE["registrationState"] = "WAITING_BOOTSTRAP_TOKEN"
            STATE["registrationError"] = None
        return False

    url = CLOUD_BASE + EP["register"]
    try:
        r = SESSION.post(url, json=registration_payload(), headers=cloud_headers(use_bootstrap=True), timeout=HTTP_TIMEOUT)
        with LOCK:
            STATE["registrationHttp"] = r.status_code

        if r.status_code in (404, 405):
            with LOCK:
                STATE["registrationState"] = "CLOUD_EDGE_API_NOT_IMPLEMENTED"
                STATE["registrationError"] = f"Cloud endpoint {EP['register']} returned HTTP {r.status_code}"
            return False

        if not r.ok:
            with LOCK:
                STATE["registrationState"] = "REGISTRATION_FAILED"
                STATE["registrationError"] = r.text[:1000]
            return False

        body = r.json() if r.content else {}
        access_token = body.get("accessToken") or body.get("token") or body.get("edgeToken")
        if access_token:
            state_set("cloudAccessToken", access_token)
        if body.get("clientId"):
            state_set("cloudClientId", body["clientId"])

        state_set("registered", True)
        state_set("registeredAt", now_iso())

        with LOCK:
            STATE["registrationState"] = "REGISTERED"
            STATE["registrationError"] = None
        return True
    except Exception as exc:
        with LOCK:
            STATE["registrationState"] = "REGISTRATION_ERROR"
            STATE["registrationError"] = str(exc)
        return False

def ensure_registration():
    if state_get("registered", False):
        with LOCK:
            STATE["registrationState"] = "REGISTERED"
        return True
    return register_edge()

def cloud_post(path, payload):
    r = SESSION.post(CLOUD_BASE + path, json=payload, headers=cloud_headers(), timeout=HTTP_TIMEOUT)
    if not r.ok:
        raise RuntimeError(f"Cloud HTTP {r.status_code}: {r.text[:1000]}")
    if r.content:
        try:
            return r.json()
        except Exception:
            return {"raw": r.text}
    return None

def heartbeat_payload():
    return {
        "edgeId": EDGE_ID,
        "tenantId": TENANT_ID,
        "buildingId": BUILDING_ID,
        "siteCode": SITE_CODE,
        "status": "ONLINE",
        "agentVersion": AGENT_VERSION,
        "timestamp": now_iso(),
        "local": {
            "commandAuthorization": STATE["localCommandHealth"],
            "queueDepth": queue_depth(),
        }
    }

def send_heartbeat():
    if not state_get("registered", False):
        return False
    try:
        cloud_post(EP["heartbeat"], heartbeat_payload())
        with LOCK:
            STATE["lastHeartbeatAt"] = now_iso()
            STATE["lastHeartbeatStatus"] = "SUCCESS"
        return True
    except Exception as exc:
        with LOCK:
            STATE["lastHeartbeatAt"] = now_iso()
            STATE["lastHeartbeatStatus"] = f"FAILED: {exc}"
        return False

def tb_login():
    r = TB_SESSION.post(
        TB_URL + "/api/auth/login",
        json={"username": TB_USERNAME, "password": TB_PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise RuntimeError("ThingsBoard returned no JWT")
    TB_TOKEN["token"] = token
    TB_TOKEN["at"] = time.time()

def tb_get(path):
    if not TB_TOKEN["token"]:
        tb_login()
    headers = {"X-Authorization": "Bearer " + TB_TOKEN["token"]}
    r = TB_SESSION.get(TB_URL + path, headers=headers, timeout=10)
    if r.status_code == 401:
        tb_login()
        headers = {"X-Authorization": "Bearer " + TB_TOKEN["token"]}
        r = TB_SESSION.get(TB_URL + path, headers=headers, timeout=10)
    r.raise_for_status()
    return r.json()

def collect_inventory():
    page = 0
    items = []
    vern_profiles = {
        "Vernatun Smoke Detector", "Vernatun Camera", "Vernatun Access Door",
        "Vernatun Barrier", "Vernatun Elevator", "Vernatun Water Meter",
        "Vernatun Electricity Meter", "Vernatun HVAC", "Vernatun Pump"
    }

    while True:
        data = tb_get(f"/api/tenant/deviceInfos?pageSize=100&page={page}&sortProperty=name&sortOrder=ASC")
        rows = data.get("data", [])
        for d in rows:
            profile_name = d.get("deviceProfileName") or d.get("type")
            if profile_name in vern_profiles:
                items.append({
                    "deviceId": d.get("name"),
                    "thingsboardId": ((d.get("id") or {}).get("id")),
                    "profile": profile_name,
                    "label": d.get("label"),
                    "active": d.get("active"),
                })
        if not data.get("hasNext"):
            break
        page += 1
        if page > 100:
            break

    # The local media inventory is authoritative for camera capabilities. It
    # augments existing ThingsBoard rows without replacing the Agent v1 sync.
    if MEDIA_KEY:
        try:
            response = SESSION.get(
                MEDIA_URL + cfg("local.media.cameras_path", "/v1/cameras"),
                headers=media_headers(),
                timeout=min(5, MEDIA_TIMEOUT),
            )
            response.raise_for_status()
            cameras = response.json()
            if isinstance(cameras, list):
                for camera in cameras:
                    if not isinstance(camera, dict) or not isinstance(camera.get("deviceId"), str):
                        continue
                    capabilities = [
                        item for item in camera.get("capabilities", [])
                        if item in ("CAMERA.LIVE_VIEW", "CAMERA.SNAPSHOT")
                    ] if isinstance(camera.get("capabilities"), list) else []
                    row = next((item for item in items if item.get("deviceId") == camera["deviceId"]), None)
                    if row is None:
                        row = {
                            "deviceId": camera["deviceId"],
                            "profile": "Vernatun Camera",
                            "label": camera.get("location") or camera.get("zone"),
                        }
                        items.append(row)
                    row["profile"] = "Vernatun Camera"
                    row["capabilities"] = capabilities
                    row["active"] = camera.get("online") is True
        except Exception:
            # Existing ThingsBoard inventory remains available when Media is off.
            pass

    return {
        "edgeId": EDGE_ID,
        "tenantId": TENANT_ID,
        "buildingId": BUILDING_ID,
        "timestamp": now_iso(),
        "devices": items
    }

def sync_inventory():
    if not state_get("registered", False):
        return False
    try:
        payload = collect_inventory()
        cloud_post(EP["inventory"], payload)
        with LOCK:
            STATE["lastInventoryAt"] = now_iso()
            STATE["lastInventoryStatus"] = f"SUCCESS ({len(payload['devices'])} devices)"
        return True
    except Exception as exc:
        with LOCK:
            STATE["lastInventoryAt"] = now_iso()
            STATE["lastInventoryStatus"] = f"FAILED: {exc}"
        return False

def local_command(command):
    command_id = command.get("commandId")
    idem = command.get("idempotencyKey")
    if not command_id or not idem:
        raise ValueError("Cloud command must contain commandId and idempotencyKey")
    if command.get("tenantId") != TENANT_ID:
        raise PermissionError("TENANT_SCOPE_MISMATCH")
    if command.get("buildingId") != BUILDING_ID:
        raise PermissionError("BUILDING_SCOPE_MISMATCH")
    if command.get("capability") in set(cfg("commands.hard_deny", [])):
        raise PermissionError("SAFETY_CRITICAL_HARD_DENY")

    command.setdefault("context", {})
    command["context"]["edgeId"] = EDGE_ID
    command["context"]["transport"] = "VERNATUN_CLOUD"
    command["context"]["cloudSource"] = command["context"].get("source")
    command["context"]["source"] = "VERNATUN_CLOUD"

    headers = {"X-Vernatun-Edge-Key": LOCAL_COMMAND_KEY, "Content-Type": "application/json"}
    r = SESSION.post(
        LOCAL_COMMAND_URL + cfg("local.command_authorization.command_path", "/v1/commands"),
        json=command,
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )

    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text}

    return r.status_code, body

def save_command(command, status, result=None):
    stored_command = dict(command)
    if isinstance(stored_command.get("snapshotUpload"), dict):
        stored_command["snapshotUpload"] = {"redacted": True}
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            INSERT INTO command_log(command_id,idempotency_key,payload_json,result_json,status,created_at,completed_at)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(command_id) DO UPDATE SET
              result_json=excluded.result_json,
              status=excluded.status,
              completed_at=excluded.completed_at
        """, (
            command.get("commandId"),
            command.get("idempotencyKey"),
            json.dumps(stored_command, ensure_ascii=False),
            json.dumps(result, ensure_ascii=False) if result is not None else None,
            status,
            now_iso(),
            now_iso() if result is not None else None,
        ))
        db.commit()

def process_cloud_command(command):
    command_id = command.get("commandId") or "unknown"
    with LOCK:
        STATE["lastCommandAt"] = now_iso()

    try:
        save_command(command, "RECEIVED")
        if command.get("capability") == "CAMERA.SNAPSHOT":
            http_status, local_result = process_camera_snapshot(command)
        else:
            http_status, local_result = local_command(command)
        result = {
            "edgeId": EDGE_ID,
            "tenantId": TENANT_ID,
            "buildingId": BUILDING_ID,
            "commandId": command_id,
            "status": "SUCCESS" if 200 <= http_status < 300 else "REJECTED",
            "localHttpStatus": http_status,
            "result": local_result,
            "timestamp": now_iso()
        }
        save_command(command, result["status"], result)
        with LOCK:
            STATE["lastCommandStatus"] = result["status"]
    except Exception as exc:
        result = {
            "edgeId": EDGE_ID,
            "tenantId": TENANT_ID,
            "buildingId": BUILDING_ID,
            "commandId": command_id,
            "status": "REJECTED",
            "error": str(exc),
            "timestamp": now_iso()
        }
        try:
            save_command(command, "REJECTED", result)
        except Exception:
            pass
        with LOCK:
            STATE["lastCommandStatus"] = "REJECTED"

    endpoint = EP["command_result"].replace("{command_id}", quote(command_id, safe=""))
    try:
        cloud_post(endpoint, result)
    except Exception as exc:
        queue_put("command_result", {"endpoint": endpoint, "payload": result}, command_id=command_id)

    return result

def media_headers():
    if not MEDIA_KEY:
        raise RuntimeError("MEDIA_SERVICE_KEY_NOT_CONFIGURED")
    return {"X-Vernatun-Edge-Key": MEDIA_KEY}

def media_health_check():
    checked_at = now_iso()
    media = {
        "status": "OFFLINE",
        "serviceVersion": None,
        "cameras": 0,
        "camerasOnline": 0,
        "activeStreams": 0,
        "cameraPublisher": False,
        "cameraDeviceIds": [],
        "snapshotDeviceIds": [],
        "lastCheckAt": checked_at,
        "lastErrorCode": None,
    }
    if not MEDIA_KEY:
        media["status"] = "DISABLED"
        media["lastErrorCode"] = "media_service_key_not_configured"
    else:
        try:
            health = SESSION.get(
                MEDIA_URL + cfg("local.media.health_path", "/health"),
                timeout=min(5, MEDIA_TIMEOUT),
            )
            health.raise_for_status()
            summary = health.json()
            cameras_response = SESSION.get(
                MEDIA_URL + cfg("local.media.cameras_path", "/v1/cameras"),
                headers=media_headers(),
                timeout=min(5, MEDIA_TIMEOUT),
            )
            cameras_response.raise_for_status()
            cameras = cameras_response.json()
            if not isinstance(cameras, list):
                raise ValueError("invalid_camera_inventory")
            capable_ids = sorted({
                str(camera.get("deviceId"))
                for camera in cameras
                if isinstance(camera, dict)
                and camera.get("online") is True
                and camera.get("videoAvailable") is True
                and "CAMERA.LIVE_VIEW" in (camera.get("capabilities") or [])
                and isinstance(camera.get("deviceId"), str)
            })
            snapshot_ids = sorted({
                str(camera.get("deviceId"))
                for camera in cameras
                if isinstance(camera, dict)
                and camera.get("online") is True
                and camera.get("videoAvailable") is True
                and "CAMERA.SNAPSHOT" in (camera.get("capabilities") or [])
                and isinstance(camera.get("deviceId"), str)
            })
            media.update({
                "status": "OK",
                "serviceVersion": str(summary.get("version") or "")[:40] or None,
                "cameras": max(0, int(summary.get("cameras", len(cameras)) or 0)),
                "camerasOnline": max(0, int(summary.get("camerasOnline", 0) or 0)),
                "activeStreams": max(0, int(summary.get("activeStreams", 0) or 0)),
                "cameraPublisher": bool(capable_ids),
                "cameraDeviceIds": capable_ids[:100],
                "snapshotDeviceIds": snapshot_ids[:100],
            })
        except Exception:
            # Keep addresses, credentials and provider responses out of diagnostics.
            media["lastErrorCode"] = "media_service_unavailable"
    with LOCK:
        STATE["media"] = media
    return media

def send_ws_message(ws, payload):
    target = ws
    if target is None:
        with WS_LOCK:
            target = ACTIVE_WS.get("socket")
    if not target:
        return False
    try:
        with WS_LOCK:
            if not getattr(target, "connected", False):
                return False
            target.send(json.dumps(payload, ensure_ascii=False))
        return True
    except Exception:
        return False

def send_media_capabilities(ws=None):
    with LOCK:
        media = dict(STATE["media"])
    return send_ws_message(ws, {
        "type": "MEDIA_CAPABILITIES",
        "protocolVersion": 1,
        "provider": "livekit",
        "cameraPublisher": media["cameraPublisher"],
        "cameraDeviceIds": media["cameraDeviceIds"],
        "snapshotDeviceIds": media["snapshotDeviceIds"],
        "rtspGateway": False,
    })

def send_media_state(ws, session_id, device_id, state, failure_code=None, failure_message=None):
    message = {
        "type": "MEDIA_SESSION_STATE",
        "sessionId": session_id,
        "deviceId": device_id,
        "state": state,
    }
    if failure_code:
        message["failureCode"] = failure_code
    if failure_message:
        message["failureMessage"] = failure_message
    send_ws_message(ws, message)

def handle_media_session_start(ws, message):
    session = message.get("session")
    if not isinstance(session, dict):
        session = message
    session_id = str(session.get("sessionId") or "")
    device_id = str(session.get("deviceId") or "")
    if not session_id or not device_id:
        return
    send_media_state(ws, session_id, device_id, "STARTING")
    try:
        response = SESSION.post(
            MEDIA_URL + cfg("local.media.sessions_path", "/v1/media/sessions"),
            json=session,
            headers=media_headers(),
            timeout=MEDIA_TIMEOUT,
        )
        if not response.ok:
            code = {
                401: "media_service_unauthorized",
                403: "media_camera_forbidden",
                404: "media_camera_not_found",
                409: "media_camera_unavailable",
                422: "media_session_invalid",
                502: "media_publish_failed",
            }.get(response.status_code, "media_start_rejected")
            send_media_state(
                ws, session_id, device_id, "FAILED", code,
                "The camera stream could not be started.",
            )
            return
        body = response.json()
        state = str(body.get("state") or "LIVE").upper()
        if state not in ("STARTING", "LIVE"):
            send_media_state(
                ws, session_id, device_id, "FAILED", "media_start_rejected",
                "The camera stream did not enter a live state.",
            )
            return
        send_media_state(ws, session_id, device_id, state)
    except Exception:
        send_media_state(
            ws, session_id, device_id, "FAILED", "media_service_unavailable",
            "The local media service is unavailable.",
        )

def handle_media_session_stop(ws, message):
    session_id = str(message.get("sessionId") or "")
    if not session_id:
        return
    send_media_state(ws, session_id, "", "STOPPING")
    try:
        response = SESSION.delete(
            MEDIA_URL + cfg("local.media.sessions_path", "/v1/media/sessions") + "/" + quote(session_id, safe=""),
            headers=media_headers(),
            timeout=min(10, MEDIA_TIMEOUT),
        )
        if response.status_code in (200, 204, 404):
            send_media_state(ws, session_id, "", "ENDED")
        else:
            send_media_state(
                ws, session_id, "", "FAILED", "media_stop_rejected",
                "The local media session could not be stopped.",
            )
    except Exception:
        send_media_state(
            ws, session_id, "", "FAILED", "media_service_unavailable",
            "The local media service is unavailable.",
        )

def process_camera_snapshot(command):
    if command.get("tenantId") != TENANT_ID:
        raise PermissionError("TENANT_SCOPE_MISMATCH")
    if command.get("buildingId") != BUILDING_ID:
        raise PermissionError("BUILDING_SCOPE_MISMATCH")
    device_id = str(command.get("edgeDeviceId") or command.get("deviceId") or "")
    upload = command.get("snapshotUpload")
    if not device_id or not isinstance(upload, dict):
        raise ValueError("SNAPSHOT_UPLOAD_NOT_CONFIGURED")
    upload_url = str(upload.get("url") or "")
    upload_token = str(upload.get("token") or "")
    target = urlparse(upload_url)
    cloud = urlparse(CLOUD_BASE)
    command_id = str(command.get("commandId") or "")
    expected_path = "/api/edge/v1/camera-snapshots/" + quote(command_id, safe="")
    if (
        target.scheme != "https"
        or target.hostname != cloud.hostname
        or target.port not in (None, 443)
        or target.username
        or target.password
        or target.path != expected_path
        or target.query
        or target.fragment
        or not upload_token
    ):
        raise ValueError("SNAPSHOT_UPLOAD_URL_INVALID")
    camera_url = MEDIA_URL + cfg("local.media.snapshot_path", "/v1/cameras/{device_id}/snapshot")
    camera_url = camera_url.replace("{device_id}", quote(device_id, safe=""))
    response = SESSION.post(camera_url, headers=media_headers(), timeout=MEDIA_TIMEOUT)
    if not response.ok:
        raise RuntimeError("CAMERA_SNAPSHOT_FAILED")
    jpeg = response.content
    if (
        not jpeg
        or len(jpeg) > 6 * 1024 * 1024
        or response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "image/jpeg"
        or not jpeg.startswith(b"\xff\xd8\xff")
    ):
        raise ValueError("CAMERA_SNAPSHOT_INVALID")
    uploaded = SESSION.put(
        upload_url,
        data=jpeg,
        headers={"Authorization": f"Bearer {upload_token}", "Content-Type": "image/jpeg"},
        timeout=MEDIA_TIMEOUT,
        allow_redirects=False,
    )
    if not uploaded.ok or uploaded.is_redirect:
        raise RuntimeError("SNAPSHOT_UPLOAD_FAILED")
    receipt = {}
    try:
        receipt = uploaded.json()
    except Exception:
        pass
    return uploaded.status_code, {
        "snapshotUploaded": True,
        "snapshotRef": receipt.get("snapshotRef") or f"/api/edge/commands/{quote(command_id, safe='')}/snapshot",
    }

def ws_url():
    parsed = urlparse(CLOUD_BASE)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return f"{scheme}://{parsed.netloc}{EP['websocket']}?edgeId={quote(EDGE_ID)}"

def websocket_loop():
    delay = int(cfg("cloud.transport.reconnect.initial_delay_seconds", 2))
    max_delay = int(cfg("cloud.transport.reconnect.max_delay_seconds", 60))

    while not STOP.is_set():
        if not state_get("registered", False):
            time.sleep(2)
            continue

        try:
            headers = [
                f"X-Vernatun-Edge-Id: {EDGE_ID}",
                f"X-Vernatun-Tenant-Id: {TENANT_ID}",
                f"X-Vernatun-Building-Id: {BUILDING_ID}",
            ]
            token = current_cloud_token()
            if token:
                headers.append(f"Authorization: Bearer {token}")

            with LOCK:
                STATE["websocketState"] = "CONNECTING"

            ws = websocket.create_connection(
                ws_url(),
                header=headers,
                timeout=HTTP_TIMEOUT,
                enable_multithread=True,
            )
            with WS_LOCK:
                ACTIVE_WS["socket"] = ws
            ws.settimeout(5)
            with LOCK:
                STATE["websocketState"] = "CONNECTED"
            log("Cloud WebSocket connected")
            delay = int(cfg("cloud.transport.reconnect.initial_delay_seconds", 2))

            hello = {
                "type": "EDGE_HELLO",
                "edgeId": EDGE_ID,
                "tenantId": TENANT_ID,
                "buildingId": BUILDING_ID,
                "agentVersion": AGENT_VERSION,
                "timestamp": now_iso()
            }
            send_ws_message(ws, hello)
            media_health_check()
            send_media_capabilities(ws)

            while not STOP.is_set():
                try:
                    raw = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not raw:
                    break
                msg = json.loads(raw)
                msg_type = str(msg.get("type", "")).upper()

                if msg_type == "COMMAND":
                    result = process_cloud_command(msg.get("command") or {})
                    send_ws_message(ws, {"type": "COMMAND_RESULT", "result": result})
                elif msg_type == "MEDIA_SESSION_START":
                    handle_media_session_start(ws, msg)
                elif msg_type == "MEDIA_SESSION_STOP":
                    handle_media_session_stop(ws, msg)
                elif msg_type == "PING":
                    send_ws_message(ws, {"type": "PONG", "timestamp": now_iso()})
                elif msg_type == "CONFIG":
                    state_set("lastCloudConfig", msg)
                else:
                    log(f"Ignoring unknown cloud message type: {msg_type}")

            try:
                ws.close()
            except Exception:
                pass
            with WS_LOCK:
                if ACTIVE_WS.get("socket") is ws:
                    ACTIVE_WS["socket"] = None

        except Exception as exc:
            with WS_LOCK:
                active = ACTIVE_WS.get("socket")
                if active is not None and not getattr(active, "connected", False):
                    ACTIVE_WS["socket"] = None
            with LOCK:
                STATE["websocketState"] = f"DISCONNECTED: {exc}"
            time.sleep(delay + random.random())
            delay = min(max_delay, max(delay + 1, delay * 2))

def flush_outbox():
    if not state_get("registered", False):
        return

    now = time.time()
    with sqlite3.connect(DB_PATH) as db:
        rows = db.execute("""
            SELECT id,kind,payload_json,command_id,attempts
            FROM outbox
            WHERE next_retry_at <= ?
            ORDER BY created_at ASC
            LIMIT 100
        """, (now,)).fetchall()

    for item_id, kind, payload_json, command_id, attempts in rows:
        payload = json.loads(payload_json)

        try:
            if kind == "command_result":
                endpoint = payload["endpoint"]
                body = payload["payload"]
            elif kind == "telemetry":
                endpoint = EP["telemetry_batch"]
                body = payload
            elif kind == "events":
                endpoint = EP["events_batch"]
                body = payload
            elif kind == "alarms":
                endpoint = EP["alarms_batch"]
                body = payload
            elif kind == "inventory":
                endpoint = EP["inventory"]
                body = payload
            else:
                endpoint = None
                body = payload

            if not endpoint:
                raise RuntimeError(f"Unknown outbox kind: {kind}")

            cloud_post(endpoint, body)

            with sqlite3.connect(DB_PATH) as db:
                db.execute("DELETE FROM outbox WHERE id=?", (item_id,))
                db.commit()
        except Exception as exc:
            backoff = min(300, QUEUE_RETRY_SECONDS * (2 ** min(attempts, 5)))
            with sqlite3.connect(DB_PATH) as db:
                db.execute("""
                    UPDATE outbox
                    SET attempts=attempts+1, next_retry_at=?, last_error=?
                    WHERE id=?
                """, (time.time() + backoff, str(exc)[:1000], item_id))
                db.commit()

def supervisor_loop():
    last_hb = 0
    last_inv = 0
    last_media = 0
    last_register_attempt = 0

    while not STOP.is_set():
        cloud_health_check()
        local_command_health_check()
        if time.time() - last_media >= MEDIA_HEALTH_SECONDS:
            with LOCK:
                was_ready = STATE["media"]["cameraPublisher"]
                prior_ids = STATE["media"]["cameraDeviceIds"]
                prior_snapshot_ids = STATE["media"]["snapshotDeviceIds"]
            media = media_health_check()
            if (media["cameraPublisher"] != was_ready or media["cameraDeviceIds"] != prior_ids
                or media["snapshotDeviceIds"] != prior_snapshot_ids):
                send_media_capabilities()
            last_media = time.time()

        if not state_get("registered", False):
            if time.time() - last_register_attempt >= 60:
                ensure_registration()
                last_register_attempt = time.time()
        else:
            if time.time() - last_hb >= HEARTBEAT_SECONDS:
                send_heartbeat()
                last_hb = time.time()

            if cfg("sync.inventory.enabled", True) and time.time() - last_inv >= INVENTORY_SECONDS:
                sync_inventory()
                last_inv = time.time()

            flush_outbox()

        STOP.wait(5)

def status_payload():
    with LOCK:
        state_copy = dict(STATE)
    return {
        "status": "ok",
        "service": "Vernatun Cloud Edge Agent",
        "version": AGENT_VERSION,
        "identity": {
            "edgeId": EDGE_ID,
            "edgeName": EDGE_NAME,
            "tenantId": TENANT_ID,
            "buildingId": BUILDING_ID,
            "siteCode": SITE_CODE,
        },
        "cloud": {
            "apiBaseUrl": CLOUD_BASE,
            "healthUrl": CLOUD_HEALTH,
            "health": state_copy["cloudHealth"],
            "healthHttp": state_copy["cloudHealthHttp"],
            "healthError": state_copy["cloudHealthError"],
            "registrationState": state_copy["registrationState"],
            "registrationHttp": state_copy["registrationHttp"],
            "registrationError": state_copy["registrationError"],
            "websocketState": state_copy["websocketState"],
        },
        "local": {
            "commandAuthorization": state_copy["localCommandHealth"],
            "queueDepth": queue_depth(),
        },
        "media": dict(state_copy["media"]),
        "sync": {
            "lastHeartbeatAt": state_copy["lastHeartbeatAt"],
            "lastHeartbeatStatus": state_copy["lastHeartbeatStatus"],
            "lastInventoryAt": state_copy["lastInventoryAt"],
            "lastInventoryStatus": state_copy["lastInventoryStatus"],
        },
        "commands": {
            "lastCommandAt": state_copy["lastCommandAt"],
            "lastCommandStatus": state_copy["lastCommandStatus"],
        }
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "VernatunCloudEdgeAgent/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.client_address[0]} - {fmt % args}", flush=True)

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def require_key(self):
        if not LOCAL_AGENT_KEY:
            self.send_json(500, {"error": "VERNATUN_AGENT_LOCAL_KEY_NOT_CONFIGURED"})
            return False
        if self.headers.get("X-Vernatun-Agent-Key", "") != LOCAL_AGENT_KEY:
            self.send_json(401, {"error": "UNAUTHORIZED"})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            self.send_json(200, status_payload())
            return

        if not self.require_key():
            return

        if path == "/v1/status":
            self.send_json(200, status_payload())
            return

        if path == "/v1/inventory":
            try:
                self.send_json(200, collect_inventory())
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return

        self.send_json(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        path = urlparse(self.path).path

        if not self.require_key():
            return

        if path == "/v1/register/retry":
            ok = register_edge()
            self.send_json(200 if ok else 409, status_payload())
            return

        if path == "/v1/sync/inventory":
            try:
                payload = collect_inventory()
                if state_get("registered", False):
                    try:
                        cloud_post(EP["inventory"], payload)
                        self.send_json(200, {"status": "SYNCED", "devices": len(payload["devices"])})
                    except Exception:
                        item = queue_put("inventory", payload)
                        self.send_json(202, {"status": "QUEUED", "queueId": item, "devices": len(payload["devices"])})
                else:
                    item = queue_put("inventory", payload)
                    self.send_json(202, {"status": "QUEUED", "queueId": item, "devices": len(payload["devices"])})
            except Exception as exc:
                self.send_json(502, {"error": str(exc)})
            return

        if path in ("/v1/queue/telemetry", "/v1/queue/events", "/v1/queue/alarms"):
            kind = path.rsplit("/", 1)[-1]
            body = self.read_json()
            envelope = {
                "edgeId": EDGE_ID,
                "tenantId": TENANT_ID,
                "buildingId": BUILDING_ID,
                "timestamp": now_iso(),
                "items": body.get("items", body if isinstance(body, list) else [body]),
            }
            item = queue_put(kind, envelope)
            self.send_json(202, {"status": "QUEUED", "queueId": item, "kind": kind})
            return

        self.send_json(404, {"error": "NOT_FOUND"})

def main():
    init_db()
    with LOCK:
        STATE["startedAt"] = now_iso()

    log(f"Vernatun Cloud Edge Agent v{AGENT_VERSION}")
    log(f"Edge identity: edge={EDGE_ID}, tenant={TENANT_ID}, building={BUILDING_ID}")
    log(f"Cloud API: {CLOUD_BASE}")
    log(f"Local Command Layer: {LOCAL_COMMAND_URL}")

    threading.Thread(target=supervisor_loop, name="supervisor", daemon=True).start()
    threading.Thread(target=websocket_loop, name="cloud-websocket", daemon=True).start()

    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    try:
        server.serve_forever()
    finally:
        STOP.set()
        server.server_close()

if __name__ == "__main__":
    main()
