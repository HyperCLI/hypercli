"""
HyperClaw Agents API — Reef Pod Management

Client for HyperClaw backend agent endpoints. Manages OpenClaw desktop containers
(reef pods) via the authenticated backend API at api.hyperclaw.app/api/agents.

The backend proxies to Lagoon internally, handles auth, plan enforcement,
runtime key generation, and DB persistence.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Any, AsyncIterator

import httpx

from .http import HTTPClient, APIError


CLAW_API_BASE = "https://api.hyperclaw.app"


@dataclass
class ReefPod:
    """A reef pod (OpenClaw desktop container)."""
    id: str  # Agent UUID from backend
    user_id: str
    pod_id: str
    pod_name: str
    state: str
    name: Optional[str] = None
    cpu: int = 0              # cores
    memory: int = 0           # GB
    hostname: Optional[str] = None
    openclaw_url: Optional[str] = None
    jwt_token: Optional[str] = None
    jwt_expires_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @classmethod
    def from_dict(cls, data: dict) -> ReefPod:
        def _parse_dt(val):
            if isinstance(val, str) and val:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            return None

        return cls(
            id=data.get("id", ""),
            user_id=data.get("user_id", ""),
            pod_id=data.get("pod_id", ""),
            pod_name=data.get("pod_name", ""),
            state=data.get("state", "unknown"),
            name=data.get("name"),
            cpu=data.get("cpu", 0),
            memory=data.get("memory", 0),
            hostname=data.get("hostname"),
            openclaw_url=data.get("openclaw_url"),
            jwt_token=data.get("jwt_token"),
            jwt_expires_at=_parse_dt(data.get("jwt_expires_at")),
            started_at=_parse_dt(data.get("started_at")),
            stopped_at=_parse_dt(data.get("stopped_at")),
            last_error=data.get("last_error"),
            created_at=_parse_dt(data.get("created_at")),
            updated_at=_parse_dt(data.get("updated_at")),
        )

    @property
    def vnc_url(self) -> Optional[str]:
        if self.hostname:
            return f"https://{self.hostname}"
        return None

    @property
    def shell_url(self) -> Optional[str]:
        if self.hostname:
            return f"https://shell-{self.hostname}"
        return None

    @property
    def executor_url(self) -> Optional[str]:
        return self.shell_url

    @property
    def is_running(self) -> bool:
        return self.state == "running"

    def gateway(self, **kwargs) -> "GatewayClient":
        """Create a GatewayClient for this pod.

        Requires the pod to be running with a valid JWT token.
        Returns an unconnected client — use `async with pod.gateway() as gw:`.
        """
        from .gateway import GatewayClient
        if not self.openclaw_url:
            if self.hostname:
                url = f"wss://openclaw-{self.hostname}"
            else:
                raise ValueError("Pod has no openclaw_url or hostname")
        else:
            url = self.openclaw_url
        if not self.jwt_token:
            raise ValueError("Pod has no JWT token — refresh it first")
        return GatewayClient(url=url, token=self.jwt_token, **kwargs)


@dataclass
class ExecResult:
    """Result of a one-shot command execution."""
    exit_code: int
    stdout: str
    stderr: str

    @classmethod
    def from_dict(cls, data: dict) -> ExecResult:
        return cls(
            exit_code=data.get("exit_code", -1),
            stdout=data.get("stdout", ""),
            stderr=data.get("stderr", ""),
        )


class Agents:
    """
    HyperClaw Agents API — manage reef pods (OpenClaw desktop containers).

    Uses the authenticated backend API (api.hyperclaw.app/api/agents).
    Auth: pass your HyperClaw API key (sk-...) as the claw_api_key.

    Usage:
        from hypercli import HyperCLI
        client = HyperCLI(api_key="...", claw_api_key="sk-...")

        # Launch
        pod = client.agents.create()
        print(f"Desktop: {pod.vnc_url}")

        # Execute a command
        result = client.agents.exec(pod, "echo hello")

        # List
        pods = client.agents.list()

        # Stop
        client.agents.stop(pod.id)
    """

    def __init__(self, http: HTTPClient, claw_api_key: str = None, claw_api_base: str = None):
        self._http = http
        self._api_key = claw_api_key or http.api_key
        self._api_base = (claw_api_base or CLAW_API_BASE).rstrip("/")

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: dict = None) -> Any:
        with httpx.Client(timeout=30) as client:
            resp = client.get(f"{self._api_base}{path}", headers=self._headers, params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _post(self, path: str, json: dict = None) -> Any:
        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{self._api_base}{path}", headers=self._headers, json=json)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    def _delete(self, path: str) -> Any:
        with httpx.Client(timeout=30) as client:
            resp = client.delete(f"{self._api_base}{path}", headers=self._headers)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return resp.json()

    # -----------------------------------------------------------------------
    # Agent lifecycle (HyperClaw backend → Lagoon)
    # -----------------------------------------------------------------------

    def create(
        self,
        name: str = None,
        size: str = None,
        cpu: int = None,
        memory: int = None,
        config: dict = None,
        start: bool = True,
    ) -> ReefPod:
        """Create a new agent (provisions a reef pod via the backend).

        Args:
            name: Agent name.
            size: Size preset (small/medium/large). Default: medium.
            cpu: Custom CPU in cores (overrides size).
            memory: Custom memory in GB (overrides size).
            config: Optional config overrides.
            start: Start the agent immediately (default: True).

        Returns:
            ReefPod with connection details.
        """
        body: dict = {"config": config or {}, "start": start}
        if name:
            body["name"] = name
        if size:
            body["size"] = size
        if cpu is not None:
            body["cpu"] = cpu
        if memory is not None:
            body["memory"] = memory
        data = self._post("/api/agents", json=body)
        return ReefPod.from_dict(data)

    def budget(self) -> dict:
        """Get the user's current agent resource budget and usage.

        Returns:
            Dict with budget, used, available (all in cores/GB).
        """
        return self._get("/api/agents/budget")

    def metrics(self, agent_id: str) -> dict:
        """Get live CPU/memory metrics for a running agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with container metrics from k8s metrics-server.
        """
        return self._get(f"/api/agents/{agent_id}/metrics")

    def list(self) -> list[ReefPod]:
        """List all agents for the authenticated user.

        Returns:
            List of ReefPod objects.
        """
        data = self._get("/api/agents")
        items = data.get("items", data) if isinstance(data, dict) else data
        return [ReefPod.from_dict(p) for p in items]

    def get(self, agent_id: str) -> ReefPod:
        """Get agent details by ID (refreshes status from Lagoon).

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod with current status.
        """
        data = self._get(f"/api/agents/{agent_id}")
        return ReefPod.from_dict(data)

    def start(self, agent_id: str) -> ReefPod:
        """Start a previously stopped agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod with new pod details.
        """
        data = self._post(f"/api/agents/{agent_id}/start")
        return ReefPod.from_dict(data)

    def stop(self, agent_id: str) -> ReefPod:
        """Stop an agent (tears down pod, keeps DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod in stopped state.
        """
        data = self._post(f"/api/agents/{agent_id}/stop")
        return ReefPod.from_dict(data)

    def delete(self, agent_id: str) -> dict:
        """Delete an agent entirely (pod + DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            Deletion status dict.
        """
        return self._delete(f"/api/agents/{agent_id}")

    def refresh_token(self, agent_id: str) -> dict:
        """Refresh the JWT token for an agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with agent_id, pod_id, token, expires_at.
        """
        return self._get(f"/api/agents/{agent_id}/token")

    # -----------------------------------------------------------------------
    # Executor API (direct to reef pod via shell-{hostname})
    # -----------------------------------------------------------------------

    def _executor_headers(self, pod: ReefPod) -> dict:
        h = {}
        if pod.jwt_token:
            h["Authorization"] = f"Bearer {pod.jwt_token}"
            h["Cookie"] = f"{pod.pod_name}-token={pod.jwt_token}"
        return h

    def exec(self, pod: ReefPod, command: str, timeout: int = 30) -> ExecResult:
        """Execute a one-shot command on a reef pod via the executor API.

        Args:
            pod: ReefPod to execute on (needs jwt_token).
            command: Shell command to run.
            timeout: Command timeout in seconds.

        Returns:
            ExecResult with exit_code, stdout, stderr.
        """
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL (missing hostname)")
        with httpx.Client(timeout=max(timeout + 5, 35)) as client:
            resp = client.post(
                f"{pod.executor_url}/exec",
                headers=self._executor_headers(pod),
                json={"command": command, "timeout": timeout},
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return ExecResult.from_dict(resp.json())

    def health(self, pod: ReefPod) -> dict:
        """Check executor health on a pod."""
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{pod.executor_url}/health",
                headers=self._executor_headers(pod),
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def files_list(self, pod: ReefPod, path: str = ".") -> list[dict]:
        """List files on a pod."""
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{pod.executor_url}/files",
                headers=self._executor_headers(pod),
                params={"path": path},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json().get("entries", [])

    def file_read(self, pod: ReefPod, path: str) -> str:
        """Read a file from a pod."""
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{pod.executor_url}/files/read",
                headers=self._executor_headers(pod),
                params={"path": path},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.text

    def file_write(self, pod: ReefPod, path: str, content: str) -> dict:
        """Write a file to a pod."""
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")
        with httpx.Client(timeout=10) as client:
            resp = client.put(
                f"{pod.executor_url}/files/write",
                headers=self._executor_headers(pod),
                params={"path": path},
                content=content.encode(),
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def chat_stream(self, pod: ReefPod, messages: list[dict], model: str = "hyperclaw/kimi-k2.5"):
        """Stream chat completions from the pod's OpenClaw gateway via executor proxy.

        Yields content delta strings as they arrive.
        """
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")

        body = {
            "model": model,
            "messages": messages,
            "stream": True,
        }

        with httpx.Client(timeout=300) as client:
            with client.stream(
                "POST",
                f"{pod.executor_url}/chat",
                headers=self._executor_headers(pod),
                json=body,
            ) as resp:
                if resp.status_code >= 400:
                    raise APIError(resp.status_code, resp.read().decode())
                for line in resp.iter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        import json
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

    def logs_stream(self, pod: ReefPod, lines: int = 100, follow: bool = True):
        """Stream logs from the pod via executor SSE.

        Yields log lines as they arrive.
        """
        if not pod.executor_url:
            raise ValueError("Pod has no executor URL")

        params = {"lines": lines, "follow": "true" if follow else "false"}

        with httpx.Client(timeout=None) as client:
            with client.stream(
                "GET",
                f"{pod.executor_url}/logs",
                headers=self._executor_headers(pod),
                params=params,
            ) as resp:
                if resp.status_code >= 400:
                    raise APIError(resp.status_code, resp.read().decode())
                for line in resp.iter_lines():
                    line = line.strip()
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[keepalive]":
                            continue
                        yield data

    # -----------------------------------------------------------------------
    # WebSocket API (via HyperClaw backend)
    # -----------------------------------------------------------------------

    async def logs_stream_ws(self, agent_id: str, tail_lines: int = 100, container: str = "reef") -> AsyncIterator[str]:
        """Stream logs via backend WebSocket.

        Connects to the HyperClaw backend WebSocket endpoint which proxies
        to the lagoon log buffer.

        Args:
            agent_id: Agent UUID.
            tail_lines: Number of historical lines to fetch first.
            container: Container name (default: reef).

        Yields:
            Log lines as they arrive.
        """
        import websockets

        # Get JWT token
        token_data = self.refresh_token(agent_id)
        jwt = token_data["token"]

        # Convert HTTP base to WebSocket base
        ws_base = self._api_base.replace("https://", "wss://").replace("http://", "ws://")
        url = f"{ws_base}/ws/{agent_id}?jwt={jwt}&container={container}&tail_lines={tail_lines}"

        async with websockets.connect(url) as ws:
            async for msg in ws:
                yield msg

    async def shell_connect(self, agent_id: str):
        """Connect to agent shell via backend WebSocket proxy.

        Connects to the HyperClaw backend shell WebSocket which proxies
        to lagoon → k8s exec for bidirectional PTY access.

        Args:
            agent_id: Agent UUID.

        Returns:
            WebSocket connection for bidirectional shell I/O.
        """
        import websockets

        # Get shell token
        token_data = self._post(f"/api/agents/{agent_id}/shell/token")
        jwt = token_data["token"]

        # Convert HTTP base to WebSocket base
        ws_base = self._api_base.replace("https://", "wss://").replace("http://", "ws://")
        url = f"{ws_base}/ws/shell/{agent_id}?jwt={jwt}"

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
