import json
import os
import random
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

EP = cfg("cloud.endpoints", {})
DB_PATH = DATA_DIR / "cloud-sync.db"

LOCK = threading.RLock()
STOP = threading.Event()
SESSION = requests.Session()
TB_SESSION = requests.Session()

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
            json.dumps(command, ensure_ascii=False),
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
            ws.send(json.dumps(hello))

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
                    try:
                        ws.send(json.dumps({"type": "COMMAND_RESULT", "result": result}))
                    except Exception:
                        pass
                elif msg_type == "PING":
                    ws.send(json.dumps({"type": "PONG", "timestamp": now_iso()}))
                elif msg_type == "CONFIG":
                    state_set("lastCloudConfig", msg)
                else:
                    log(f"Ignoring unknown cloud message type: {msg_type}")

            try:
                ws.close()
            except Exception:
                pass

        except Exception as exc:
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
    last_register_attempt = 0

    while not STOP.is_set():
        cloud_health_check()
        local_command_health_check()

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
