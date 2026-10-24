import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


EDGE_ID = os.environ.get("VERNATUN_TEST_EDGE_ID", "")
TENANT_ID = os.environ.get("VERNATUN_TEST_TENANT_ID", "")
BUILDING_ID = os.environ.get("VERNATUN_TEST_BUILDING_ID", "")
DEVICE_ID = os.environ.get("VERNATUN_TEST_DEVICE_ID", "Barrier-01")
DEVICE_UUID = os.environ.get("VERNATUN_TEST_DEVICE_UUID", "")
LOCAL_KEY = os.environ.get("VERNATUN_EDGE_LOCAL_API_KEY", "")
if not all((EDGE_ID, TENANT_ID, BUILDING_ID, DEVICE_ID, DEVICE_UUID, LOCAL_KEY)):
    raise RuntimeError("TEST identity, simulated device, and local API key are required")


def dry_run_decision(command, key):
    context = command.get("context") if isinstance(command.get("context"), dict) else {}
    device_ids = {command.get("edgeDeviceId"), command.get("deviceId"), command.get("thingsboardId")}
    allowed_devices = {DEVICE_ID, DEVICE_UUID}
    if not hmac.compare_digest(str(key or ""), LOCAL_KEY):
        return 401, {"decision": "DENY", "reason": "invalid_local_key", "physicalAction": False}
    if command.get("commandId") is None or command.get("idempotencyKey") is None:
        return 400, {"decision": "DENY", "reason": "missing_command_identity", "physicalAction": False}
    if command.get("capability") != "BARRIER.OPEN":
        return 403, {"decision": "DENY", "reason": "dry_run_allows_barrier_open_only", "physicalAction": False}
    if not device_ids.intersection(allowed_devices):
        return 403, {"decision": "DENY", "reason": "not_the_test_device", "physicalAction": False}
    if command.get("tenantId") != TENANT_ID or command.get("buildingId") != BUILDING_ID:
        return 403, {"decision": "DENY", "reason": "test_scope_mismatch", "physicalAction": False}
    if context.get("edgeId") != EDGE_ID:
        return 403, {"decision": "DENY", "reason": "test_edge_mismatch", "physicalAction": False}
    return 200, {
        "decision": "ALLOW",
        "execution": "DRY_RUN",
        "simulated": True,
        "deviceId": DEVICE_ID,
        "physicalAction": False,
        "commandId": command.get("commandId"),
    }


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok", "mode": "dry-run-only", "physicalAction": False})
        else:
            self.respond(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/commands":
            self.respond(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 65536:
            self.respond(413, {"error": "request_too_large", "physicalAction": False})
            return
        try:
            command = json.loads(self.rfile.read(length))
            if not isinstance(command, dict):
                raise ValueError("command_must_be_object")
        except (json.JSONDecodeError, ValueError):
            self.respond(400, {"decision": "DENY", "reason": "invalid_json", "physicalAction": False})
            return
        status, result = dry_run_decision(command, self.headers.get("X-Vernatun-Edge-Key"))
        self.respond(status, result)

    def log_message(self, _format, *_args):
        return


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8091), Handler).serve_forever()
