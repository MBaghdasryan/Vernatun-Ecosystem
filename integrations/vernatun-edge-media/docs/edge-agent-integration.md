# Edge Agent integration

The already-connected `vernatun-cloud-edge-agent` remains the Cloud control-plane client.

Do not create a second permanent Cloud identity for Edge Media.

## Required Agent behavior

When Agent receives:

`MEDIA_SESSION_START`

it should POST the following fields from the top-level Cloud message to:

`http://127.0.0.1:8093/v1/media/sessions`

with:

`X-Vernatun-Edge-Key`

Report `MEDIA_SESSION_STATE` with `state: "LIVE"` only after the local publisher
connects. Cloud checks for a real LiveKit video track before marking the session
active. Never include the publisher token in a status or error message.

When Agent receives:

`MEDIA_SESSION_STOP`

it should call:

`DELETE http://127.0.0.1:8093/v1/media/sessions/{sessionId}`

and report the final state.

After the local API returns `IDLE`, report `MEDIA_SESSION_STATE` with
`state: "ENDED"`. If the local API rejects or fails to publish, report
`state: "FAILED"` with a short machine-readable error code only.

After authenticated `EDGE_HELLO`, advertise the camera publisher capability
once per connection using the `MEDIA_CAPABILITIES` message documented in
`cloud-edge-media-contract-v1.md`.

For snapshot:

Cloud command/capability:

`CAMERA.SNAPSHOT`

Agent calls:

`POST /v1/cameras/{deviceId}/snapshot`

Then uploads the binary image through a short-lived Cloud upload endpoint supplied by Cloud.

## Do not

- proxy the video bytes over the Edge control WebSocket;
- base64 video through JSON;
- send video to ThingsBoard;
- expose port 8093 publicly.
