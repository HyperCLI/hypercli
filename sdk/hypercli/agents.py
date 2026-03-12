"""
HyperClaw Deployments API — runtime management for agent containers.

Client for HyperClaw backend deployment endpoints. Manages OpenClaw desktop
containers and arbitrary agent runtimes via the authenticated backend API.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import secrets
from typing import Optional, Any, AsyncIterator
from urllib.parse import quote, urlsplit
from contextlib import asynccontextmanager

import httpx

from .http import HTTPClient, APIError


AGENTS_API_BASE = "https://api.hypercli.com"
AGENTS_API_PREFIX = "/deployments"
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


def _parse_dt(val):
    if isinstance(val, str) and val:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    return None


def _agent_kwargs_from_dict(data: dict) -> dict[str, Any]:
    return {
        "id": data.get("id", ""),
        "user_id": data.get("user_id", ""),
        "pod_id": data.get("pod_id", ""),
        "pod_name": data.get("pod_name", ""),
        "state": data.get("state", "unknown"),
        "name": data.get("name"),
        "cpu": data.get("cpu", 0),
        "memory": data.get("memory", 0),
        "hostname": data.get("hostname"),
        "jwt_token": data.get("jwt_token"),
        "jwt_expires_at": _parse_dt(data.get("jwt_expires_at")),
        "started_at": _parse_dt(data.get("started_at")),
        "stopped_at": _parse_dt(data.get("stopped_at")),
        "last_error": data.get("last_error"),
        "created_at": _parse_dt(data.get("created_at")),
        "updated_at": _parse_dt(data.get("updated_at")),
        "launch_config": data.get("launch_config"),
        "routes": data.get("routes") or {},
        "command": data.get("command") or [],
        "entrypoint": data.get("entrypoint") or [],
        "ports": data.get("ports") or [],
        "dry_run": bool(data.get("dry_run")),
    }


@dataclass
class Agent:
    """Generic agent returned by the HyperClaw backend."""
    id: str  # Agent UUID from backend
    user_id: str
    pod_id: str
    pod_name: str
    state: str
    name: Optional[str] = None
    cpu: int = 0              # cores
    memory: int = 0           # GB
    hostname: Optional[str] = None
    jwt_token: Optional[str] = None
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
    dry_run: bool = False
    _deployments: Any = field(default=None, repr=False, compare=False)

    @classmethod
    def from_dict(cls, data: dict) -> "Agent":
        return cls(**_agent_kwargs_from_dict(data))

    @property
    def public_url(self) -> Optional[str]:
        if self.hostname:
            return f"https://{self.hostname}"
        return None

    @property
    def vnc_url(self) -> Optional[str]:
        return self.public_url

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

    def _require_deployments(self) -> "Deployments":
        if self._deployments is None:
            raise ValueError("Agent is not bound to a Deployments client")
        return self._deployments

    def refresh_token(self) -> dict:
        data = self._require_deployments().refresh_token(self.id)
        self.jwt_token = data.get("token") or data.get("jwt")
        self.jwt_expires_at = _parse_dt(data.get("expires_at"))
        return data

    def exec(self, command: str, timeout: int = 30, dry_run: bool = False) -> "ExecResult":
        return self._require_deployments().exec(self, command, timeout=timeout, dry_run=dry_run)

    def health(self) -> dict:
        return self._require_deployments().health(self)

    def files_list(self, path: str = "") -> list[dict]:
        return self._require_deployments().files_list(self, path)

    def file_read_bytes(self, path: str) -> bytes:
        return self._require_deployments().file_read_bytes(self, path)

    def file_read(self, path: str) -> str:
        return self._require_deployments().file_read(self, path)

    def file_write_bytes(self, path: str, content: bytes) -> dict:
        return self._require_deployments().file_write_bytes(self, path, content)

    def file_write(self, path: str, content: str) -> dict:
        return self._require_deployments().file_write(self, path, content)

    def cp_to(self, local_path: str | Path, remote_path: str) -> dict:
        return self._require_deployments().cp_to(self, local_path, remote_path)

    def cp_from(self, remote_path: str, local_path: str | Path) -> Path:
        return self._require_deployments().cp_from(self, remote_path, local_path)

    def logs_stream(self, lines: int = 100, follow: bool = True):
        return self._require_deployments().logs_stream(self, lines=lines, follow=follow)

    async def logs_stream_ws(self, tail_lines: int = 100, container: str = "reef") -> AsyncIterator[str]:
        async for line in self._require_deployments().logs_stream_ws(self.id, tail_lines=tail_lines, container=container):
            yield line

    async def shell_connect(self, shell: str | None = None):
        return await self._require_deployments().shell_connect(self.id, shell=shell)


@dataclass
class OpenClawAgent(Agent):
    """OpenClaw-backed agent with Gateway connection helpers."""
    gateway_url: Optional[str] = None
    gateway_token: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "OpenClawAgent":
        return cls(
            **_agent_kwargs_from_dict(data),
            gateway_url=data.get("openclaw_url") or data.get("gateway_url"),
            gateway_token=data.get("gateway_token"),
        )

    def gateway(self, **kwargs) -> "GatewayClient":
        """Create a GatewayClient for this OpenClaw agent."""
        from .gateway import GatewayClient
        if not self.gateway_url:
            raise ValueError("Agent has no OpenClaw gateway URL")
        if not self.jwt_token:
            raise ValueError("Agent has no JWT token — refresh it first")
        if self.gateway_token and "gateway_token" not in kwargs:
            kwargs["gateway_token"] = self.gateway_token
        return GatewayClient(url=self.gateway_url, token=self.jwt_token, **kwargs)

    @asynccontextmanager
    async def connect(self, **kwargs):
        """Open a temporary OpenClaw gateway session."""
        gw = self.gateway(**kwargs)
        async with gw:
            yield gw

    async def gateway_status(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.status()

    async def config_get(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_get()

    async def config_schema(self, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_schema()

    async def config_patch(self, patch: dict, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            return await gw.config_patch(patch)

    async def models_list(self, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.models_list()

    async def workspace_files(self, **kwargs) -> tuple[str, list[dict]]:
        async with self.connect(**kwargs) as gw:
            agents = await gw.agents_list()
            agent_id = agents[0]["id"] if agents else "main"
            files = await gw.files_list(agent_id)
            return agent_id, files

    async def file_get(self, name: str, agent_id: str | None = None, **kwargs) -> str:
        async with self.connect(**kwargs) as gw:
            resolved_agent_id = agent_id
            if resolved_agent_id is None:
                agents = await gw.agents_list()
                resolved_agent_id = agents[0]["id"] if agents else "main"
            return await gw.file_get(resolved_agent_id, name)

    async def file_set(self, name: str, content: str, agent_id: str | None = None, **kwargs) -> dict:
        async with self.connect(**kwargs) as gw:
            resolved_agent_id = agent_id
            if resolved_agent_id is None:
                agents = await gw.agents_list()
                resolved_agent_id = agents[0]["id"] if agents else "main"
            return await gw.file_set(resolved_agent_id, name, content)

    async def sessions_list(self, limit: int = 20, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.sessions_list(limit=limit)

    async def cron_list(self, **kwargs) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.cron_list()

    async def chat_history(
        self,
        session_key: str | None = None,
        limit: int = 50,
        **kwargs,
    ) -> list[dict]:
        async with self.connect(**kwargs) as gw:
            return await gw.chat_history(session_key=session_key, limit=limit)

    async def chat_send_message(
        self,
        message: str,
        *,
        session_key: str | None = None,
        agent_id: str | None = None,
        idempotency_key: str | None = None,
        timeout: float = 30,
        **kwargs,
    ) -> dict:
        params: dict[str, Any] = {"message": message}
        if session_key:
            params["sessionKey"] = session_key
        if agent_id:
            params["agentId"] = agent_id
        if idempotency_key:
            params["idempotencyKey"] = idempotency_key
        async with self.connect(**kwargs) as gw:
            return await gw.call("chat.send", params, timeout=timeout)

    async def chat_send(
        self,
        message: str,
        *,
        session_key: str | None = None,
        agent_id: str | None = None,
        **kwargs,
    ) -> AsyncIterator["ChatEvent"]:
        async with self.connect(**kwargs) as gw:
            async for event in gw.chat_send(message, session_key=session_key, agent_id=agent_id):
                yield event


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


class Deployments:
    """
    HyperClaw deployments API — manage agent runtimes.

    Usage:
        from hypercli import HyperCLI
        client = HyperCLI(api_key="...", agent_api_key="sk-...")

        # Launch
        pod = client.deployments.create()
        print(f"Desktop: {pod.vnc_url}")

        # Execute a command
        result = client.deployments.exec(pod, "echo hello")

        # List
        pods = client.deployments.list()

        # Stop
        client.deployments.stop(pod.id)
    """

    def __init__(
        self,
        http: HTTPClient,
        api_key: str = None,
        api_base: str = None,
        agents_ws_url: str = None,
    ):
        self._http = http
        self._api_key = api_key or http.api_key
        self._api_base = (api_base or AGENTS_API_BASE).rstrip("/")
        self._agents_ws_url = _normalize_agents_ws_url(agents_ws_url) if agents_ws_url else _default_agents_ws_url(self._api_base)

    def _hydrate_agent(self, data: dict) -> Agent:
        if data.get("openclaw_url") or data.get("gateway_url"):
            agent = OpenClawAgent.from_dict(data)
        else:
            agent = Agent.from_dict(data)
        agent._deployments = self
        return agent

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

    def _agent_id_for_target(self, target: Agent | str) -> str:
        if isinstance(target, Agent):
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
            result = self.exec(Agent(id=agent_id, user_id="", pod_id="", pod_name="", state="running"), probe, timeout=15)
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
        dry_run: bool = False,
        start: bool = True,
    ) -> Agent:
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
            Agent with connection details.
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
        if dry_run:
            body["dry_run"] = True
        if name:
            body["name"] = name
        if size:
            body["size"] = size
        if cpu is not None:
            body["cpu"] = cpu
        if memory is not None:
            body["memory"] = memory
        data = self._post(AGENTS_API_PREFIX, json=body)
        agent = self._hydrate_agent(data)
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        agent.launch_config = prepared_config
        agent.command = list(prepared_config.get("command") or [])
        agent.entrypoint = list(prepared_config.get("entrypoint") or [])
        return agent

    def budget(self) -> dict:
        """Get the user's current agent resource budget and usage.

        Returns:
            Dict with budget, used, available (all in cores/GB).
        """
        return self._get(f"{AGENTS_API_PREFIX}/budget")

    def metrics(self, agent_id: str) -> dict:
        """Get live CPU/memory metrics for a running agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with container metrics from k8s metrics-server.
        """
        return self._get(f"{AGENTS_API_PREFIX}/{agent_id}/metrics")

    def list(self) -> list[Agent]:
        """List all agents for the authenticated user.

        Returns:
            List of Agent objects.
        """
        data = self._get(AGENTS_API_PREFIX)
        items = data.get("items", data) if isinstance(data, dict) else data
        return [self._hydrate_agent(p) for p in items]

    def get(self, agent_id: str) -> Agent:
        """Get agent details by ID (refreshes status from Lagoon).

        Args:
            agent_id: Agent UUID.

        Returns:
            Agent with current status.
        """
        data = self._get(f"{AGENTS_API_PREFIX}/{agent_id}")
        return self._hydrate_agent(data)

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
        dry_run: bool = False,
    ) -> Agent:
        """Start a previously stopped agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Agent with new pod details.
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
        body: dict[str, Any] = {"config": prepared_config}
        if dry_run:
            body["dry_run"] = True
        data = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/start", json=body)
        agent = self._hydrate_agent(data)
        if isinstance(agent, OpenClawAgent):
            agent.gateway_token = effective_gateway_token
        agent.launch_config = prepared_config
        agent.command = list(prepared_config.get("command") or [])
        agent.entrypoint = list(prepared_config.get("entrypoint") or [])
        return agent

    def stop(self, agent_id: str) -> Agent:
        """Stop an agent (tears down pod, keeps DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            Agent in stopped state.
        """
        data = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/stop")
        return self._hydrate_agent(data)

    def delete(self, agent_id: str) -> dict:
        """Delete an agent entirely (pod + DB record).

        Args:
            agent_id: Agent UUID.

        Returns:
            Deletion status dict.
        """
        return self._delete(f"{AGENTS_API_PREFIX}/{agent_id}")

    def refresh_token(self, agent_id: str) -> dict:
        """Refresh the JWT token for an agent.

        Args:
            agent_id: Agent UUID.

        Returns:
            Dict with agent_id, pod_id, token, expires_at.
        """
        return self._get(f"{AGENTS_API_PREFIX}/{agent_id}/token")

    # -----------------------------------------------------------------------
    # Executor API (direct to reef pod via shell-{hostname})
    # -----------------------------------------------------------------------

    def _executor_headers(self, pod: Agent) -> dict:
        h = {}
        if pod.jwt_token:
            h["Authorization"] = f"Bearer {pod.jwt_token}"
            h["Cookie"] = f"{pod.pod_name}-token={pod.jwt_token}"
        return h

    def exec(self, pod: Agent, command: str, timeout: int = 30, dry_run: bool = False) -> ExecResult:
        """Execute a one-shot command on a reef pod via lagoon exec API.

        Args:
            pod: Agent to execute on.
            command: Shell command to run.
            timeout: Command timeout in seconds.

        Returns:
            ExecResult with exit_code, stdout, stderr.
        """
        with httpx.Client(timeout=max(timeout + 10, 35)) as client:
            resp = client.post(
                f"{self._api_base}{AGENTS_API_PREFIX}/{pod.id}/exec",
                headers=self._headers,
                json={"command": command, "timeout": timeout, **({"dry_run": True} if dry_run else {})},
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise APIError(resp.status_code, detail)
        return ExecResult.from_dict(resp.json())

    def health(self, pod: Agent) -> dict:
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

    def files_list(self, pod: Agent | str, path: str = "") -> list[dict]:
        """List files on an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files",
                headers=self._file_headers(),
                params={"prefix": path},
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        payload = resp.json()
        return [*(payload.get("directories") or []), *(payload.get("files") or [])]

    def file_read_bytes(self, pod: Agent | str, path: str) -> bytes:
        """Read a file from an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/download/{self._encode_file_path(path)}",
                headers=self._file_headers(),
                params={"source": "pod"},
                follow_redirects=True,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.content

    def file_read(self, pod: Agent | str, path: str) -> str:
        """Read a UTF-8 text file from an agent."""
        return self.file_read_bytes(pod, path).decode(errors="replace")

    def file_write_bytes(self, pod: Agent | str, path: str, content: bytes) -> dict:
        """Write raw bytes to an agent via the backend file API."""
        agent_id = self._agent_id_for_target(pod)
        with httpx.Client(timeout=10) as client:
            resp = client.put(
                f"{self._api_base}{AGENTS_API_PREFIX}/{agent_id}/files/upload/{self._encode_file_path(path)}",
                headers=self._file_headers(content_type="application/octet-stream"),
                content=content,
            )
        if resp.status_code >= 400:
            raise APIError(resp.status_code, resp.text)
        return resp.json()

    def file_write(self, pod: Agent | str, path: str, content: str) -> dict:
        """Write a UTF-8 text file to an agent."""
        return self.file_write_bytes(pod, path, content.encode())

    def cp_to(self, pod: Agent | str, local_path: str | Path, remote_path: str) -> dict:
        """Copy a local file to an agent."""
        source = Path(local_path)
        return self.file_write_bytes(pod, remote_path, source.read_bytes())

    def cp_from(self, pod: Agent | str, remote_path: str, local_path: str | Path) -> Path:
        """Copy a file from an agent to the local filesystem."""
        dest = Path(local_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.file_read_bytes(pod, remote_path))
        return dest

    def chat_stream(self, pod: OpenClawAgent, messages: list[dict], model: str = "hyperclaw/kimi-k2.5"):
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

    def logs_stream(self, pod: Agent, lines: int = 100, follow: bool = True):
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
        jwt = token_data["jwt"]

        url = f"{self._agents_ws_url}/{agent_id}?jwt={jwt}&container={container}&tail_lines={tail_lines}"

        async with websockets.connect(url) as ws:
            async for msg in ws:
                yield msg

    async def shell_connect(self, agent_id: str, shell: str | None = None, dry_run: bool = False):
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
        payload: dict[str, Any] = {"shell": selected_shell}
        if dry_run:
            payload["dry_run"] = True
        token_data = self._post(f"{AGENTS_API_PREFIX}/{agent_id}/shell/token", json=payload)
        jwt = token_data["jwt"]
        url = token_data.get("ws_url") or f"{self._agents_ws_url}/shell/{agent_id}?jwt={jwt}&shell={selected_shell}"

        return await websockets.connect(url, ping_interval=20, ping_timeout=20)
