from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]

def test_config_exists():
    path = ROOT / "config" / "vernatun_edge_media_v1.yaml"
    assert path.exists()
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert cfg["service"]["port"] == 8093
    assert cfg["cameras"][0]["deviceId"] == "Laptop-Camera-01"
