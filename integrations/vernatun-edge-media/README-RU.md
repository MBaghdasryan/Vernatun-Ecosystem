# Vernatun Edge Media v1

Локальный media-plane Vernatun Edge для физических камер.

## Что уже реализовано

- Native Windows USB webcam capture.
- RTSP-ready camera source abstraction.
- Auto-reconnect физической камеры.
- `/health`.
- Camera inventory/status API.
- JPEG snapshot API.
- MQTT telemetry в текущий ThingsBoard topic.
- `CAMERA.LIVE_VIEW`.
- `CAMERA.SNAPSHOT`.
- Media session lifecycle.
- WebRTC publisher через provider-agnostic WHIP ingest.
- STUN/TURN configuration from Cloud session payload.
- Local API key support.
- PowerShell install/start/stop/status/test.
- Windows autostart helper.

## Важно

На текущем ноутбуке НЕ запускайте одновременно старый:

`laptop_camera.py`

и `vernatun-edge-media`.

Оба будут пытаться открыть одну физическую webcam.

После перехода на Edge Media старый camera adapter можно остановить: Edge Media сам публикует telemetry в MQTT.

## Установка

Распаковать в:

`C:\Vernatun-Edge-Lab\edge-media`

PowerShell:

```powershell
cd C:\Vernatun-Edge-Lab\edge-media

powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

Проверка:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\status.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

Ожидается:

- Camera online = true
- Video available = true
- 640x480
- 30 FPS
- stream state = IDLE
- snapshot PASS

## WebRTC

WebRTC publish не стартует сам по себе.

Cloud Media Gateway должен создать short-lived WHIP publish session и через существующий Edge WebSocket передать:

- sessionId
- deviceId
- publishUrl
- publisherToken
- expiresAt
- ICE/STUN/TURN config

После этого Edge Agent вызывает local Edge Media API.

## Current device

`Laptop-Camera-01`

## Current Edge

`edge-building01`

## Current ThingsBoard topic

`vernatun/building01/camera/Laptop-Camera-01`
