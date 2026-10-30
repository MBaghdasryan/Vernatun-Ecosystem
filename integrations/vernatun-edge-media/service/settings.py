from __future__ import annotations

import os
import ipaddress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]


def _env_file_load(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_env_file_load(ROOT / ".env")


def _load_yaml() -> dict[str, Any]:
    raw_path = os.getenv(
        "VERNATUN_EDGE_MEDIA_CONFIG",
        str(ROOT / "config" / "vernatun_edge_media_v1.yaml"),
    )
    path = Path(raw_path)
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


CONFIG = _load_yaml()


def nested(path: str, default=None):
    value: Any = CONFIG
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return default
        value = value[part]
    return value


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv(
        "VERNATUN_EDGE_MEDIA_HOST",
        str(nested("service.host", "127.0.0.1")),
    )
    port: int = int(
        os.getenv("VERNATUN_EDGE_MEDIA_PORT", str(nested("service.port", 8093)))
    )
    api_key: str = os.getenv("VERNATUN_EDGE_MEDIA_API_KEY", "")
    allowed_publish_hosts: tuple[str, ...] = tuple(
        str(host).lower().lstrip(".")
        for host in (nested("media.allowedPublishHosts", ["livekit.cloud"]) or [])
    )

    edge_id: str = str(nested("identity.edgeId", "edge-building01"))
    tenant_id: str = str(nested("identity.tenantId", ""))
    building_id: str = str(nested("identity.buildingId", ""))
    site_code: str = str(nested("identity.siteCode", "building01"))

    mqtt_enabled: bool = bool(nested("mqtt.enabled", True))
    mqtt_host: str = os.getenv(
        "VERNATUN_MQTT_HOST",
        str(nested("mqtt.host", "127.0.0.1")),
    )
    mqtt_port: int = int(
        os.getenv("VERNATUN_MQTT_PORT", str(nested("mqtt.port", 1884)))
    )
    mqtt_qos: int = int(nested("mqtt.qos", 1))
    telemetry_interval: float = float(nested("mqtt.telemetryIntervalSeconds", 5))

    snapshot_quality: int = int(nested("media.snapshotQuality", 90))
    session_max_seconds: int = int(nested("media.sessionMaxSeconds", 14400))
    whip_timeout_seconds: int = int(nested("media.whipConnectTimeoutSeconds", 20))


settings = Settings()

if settings.host.lower() != "localhost":
    try:
        loopback_host = ipaddress.ip_address(settings.host).is_loopback
    except ValueError:
        loopback_host = False
    if not loopback_host:
        raise RuntimeError("Edge Media API must bind to a loopback address")


def camera_configs() -> list[dict[str, Any]]:
    return list(CONFIG.get("cameras") or [])
