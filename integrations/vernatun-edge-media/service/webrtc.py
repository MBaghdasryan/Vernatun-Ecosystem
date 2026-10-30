from __future__ import annotations

import asyncio
from typing import Optional
from urllib.parse import urljoin, urlsplit

import aiohttp
from aiortc import (
    MediaStreamTrack,
    RTCPeerConnection,
    RTCConfiguration,
    RTCIceServer,
    RTCSessionDescription,
)
from av import VideoFrame


class CameraVideoTrack(MediaStreamTrack):
    kind = "video"

    def __init__(self, camera):
        super().__init__()
        self.camera = camera

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Wait briefly for a current frame.
        frame_data = None
        for _ in range(50):
            frame_data = self.camera.latest()
            if frame_data is not None:
                break
            await asyncio.sleep(0.02)

        if frame_data is None:
            raise RuntimeError("CAMERA_NO_FRAME")

        frame = VideoFrame.from_ndarray(frame_data.frame, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base
        return frame


async def wait_for_ice_gathering_complete(pc: RTCPeerConnection, timeout: float = 10.0):
    if pc.iceGatheringState == "complete":
        return

    completed = asyncio.Event()

    @pc.on("icegatheringstatechange")
    async def _on_state_change():
        if pc.iceGatheringState == "complete":
            completed.set()

    try:
        await asyncio.wait_for(completed.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        # Non-trickle WHIP works best with complete gathering, but a partially
        # gathered offer may still work with some gateways.
        pass


class WhipPublisher:
    """
    Minimal non-trickle WHIP publisher.

    Cloud Media Gateway supplies:
      - a session-scoped WHIP publishUrl
      - a session-scoped bearer token
      - optional ICE servers

    This avoids hard-binding Edge Media to LiveKit/Janus/mediasoup.
    """

    def __init__(
        self,
        camera,
        publish_url: str,
        publisher_token: Optional[str],
        ice_servers: list[dict] | None = None,
        timeout_seconds: float = 20.0,
    ):
        rtc_ice_servers = []
        for item in ice_servers or []:
            rtc_ice_servers.append(
                RTCIceServer(
                    urls=item.get("urls"),
                    username=item.get("username"),
                    credential=item.get("credential"),
                )
            )

        self.pc = RTCPeerConnection(
            configuration=RTCConfiguration(iceServers=rtc_ice_servers)
        )
        self.camera = camera
        self.publish_url = publish_url
        self.publisher_token = publisher_token
        self.timeout_seconds = timeout_seconds
        self.resource_url: Optional[str] = None
        self.http: Optional[aiohttp.ClientSession] = None

    async def start(self):
        if not self.camera.video_available:
            raise RuntimeError("CAMERA_UNAVAILABLE")

        self.pc.addTrack(CameraVideoTrack(self.camera))

        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)
        await wait_for_ice_gathering_complete(self.pc)

        headers = {
            "Content-Type": "application/sdp",
            "Accept": "application/sdp",
        }
        if self.publisher_token:
            headers["Authorization"] = f"Bearer {self.publisher_token}"

        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        self.http = aiohttp.ClientSession(timeout=timeout, trust_env=False)

        async with self.http.post(
            self.publish_url,
            data=self.pc.localDescription.sdp,
            headers=headers,
            allow_redirects=False,
        ) as response:
            if response.status not in (200, 201):
                raise RuntimeError(f"WHIP_HTTP_{response.status}")

            answer_sdp = await response.text()
            location = response.headers.get("Location")
            if location:
                candidate = urljoin(self.publish_url, location)
                publish_origin = urlsplit(self.publish_url)
                resource_origin = urlsplit(candidate)
                if (
                    resource_origin.scheme != "https"
                    or resource_origin.hostname != publish_origin.hostname
                    or resource_origin.port not in (None, 443)
                ):
                    raise RuntimeError("WHIP_RESOURCE_URL_REJECTED")
                self.resource_url = candidate

        await self.pc.setRemoteDescription(
            RTCSessionDescription(sdp=answer_sdp, type="answer")
        )

    async def stop(self):
        if self.resource_url and self.http:
            headers = {}
            if self.publisher_token:
                headers["Authorization"] = f"Bearer {self.publisher_token}"
            try:
                async with self.http.delete(
                    self.resource_url,
                    headers=headers,
                    allow_redirects=False,
                ):
                    pass
            except Exception:
                pass

        try:
            await self.pc.close()
        finally:
            if self.http:
                await self.http.close()
                self.http = None
            self.publisher_token = None
            self.publish_url = ""
            self.resource_url = None
