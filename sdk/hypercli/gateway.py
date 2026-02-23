"""
OpenClaw Gateway Client — WebSocket RPC client for the OpenClaw Gateway protocol.

Connects to an OpenClaw Gateway running inside a reef pod via the
`wss://openclaw-{agent}.hyperclaw.app` endpoint with JWT auth.

Implements protocol v3: challenge-response handshake, request/response,
and server-sent events.

Usage:
    from hypercli.gateway import GatewayClient

    async with GatewayClient(url="wss://openclaw-myagent.hyperclaw.app", token="jwt...") as gw:
        config = await gw.config_get()
        schema = await gw.config_schema()
        await gw.config_patch({"models": {"providers": {"openai": {"apiKey": "sk-..."}}}})

        # Chat
        async for event in gw.chat_send("Hello, agent!"):
            if event["type"] == "content":
                print(event["text"], end="", flush=True)

        # Files
        files = await gw.files_list("main")
        content = await gw.file_get("main", "SOUL.md")
        await gw.file_set("main", "SOUL.md", "# My Agent\\n...")

        # Sessions
        sessions = await gw.sessions_list()

        # Cron
        jobs = await gw.cron_list()
"""
from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import websockets
from websockets.asyncio.client import ClientConnection


PROTOCOL_VERSION = 3
DEFAULT_TIMEOUT = 15.0
CHAT_TIMEOUT = 300.0


@dataclass
class GatewayError(Exception):
    """Error returned by the Gateway."""
    code: str
    message: str
    details: Optional[dict] = None

    def __str__(self):
        return f"[{self.code}] {self.message}"


@dataclass
class ChatEvent:
    """A streaming chat event."""
    type: str  # content, thinking, tool_call, tool_result, done, error, status
    text: Optional[str] = None
    data: Optional[dict] = None


class GatewayClient:
    """
    Async WebSocket client for the OpenClaw Gateway protocol v3.

    Args:
        url: WebSocket URL (wss://openclaw-{name}.hyperclaw.app)
        token: JWT token for Traefik ForwardAuth
        gateway_token: Gateway auth token (for challenge-response)
        client_id: Client identifier (default: gateway-client)
        client_mode: Client mode (default: backend)
        timeout: Default RPC timeout in seconds
    """

    def __init__(
        self,
        url: str,
        token: str,
        gateway_token: str = "traefik-forwarded-auth-not-used",
        client_id: str = "gateway-client",
        client_mode: str = "backend",
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.url = url
        self.token = token
        self.gateway_token = gateway_token
        self.client_id = client_id
        self.client_mode = client_mode
        self.timeout = timeout
        self._ws: Optional[ClientConnection] = None
        self._pending: dict[str, asyncio.Future] = {}
        self._event_queue: asyncio.Queue = asyncio.Queue()
        self._reader_task: Optional[asyncio.Task] = None
        self._connected = False
        self._version: Optional[str] = None
        self._protocol: Optional[int] = None

    async def connect(self):
        """Connect and perform the challenge-response handshake."""
        headers = {"Authorization": f"Bearer {self.token}"}
        self._ws = await websockets.connect(self.url, additional_headers=headers)

        # 1. Receive challenge
        raw = await asyncio.wait_for(self._ws.recv(), timeout=self.timeout)
        challenge = json.loads(raw)
        if challenge.get("event") != "connect.challenge":
            raise GatewayError("PROTOCOL", f"Expected connect.challenge, got {challenge}")

        # 2. Send connect
        connect_req = {
            "type": "req",
            "id": self._make_id(),
            "method": "connect",
            "params": {
                "minProtocol": PROTOCOL_VERSION,
                "maxProtocol": PROTOCOL_VERSION,
                "client": {
                    "id": self.client_id,
                    "version": "hypercli-sdk",
                    "platform": "python",
                    "mode": self.client_mode,
                },
                "auth": {"token": self.gateway_token},
                "role": "operator",
                "scopes": ["operator.admin"],
                "caps": ["tool-events"],
            },
        }
        await self._ws.send(json.dumps(connect_req))

        # 3. Receive hello
        raw = await asyncio.wait_for(self._ws.recv(), timeout=self.timeout)
        resp = json.loads(raw)
        if not resp.get("ok"):
            err = resp.get("error", {})
            raise GatewayError(
                err.get("code", "CONNECT_FAILED"),
                err.get("message", "Connection rejected"),
            )

        payload = resp.get("payload", {})
        self._version = payload.get("version")
        self._protocol = payload.get("protocol")
        self._connected = True

        # Start background reader
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def close(self):
        """Close the connection."""
        self._connected = False
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *exc):
        await self.close()

    @property
    def version(self) -> Optional[str]:
        return self._version

    @property
    def protocol(self) -> Optional[int]:
        return self._protocol

    # -----------------------------------------------------------------------
    # Low-level RPC
    # -----------------------------------------------------------------------

    def _make_id(self) -> str:
        return str(uuid.uuid4())

    async def _reader_loop(self):
        """Background task: routes incoming frames to pending futures or event queue."""
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "res":
                    req_id = msg.get("id")
                    fut = self._pending.pop(req_id, None)
                    if fut and not fut.done():
                        fut.set_result(msg)
                elif msg_type == "event":
                    await self._event_queue.put(msg)
        except websockets.ConnectionClosed:
            self._connected = False
        except asyncio.CancelledError:
            pass

    async def call(self, method: str, params: dict = None, timeout: float = None) -> Any:
        """Send an RPC request and wait for the response.

        Returns the payload dict on success, raises GatewayError on failure.
        """
        if not self._connected:
            raise GatewayError("NOT_CONNECTED", "Not connected to gateway")

        req_id = self._make_id()
        req = {"type": "req", "id": req_id, "method": method}
        if params:
            req["params"] = params

        fut = asyncio.get_event_loop().create_future()
        self._pending[req_id] = fut

        await self._ws.send(json.dumps(req))

        try:
            resp = await asyncio.wait_for(fut, timeout=timeout or self.timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise GatewayError("TIMEOUT", f"RPC {method} timed out after {timeout or self.timeout}s")

        if not resp.get("ok"):
            err = resp.get("error", {})
            raise GatewayError(
                err.get("code", "RPC_ERROR"),
                err.get("message", f"RPC {method} failed"),
                err.get("details"),
            )

        return resp.get("payload")

    async def _call_streaming(self, method: str, params: dict, event_filter: str = None, timeout: float = None) -> AsyncIterator[dict]:
        """Send an RPC request and yield events until the response arrives.

        Used for streaming methods like chat.send that emit events before the final response.
        """
        if not self._connected:
            raise GatewayError("NOT_CONNECTED", "Not connected to gateway")

        req_id = self._make_id()
        req = {"type": "req", "id": req_id, "method": method, "params": params}

        fut = asyncio.get_event_loop().create_future()
        self._pending[req_id] = fut

        await self._ws.send(json.dumps(req))

        deadline = asyncio.get_event_loop().time() + (timeout or CHAT_TIMEOUT)

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                self._pending.pop(req_id, None)
                raise GatewayError("TIMEOUT", f"Streaming {method} timed out")

            # Check if final response arrived
            if fut.done():
                resp = fut.result()
                if not resp.get("ok"):
                    err = resp.get("error", {})
                    raise GatewayError(err.get("code", "RPC_ERROR"), err.get("message", ""))
                return

            # Drain events
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=min(remaining, 1.0))
                if event_filter is None or event.get("event", "").startswith(event_filter):
                    yield event
            except asyncio.TimeoutError:
                continue

    # -----------------------------------------------------------------------
    # Config
    # -----------------------------------------------------------------------

    async def config_get(self) -> dict:
        """Get the current gateway configuration."""
        result = await self.call("config.get")
        return result.get("config", result)

    async def config_schema(self) -> dict:
        """Get the JSON schema + uiHints for the config."""
        return await self.call("config.schema")

    async def config_patch(self, patch: dict) -> dict:
        """Patch the gateway configuration (merges with existing).

        The gateway will restart after applying the patch.
        """
        return await self.call("config.patch", {"patch": patch}, timeout=30)

    async def config_apply(self, config: dict) -> dict:
        """Replace the entire gateway configuration.

        The gateway will restart after applying.
        """
        return await self.call("config.apply", {"config": config}, timeout=30)

    # -----------------------------------------------------------------------
    # Status
    # -----------------------------------------------------------------------

    async def status(self) -> dict:
        """Get gateway status."""
        return await self.call("status")

    # -----------------------------------------------------------------------
    # Models
    # -----------------------------------------------------------------------

    async def models_list(self) -> list[dict]:
        """List available models."""
        result = await self.call("models.list")
        return result.get("models", [])

    # -----------------------------------------------------------------------
    # Agents
    # -----------------------------------------------------------------------

    async def agents_list(self) -> list[dict]:
        """List agents configured in the gateway."""
        result = await self.call("agents.list")
        return result.get("agents", [])

    async def agent_get(self, agent_id: str) -> dict:
        """Get agent details."""
        return await self.call("agents.get", {"agentId": agent_id})

    # -----------------------------------------------------------------------
    # Files
    # -----------------------------------------------------------------------

    async def files_list(self, agent_id: str) -> list[dict]:
        """List workspace files for an agent.

        Args:
            agent_id: Agent ID (usually "main" for the default agent).
        """
        result = await self.call("agents.files.list", {"agentId": agent_id})
        return result.get("files", [])

    async def file_get(self, agent_id: str, name: str) -> str:
        """Read a workspace file.

        Args:
            agent_id: Agent ID.
            name: File name (e.g., "SOUL.md", "AGENTS.md").
        """
        result = await self.call("agents.files.get", {"agentId": agent_id, "name": name})
        return result.get("content", "")

    async def file_set(self, agent_id: str, name: str, content: str) -> dict:
        """Write a workspace file.

        Args:
            agent_id: Agent ID.
            name: File name.
            content: File content.
        """
        return await self.call("agents.files.set", {
            "agentId": agent_id,
            "name": name,
            "content": content,
        })

    # -----------------------------------------------------------------------
    # Chat / Sessions
    # -----------------------------------------------------------------------

    async def sessions_list(self, limit: int = 20) -> list[dict]:
        """List chat sessions."""
        result = await self.call("sessions.list", {"limit": limit})
        return result.get("sessions", [])

    async def chat_history(self, session_key: str = None, limit: int = 50) -> list[dict]:
        """Get chat history for a session."""
        params = {"limit": limit}
        if session_key:
            params["sessionKey"] = session_key
        result = await self.call("chat.history", params)
        return result.get("messages", [])

    async def chat_send(self, message: str, session_key: str = None, agent_id: str = None) -> AsyncIterator[ChatEvent]:
        """Send a chat message and stream the response.

        Yields ChatEvent objects as the agent responds.
        """
        params: dict = {"message": message}
        if session_key:
            params["sessionKey"] = session_key
        if agent_id:
            params["agentId"] = agent_id

        async for event in self._call_streaming("chat.send", params, event_filter="chat."):
            evt = event.get("event", "")
            payload = event.get("payload", {})

            if evt == "chat.content":
                yield ChatEvent(type="content", text=payload.get("text", ""))
            elif evt == "chat.thinking":
                yield ChatEvent(type="thinking", text=payload.get("text", ""))
            elif evt == "chat.tool_call":
                yield ChatEvent(type="tool_call", data=payload)
            elif evt == "chat.tool_result":
                yield ChatEvent(type="tool_result", data=payload)
            elif evt == "chat.done":
                yield ChatEvent(type="done", data=payload)
                return
            elif evt == "chat.error":
                yield ChatEvent(type="error", text=payload.get("message", ""))
                return
            elif evt == "chat.status":
                yield ChatEvent(type="status", text=payload.get("status", ""))
            else:
                yield ChatEvent(type=evt, data=payload)

    async def chat_abort(self, session_key: str = None) -> dict:
        """Abort the current chat generation."""
        params = {}
        if session_key:
            params["sessionKey"] = session_key
        return await self.call("chat.abort", params)

    # -----------------------------------------------------------------------
    # Cron
    # -----------------------------------------------------------------------

    async def cron_list(self) -> list[dict]:
        """List cron jobs."""
        result = await self.call("cron.list")
        return result.get("jobs", [])

    async def cron_add(self, job: dict) -> dict:
        """Add a cron job."""
        return await self.call("cron.add", {"job": job})

    async def cron_remove(self, job_id: str) -> dict:
        """Remove a cron job."""
        return await self.call("cron.remove", {"jobId": job_id})

    async def cron_run(self, job_id: str) -> dict:
        """Trigger a cron job immediately."""
        return await self.call("cron.run", {"jobId": job_id})

    # -----------------------------------------------------------------------
    # Exec (tool approvals)
    # -----------------------------------------------------------------------

    async def exec_approve(self, exec_id: str) -> dict:
        """Approve a pending exec request."""
        return await self.call("exec.approve", {"execId": exec_id})

    async def exec_deny(self, exec_id: str) -> dict:
        """Deny a pending exec request."""
        return await self.call("exec.deny", {"execId": exec_id})

    # -----------------------------------------------------------------------
    # Events (consume server-sent events)
    # -----------------------------------------------------------------------

    async def next_event(self, timeout: float = None) -> Optional[dict]:
        """Get the next server event, or None on timeout."""
        try:
            return await asyncio.wait_for(
                self._event_queue.get(),
                timeout=timeout or self.timeout,
            )
        except asyncio.TimeoutError:
            return None

    async def events(self, timeout: float = 60.0) -> AsyncIterator[dict]:
        """Iterate over server events. Breaks on timeout with no events."""
        while self._connected:
            event = await self.next_event(timeout=timeout)
            if event is None:
                break
            yield event
