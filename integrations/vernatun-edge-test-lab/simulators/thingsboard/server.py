import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


DEVICE_ID = os.environ.get("VERNATUN_TEST_DEVICE_UUID", "")
if not DEVICE_ID:
    raise RuntimeError("VERNATUN_TEST_DEVICE_UUID is required")

def device_inventory():
    return {
        "data": [{
            "id": {"id": DEVICE_ID},
            "name": "Barrier-01",
            "label": "TEST ONLY — DRY RUN, no actuator",
            "deviceProfileName": "Vernatun Barrier",
            "active": True,
        }],
        "hasNext": False,
    }


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/auth/login":
            self.respond(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 4096:
            self.respond(413, {"error": "request_too_large"})
            return
        self.rfile.read(length)
        self.respond(200, {"token": "test-only-thingsboard-simulator-token"})

    def do_GET(self):
        if self.path.startswith("/api/tenant/deviceInfos?"):
            self.respond(200, device_inventory())
            return
        self.respond(404, {"error": "not_found"})

    def log_message(self, _format, *_args):
        return


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
