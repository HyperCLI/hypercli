"""
HyperClaw Agents API — Reef Pod Management

Client for HyperClaw backend agent endpoints. Manages OpenClaw desktop containers
(reef pods) via the authenticated backend API at api.hypercli.com/api/agents.

The backend proxies to Lagoon internally, handles auth, plan enforcement,
runtime key generation, and DB persistence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import secrets
from typing import Optional, Any, AsyncIterator
from urllib.parse import quote, urlsplit

import httpx

from .http import HTTPClient, APIError


CLAW_API_BASE = "https://api.hypercli.com"
AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws"
DEV_AGENTS_WS_URL = "wss://api.agents.dev.hypercli.com/ws"


def _to_ws_base_url(base_url: str) -> str:
    base = (base_url or "").rstrip("/")
    if not base:
        return ""
    if base.startswith("https://"):
        return f"wss://{base[len('https://'):]}"
    if base.startswith("http://"):
        return f"ws://{base[len('http://'):]}"
    return base


def _normalize_agents_ws_url(url: str) -> str:
    base = _to_ws_base_url(url)
    if not base:
        return ""
    return base if base.endswith("/ws") else f"{base}/ws"


def _default_agents_ws_url(api_base: str) -> str:
    raw = (api_base or "").strip()
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower()
    if host in {"api.hypercli.com", "api.hyperclaw.app"}:
        return AGENTS_WS_URL
    if host in {"api.dev.hypercli.com", "api.dev.hyperclaw.app", "dev-api.hyperclaw.app"}:
        return DEV_AGENTS_WS_URL
    return _normalize_agents_ws_url(raw)


def _build_agent_config(
    config: dict | None = None,
    *,
    env: dict | None = None,
    ports: list | None = None,
    routes: dict | None = None,
    command: list[str] | None = None,
    entrypoint: list[str] | None = None,
    image: str | None = None,
    registry_url: str | None = None,
    registry_auth: dict | None = None,
    gateway_token: str | None = None,
) -> tuple[dict, str]:
    prepared = dict(config or {})

    env_map = dict(prepared.get("env") or {})
    if env:
        env_map.update(env)

    effective_gateway_token = gateway_token or str(env_map.get("OPENCLAW_GATEWAY_TOKEN") or "").strip()
    if not effective_gateway_token:
        effective_gateway_token = secrets.token_hex(32)
    env_map["OPENCLAW_GATEWAY_TOKEN"] = effective_gateway_token
    prepared["env"] = env_map

    if ports is not None:
        prepared["ports"] = ports
    if routes is not None:
        prepared["routes"] = routes
    if command is not None:
        prepared["command"] = command
    if entrypoint is not None:
        prepared["entrypoint"] = entrypoint
    if image is not None:
        prepared["image"] = image
    if registry_url is not None:
        prepared["registry_url"] = registry_url
    if registry_auth is not None:
        prepared["registry_auth"] = registry_auth

    return prepared, effective_gateway_token


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
    agents_ws_url: Optional[str] = None
    jwt_token: Optional[str] = None
    gateway_token: Optional[str] = None
    jwt_expires_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    launch_config: Optional[dict] = None
    routes: dict[str, dict] = field(default_factory=dict)
    command: list[str] = field(default_factory=list)
    entrypoint: list[str] = field(default_factory=list)
    ports: list[dict] = field(default_factory=list)

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
            gateway_token=data.get("gateway_token"),
            jwt_expires_at=_parse_dt(data.get("jwt_expires_at")),
            started_at=_parse_dt(data.get("started_at")),
            stopped_at=_parse_dt(data.get("stopped_at")),
            last_error=data.get("last_error"),
            created_at=_parse_dt(data.get("created_at")),
            updated_at=_parse_dt(data.get("updated_at")),
            launch_config=data.get("launch_config"),
            routes=data.get("routes") or {},
            command=data.get("command") or [],
            entrypoint=data.get("entrypoint") or [],
            ports=data.get("ports") or [],
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
        if self.openclaw_url:
            url = self.openclaw_url
        elif self.agents_ws_url and self.id:
            url = f"{self.agents_ws_url}/{self.id}"
        elif not self.openclaw_url:
            if self.hostname:
                url = f"wss://openclaw-{self.hostname}"
            else:
                raise ValueError("Pod has no openclaw_url or hostname")
        if not self.jwt_token:
            raise ValueError("Pod has no JWT token — refresh it first")
        if self.gateway_token and "gateway_token" not in kwargs:
            kwargs["gateway_token"] = self.gateway_token
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

    Uses the authenticated backend API (api.hypercli.com/api/agents).
    Auth: pass your HyperClaw API key (sk-...) as the agent_api_key.

    Usage:
        from hypercli import HyperCLI
        client = HyperCLI(api_key="...", agent_api_key="sk-...")

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

    def __init__(
        self,
        http: HTTPClient,
        agent_api_key: str = None,
        agent_api_base: str = None,
        agents_ws_url: str = None,
    ):
        self._http = http
        self._api_key = agent_api_key or http.api_key
        self._api_base = (agent_api_base or CLAW_API_BASE).rstrip("/")
        self._agents_ws_url = _normalize_agents_ws_url(agents_ws_url) if agents_ws_url else _default_agents_ws_url(self._api_base)

    def _hydrate_pod(self, data: dict) -> ReefPod:
        pod = ReefPod.from_dict(data)
        pod.agents_ws_url = self._agents_ws_url
        if pod.id and not pod.openclaw_url:
            pod.openclaw_url = f"{self._agents_ws_url}/{pod.id}"
        return pod

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

    def _agent_id_for_target(self, target: ReefPod | str) -> str:
        if isinstance(target, ReefPod):
            return target.id
        return str(target)

    def _file_headers(self, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _encode_file_path(self, path: str) -> str:
        return quote(path.lstrip("/"), safe="/")

    def _detect_shell(self, agent_id: str) -> str:
        probe = "if command -v bash >/dev/null 2>&1; then printf /bin/bash; else printf /bin/sh; fi"
        try:
            result = self.exec(ReefPod(id=agent_id, user_id="", pod_id="", pod_name="", state="running"), probe, timeout=15)
        except Exception:
            return "/bin/sh"
        shell = (result.stdout or "").strip()
        return shell if shell in {"/bin/bash", "/bin/sh"} else "/bin/sh"

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
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
        start: bool = True,
    ) -> ReefPod:
        """Create a new agent (provisions a reef pod via the backend).

        Args:
            name: Agent name.
            size: Size preset (small/medium/large). Default: medium.
            cpu: Custom CPU in cores (overrides size).
            memory: Custom memory in GB (overrides size).
            config: Optional config overrides.
            env: Optional environment variables to pass through to the pod.
            ports: Optional exposed ports config.
            start: Start the agent immediately (default: True).

        Returns:
            ReefPod with connection details.
        """
        prepared_config, effective_gateway_token = _build_agent_config(
            config,
            env=env,
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=image,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
        )
        body: dict = {"config": prepared_config, "start": start}
        if name:
            body["name"] = name
        if size:
            body["size"] = size
        if cpu is not None:
            body["cpu"] = cpu
        if memory is not None:
            body["memory"] = memory
        data = self._post("/api/agents", json=body)
        pod = self._hydrate_pod(data)
        pod.gateway_token = effective_gateway_token
        pod.launch_config = prepared_config
        pod.command = list(prepared_config.get("command") or [])
        pod.entrypoint = list(prepared_config.get("entrypoint") or [])
        return pod

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
        return [self._hydrate_pod(p) for p in items]

    def get(self, agent_id: str) -> ReefPod:
        """Get agent details by ID (refreshes status from Lagoon).

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod with current status.
        """
        data = self._get(f"/api/agents/{agent_id}")
        return self._hydrate_pod(data)

    def start(
        self,
        agent_id: str,
        config: dict = None,
        env: dict = None,
        ports: list = None,
        routes: dict = None,
        command: list[str] = None,
        entrypoint: list[str] = None,
        image: str = None,
        registry_url: str = None,
        registry_auth: dict = None,
        gateway_token: str = None,
    ) -> ReefPod:
        """Start a previously stopped agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod with new pod details.
        """
        prepared_config, effective_gateway_token = _build_agent_config(
            config,
            env=env,
            ports=ports,
            routes=routes,
            command=command,
            entrypoint=entrypoint,
            image=image,
            registry_url=registry_url,
            registry_auth=registry_auth,
            gateway_token=gateway_token,
        )
        data = self._post(f"/api/agents/{agent_id}/start", json={"config": prepared_config})
        pod = self._hydrate_pod(data)
        pod.gateway_token = effective_gateway_token
        pod.launch_config = prepared_config
        pod.command = list(prepared_config.get("command") or [])
        pod.entrypoint = list(prepared_config.get("entrypoint") or [])
        return pod

    def stop(self, agent_id: str) -> ReefPod:
        """Stop an agent (tears down pod, keeps DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            ReefPod in stopped state.
        """
        data = self._post(f"/api/agents/{agent_id}/stop")
        return self._hydrate_pod(data)

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
        """Execute a one-shot command on a reef pod via lagoon exec API.

        Args:
            pod: ReefPod to execute on.
            command: Shell command to run.
            timeout: Command timeout in seconds.

        Returns:
            ExecResult with exit_code, stdout, stderr.
        """
        with httpx.Client(timeout=max(timeout + 10, 35)) as client:
            resp = client.post(
                f"{self._api_base}/api/agents/{pod.id}/exec",
                headers=self._headers,
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

    def files_list(self, pod: ReefPod | str, path: str = "") -> list[dict]:
        """List files on an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self._api_base}/api/agents/{agent_id}/files",
                headers=self._file_headers(),
                params={"prefix": path},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        payload = resp.json()
        return [*(payload.get("directories") or []), *(payload.get("files") or [])]

    def file_read_bytes(self, pod: ReefPod | str, path: str) -> bytes:
        """Read a file from an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self._api_base}/api/agents/{agent_id}/files/download/{self._encode_file_path(path)}",
                headers=self._file_headers(),
                params={"source": "pod"},
                follow_redirects=True,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.content

    def file_read(self, pod: ReefPod | str, path: str) -> str:
        """Read a UTF-8 text file from an agent."""
        return self.file_read_bytes(pod, path).decode(errors="replace")

    def file_write_bytes(self, pod: ReefPod | str, path: str, content: bytes) -> dict:
        """Write raw bytes to an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.put(
                f"{self._api_base}/api/agents/{agent_id}/files/upload/{self._encode_file_path(path)}",
                headers=self._file_headers(content_type="application/octet-stream"),
                content=content,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def file_write(self, pod: ReefPod | str, path: str, content: str) -> dict:
        """Write a UTF-8 text file to an agent."""
        return self.file_write_bytes(pod, path, content.encode())

    def cp_to(self, pod: ReefPod | str, local_path: str | Path, remote_path: str) -> dict:
        """Copy a local file to an agent."""
        source = Path(local_path)
        return self.file_write_bytes(pod, remote_path, source.read_bytes())

    def cp_from(self, pod: ReefPod | str, remote_path: str, local_path: str | Path) -> Path:
        """Copy a file from an agent to the local filesystem."""
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.file_read_bytes(pod, remote_path))
        return dest

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

        url = f"{self._agents_ws_url}/{agent_id}?jwt={jwt}&container={container}&tail_lines={tail_lines}"

        async with websockets.connect(url) as ws:
            async for msg in ws:
                yield msg

    async def shell_connect(self, agent_id: str, shell: str | None = None):
        """Connect to agent shell via backend WebSocket proxy.

        Connects to the HyperClaw backend shell WebSocket which proxies
        to lagoon → k8s exec for bidirectional PTY access.

        Args:
            agent_id: Agent UUID.

        Returns:
            WebSocket connection for bidirectional shell I/O.
        """
        import websockets

        selected_shell = shell or self._detect_shell(agent_id)

        # Get shell token
        token_data = self._post(f"/api/agents/{agent_id}/shell/token")
        jwt = token_data["token"]

        url = f"{self._agents_ws_url}/shell/{agent_id}?jwt={jwt}&shell={selected_shell}"

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
