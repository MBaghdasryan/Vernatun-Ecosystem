# Vernatun Edge Media Contract v1

## Purpose

`vernatun-edge-media` owns the media plane on the Edge.

ThingsBoard/MQTT carries camera telemetry and alarms only.
Video is published from the Edge to a Cloud Media Gateway over WebRTC.

## Local API

Default:
`http://127.0.0.1:8093`

All `/v1/*` requests require `VERNATUN_EDGE_MEDIA_API_KEY`:

`X-Vernatun-Edge-Key: <local-edge-key>`

### Health
`GET /health`

### Cameras
`GET /v1/cameras`
`GET /v1/cameras/{deviceId}`

### Snapshot
`POST /v1/cameras/{deviceId}/snapshot`

Returns binary JPEG.

### Create media session
`POST /v1/media/sessions`

Example:

```json
{
  "sessionId": "media_01ABC",
  "deviceId": "Laptop-Camera-01",
  "protocol": "WEBRTC",
  "publishUrl": "https://<LiveKit-Ingress-host>/<session-path>",
  "publisherToken": "SHORT_LIVED_PUBLISHER_TOKEN",
  "expiresAt": "2026-10-30T16:00:00Z",
  "iceServers": [
    {
      "urls": [
        "stun:stun.example.com:3478",
        "turn:turn.example.com:3478"
      ],
      "username": "short-lived",
      "credential": "short-lived"
    }
  ]
}
```

The service uses a non-trickle WHIP publish flow:

1. capture real physical camera frames;
2. create WebRTC offer;
3. gather ICE candidates;
4. POST SDP offer to `publishUrl`;
5. receive SDP answer;
6. publish until session stop.

### Get session
`GET /v1/media/sessions/{sessionId}`

### Update active viewers
`PATCH /v1/media/sessions/{sessionId}/viewers`

```json
{"activeViewers": 1}
```

### Stop session
`DELETE /v1/media/sessions/{sessionId}`

## Cloud control messages

Cloud -> existing Edge WebSocket:

```json
{
  "type": "MEDIA_SESSION_START",
  "protocol": "WEBRTC",
  "provider": "livekit",
  "sessionId": "<opaque-session-uuid>",
  "deviceId": "<edge-device-id>",
  "cameraId": "<edge-device-id>",
  "edgeDeviceId": "<edge-device-id>",
  "roomName": "<opaque-room-name>",
  "serverUrl": "wss://<LiveKit-project-host>",
  "publishUrl": "https://<LiveKit-Ingress-host>/<session-path>",
  "publisherToken": "<session-scoped-ingress-key>",
  "expiresAt": "<UTC-expiry>",
  "iceServers": []
}
```

The current Cloud backend creates a LiveKit WHIP Ingress for each camera session.
The authenticated WebSocket message carries its URL and stream key only to Edge;
the stream key must never be returned to a browser or mobile app. Edge Agent maps
the top-level fields to the local API request body and calls the local API.

Advertise Edge readiness on the already-authenticated Cloud WebSocket:

```json
{
  "type": "MEDIA_CAPABILITIES",
  "protocolVersion": 1,
  "provider": "livekit",
  "cameraPublisher": true,
  "rtspGateway": false
}
```

Edge -> Cloud:

```json
{
  "type": "MEDIA_SESSION_STATE",
  "sessionId": "media_01ABC",
  "deviceId": "Laptop-Camera-01",
  "state": "LIVE"
}
```

Report `LIVE` only after the local publisher has connected; Cloud independently
confirms an actual video track in the expected LiveKit room before marking the
session active. On stop, call the local DELETE endpoint first and report
`ENDED` after the publisher is closed.

Stop:

```json
{
  "type": "MEDIA_SESSION_STOP",
  "sessionId": "media_01ABC"
}
```

## Security

- The backend deletes the session-scoped LiveKit Ingress when the session ends;
  Edge also enforces the supplied expiry and a four-hour hard maximum.
- The local service rejects non-HTTPS publish URLs and hosts outside the
  configured LiveKit host allowlist.
- No RTSP/MQTT/ThingsBoard URL is exposed to HAYAT.
- The local API binds to loopback only by default.
- Every `/v1/*` local API request requires the local Edge key.
- Camera credentials are not sent to the browser.
- Cloud authorizes `CAMERA.LIVE_VIEW` before requesting a session.
