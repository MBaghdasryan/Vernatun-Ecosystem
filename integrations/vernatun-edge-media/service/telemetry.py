from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Callable

import paho.mqtt.client as mqtt

from .settings import settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class TelemetryPublisher:
    def __init__(self, cameras, session_summary: Callable[[str], dict]):
        self.cameras = cameras
        self.session_summary = session_summary
        self.client = None
        self._thread = None
        self._stop = threading.Event()

    def start(self):
        if not settings.mqtt_enabled:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _connect(self):
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        except Exception:
            client = mqtt.Client()
        client.connect(settings.mqtt_host, settings.mqtt_port, 60)
        client.loop_start()
        self.client = client

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        self._disconnect()

    def _disconnect(self):
        client = self.client
        self.client = None
        if client:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception:
                pass

    def _run(self):
        while not self._stop.is_set():
            if not self.client or not self.client.is_connected():
                self._disconnect()
                try:
                    self._connect()
                except Exception:
                    self._stop.wait(5)
                    continue

            for camera in self.cameras.values():
                summary = self.session_summary(camera.device_id)
                snap = camera.latest()

                payload = {
                    "online": bool(camera.online),
                    "camera_open": bool(camera.online),
                    "video_loss": not bool(camera.video_available),
                    "tamper": False,
                    "fps": camera.fps if camera.online else 0.0,
                    "width": camera.width if camera.online else 0,
                    "height": camera.height if camera.online else 0,
                    "last_frame_at": snap.captured_at if snap else None,
                    "media_service_online": True,
                    "mqtt_connected": bool(self.client and self.client.is_connected()),
                    "stream_state": summary["streamState"],
                    "active_viewers": summary["activeViewers"],
                    "active_media_sessions": summary["activeMediaSessions"],
                    "source_type": camera.source_type,
                    "adapter_version": "edge-media-1.0.0",
                    "observed_at": utc_now(),
                }

                topic = f"vernatun/{settings.site_code}/camera/{camera.device_id}"
                body = json.dumps(payload, separators=(",", ":"))
                try:
                    result = self.client.publish(
                        topic,
                        body,
                        qos=settings.mqtt_qos,
                        retain=False,
                    )
                    if result.rc != mqtt.MQTT_ERR_SUCCESS:
                        self._disconnect()
                        break
                except Exception:
                    self._disconnect()
                    break

            self._stop.wait(settings.telemetry_interval)
