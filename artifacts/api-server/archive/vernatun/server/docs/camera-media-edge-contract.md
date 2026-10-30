# Vernatun Edge camera media contract

Vernatun camera telemetry and camera video are separate planes. ThingsBoard and
the existing Edge telemetry messages may report `online`, `camera_open`,
`video_loss`, `tamper`, `fps`, and `resolution`; none of those fields proves
that a WebRTC video track is reaching a viewer.

## Control and media paths

- Cloud control uses the already authenticated outbound Edge WebSocket at
  `/api/edge/v1/connect`. Do not create a second public Edge control endpoint.
- Camera video uses LiveKit WebRTC directly. Do not send media bytes through
  MQTT, ThingsBoard telemetry, or the Cloud API.
- Cloud gives the browser/mobile client a five-minute, subscribe-only token.
  Edge receives a separate five-minute token limited to publishing camera
  video in one opaque room. Neither side receives the LiveKit API secret.
- Live sessions are started on demand. A camera may have one active room with
  multiple authorized viewers. Cloud ends the room when viewers stop or their
  heartbeats expire.
- Never return RTSP URLs, device IPs, local network addresses, or Edge
  credentials to HAYAT or ImTun.

## Edge readiness advertisement

After authenticating and completing `EDGE_HELLO`, the Edge Media Service sends
this message on the authenticated WebSocket:

```json
{
  "type": "MEDIA_CAPABILITIES",
  "protocolVersion": 1,
  "provider": "livekit",
  "cameraPublisher": true,
  "rtspGateway": false
}
```

Cloud does not enable viewing based on telemetry alone. `cameraPublisher` must
be true, the Edge socket must be connected, the camera telemetry must be fresh,
and the LiveKit provider must be configured.

## Start message

When an authorized user requests a view, Cloud sends:

```json
{
  "type": "MEDIA_SESSION_START",
  "sessionId": "opaque-session-uuid",
  "cameraId": "edge-camera-id",
  "edgeDeviceId": "edge-camera-id",
  "roomName": "opaque-room-name",
  "serverUrl": "wss://configured-livekit-host",
  "publisherToken": "short-lived-room-scoped-token"
}
```

The Edge service opens the camera only for this session, publishes a camera
video track using the supplied token, and does not publish audio. If an RTSP
source is used later, the RTSP-to-WebRTC gateway stays on Edge; its source URL
and credentials remain local to that service.

## State and stop messages

Edge reports state only after performing the corresponding action:

```json
{
  "type": "MEDIA_SESSION_STATE",
  "sessionId": "opaque-session-uuid",
  "state": "ACTIVE"
}
```

Supported states are `STARTING`, `ACTIVE`, `FAILED`, `STOPPING`, and `ENDED`.
`FAILED` may include a short machine-readable `errorCode` without secrets or
source URLs. Cloud accepts `ACTIVE` only after the LiveKit Room Service confirms
that the expected opaque Edge participant has published a camera video track.
An `EDGE_HELLO`, `camera_open=true`, or `video_loss=false` is not enough.

To stop a session, Cloud sends:

```json
{
  "type": "MEDIA_SESSION_STOP",
  "sessionId": "opaque-session-uuid"
}
```

Edge stops capture and publishing, then reports `ENDED`. A WebSocket disconnect,
session expiry, or lack of authorized viewers also causes Cloud to delete the
LiveKit room, so a stream is not left running indefinitely.
