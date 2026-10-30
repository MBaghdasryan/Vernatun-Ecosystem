from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class FrameSnapshot:
    frame: np.ndarray
    captured_at: str


class CameraSource:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.device_id = str(cfg["deviceId"])
        self.source_type = str(cfg.get("sourceType", "USB_WEBCAM")).upper()
        self.location = cfg.get("location")
        self.zone = cfg.get("zone")
        self.capabilities = list(cfg.get("capabilities") or [])

        self._cap: Optional[cv2.VideoCapture] = None
        self._lock = threading.Lock()
        self._latest: Optional[FrameSnapshot] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

        self.online = False
        self.video_available = False
        self.width = 0
        self.height = 0
        self.fps = 0.0
        self.backend_name: Optional[str] = None
        self.camera_index: Optional[int] = None
        self.last_error: Optional[str] = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f"camera-{self.device_id}",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._release()

    def _release(self):
        cap = self._cap
        self._cap = None
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass

    def _open_usb(self) -> Optional[cv2.VideoCapture]:
        index = int(self.cfg.get("cameraIndex", 0))
        requested_backend = str(self.cfg.get("backend", "AUTO")).upper()

        backends: list[tuple[str, int]] = []
        if os.name == "nt":
            if requested_backend in {"AUTO", "DSHOW"}:
                backends.append(("DSHOW", cv2.CAP_DSHOW))
            if requested_backend in {"AUTO", "MSMF"}:
                backends.append(("MSMF", cv2.CAP_MSMF))
        backends.append(("DEFAULT", cv2.CAP_ANY))

        indices = [index]
        if bool(self.cfg.get("autoScan", True)):
            indices = list(dict.fromkeys([index] + list(range(0, 6))))

        for backend_name, backend in backends:
            for candidate_index in indices:
                cap = cv2.VideoCapture(candidate_index, backend)
                if not cap.isOpened():
                    cap.release()
                    continue

                target_w = int(self.cfg.get("targetWidth", 0) or 0)
                target_h = int(self.cfg.get("targetHeight", 0) or 0)
                target_fps = float(self.cfg.get("targetFps", 0) or 0)
                if target_w:
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, target_w)
                if target_h:
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, target_h)
                if target_fps:
                    cap.set(cv2.CAP_PROP_FPS, target_fps)

                ok, frame = cap.read()
                if ok and frame is not None:
                    self.backend_name = backend_name
                    self.camera_index = candidate_index
                    return cap

                cap.release()

        return None

    def _open_rtsp(self) -> Optional[cv2.VideoCapture]:
        url = str(self.cfg.get("sourceUrl", "")).strip()
        if not url:
            self.last_error = "RTSP_URL_MISSING"
            return None

        username_env = self.cfg.get("usernameEnv")
        password_env = self.cfg.get("passwordEnv")
        username = os.getenv(str(username_env), "") if username_env else ""
        password = os.getenv(str(password_env), "") if password_env else ""

        # Keep credentials out of logs. If credentials are needed, the deployment
        # should preferably supply a complete protected source URL via env/config.
        if username and password and "://" in url and "@" not in url:
            scheme, rest = url.split("://", 1)
            url = f"{scheme}://{username}:{password}@{rest}"

        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            self.backend_name = "FFMPEG"
            return cap
        cap.release()
        return None

    def _open(self) -> Optional[cv2.VideoCapture]:
        if self.source_type == "USB_WEBCAM":
            return self._open_usb()
        if self.source_type in {"RTSP", "ONVIF", "NVR_CHANNEL", "DVR_CHANNEL", "INTERCOM_CAMERA"}:
            return self._open_rtsp()
        self.last_error = f"UNSUPPORTED_SOURCE_TYPE:{self.source_type}"
        return None

    def _run(self):
        while not self._stop.is_set():
            if self._cap is None or not self._cap.isOpened():
                self._cap = self._open()
                if self._cap is None:
                    self.online = False
                    self.video_available = False
                    time.sleep(3)
                    continue

            ok, frame = self._cap.read()
            if not ok or frame is None:
                self.online = False
                self.video_available = False
                self.last_error = "FRAME_READ_FAILED"
                self._release()
                time.sleep(1)
                continue

            h, w = frame.shape[:2]
            fps = float(self._cap.get(cv2.CAP_PROP_FPS) or 0.0)
            if fps <= 0 or fps > 240:
                fps = float(self.cfg.get("targetFps", 30) or 30)

            with self._lock:
                self._latest = FrameSnapshot(frame=frame.copy(), captured_at=utc_now())

            self.online = True
            self.video_available = True
            self.width = int(w)
            self.height = int(h)
            self.fps = round(fps, 1)
            self.last_error = None

            target_fps = max(float(self.cfg.get("targetFps", 30) or 30), 1.0)
            time.sleep(min(1.0 / target_fps, 0.05))

    def latest(self) -> Optional[FrameSnapshot]:
        with self._lock:
            if self._latest is None:
                return None
            return FrameSnapshot(
                frame=self._latest.frame.copy(),
                captured_at=self._latest.captured_at,
            )

    def snapshot_jpeg(self, quality: int = 90) -> tuple[bytes, str]:
        snap = self.latest()
        if snap is None:
            raise RuntimeError("CAMERA_NO_FRAME")

        quality = max(30, min(int(quality), 100))
        ok, encoded = cv2.imencode(
            ".jpg",
            snap.frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), quality],
        )
        if not ok:
            raise RuntimeError("SNAPSHOT_ENCODE_FAILED")
        return encoded.tobytes(), snap.captured_at
