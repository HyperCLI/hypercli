"""Unified file API source switch (mirrors ts-sdk/tests/agent-files-source.test.ts).

One AgentFiles client wraps all three access paths behind a `source` switch. The
SDK owns the roots: workspace-relative paths are prefixed with
`.openclaw/workspace/` for the backend (agent/backup); `agent` also takes
absolute `/…` paths for full-fs; gateway is name-addressed within the workspace.
"""
from __future__ import annotations

from unittest.mock import Mock

import pytest

from hypercli.agents import OpenClawAgent


class FakeGatewayClient:
    """Stands in for a connected GatewayClient inside `async with agent.connect()`."""

    def __init__(self):
        self.files_list_calls: list[str] = []
        self.file_get_calls: list[tuple[str, str]] = []
        self.file_set_calls: list[tuple[str, str, str]] = []
        self.closed = 0

    async def __aenter__(self) -> "FakeGatewayClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        self.closed += 1

    async def agents_list(self) -> list[dict]:
        # The in-gateway agent is "main" — NOT the deployment id ("agent-123").
        return [{"id": "main"}]

    async def files_list(self, agent_id: str) -> list[dict]:
        self.files_list_calls.append(agent_id)
        return [{"name": "AGENTS.md", "size": 12, "missing": False}]

    async def file_get(self, agent_id: str, name: str) -> str:
        self.file_get_calls.append((agent_id, name))
        return "hello from gateway"

    async def file_set(self, agent_id: str, name: str, content: str) -> dict:
        self.file_set_calls.append((agent_id, name, content))
        return {"ok": True}


def make_agent():
    gateway_client = FakeGatewayClient()
    deployments = Mock()
    deployments.files_list.return_value = [{"name": "out.txt", "path": "out.txt", "type": "file"}]
    deployments.file_read_bytes.return_value = b"backend bytes"
    deployments.file_read.return_value = "backend bytes"
    deployments.file_write.return_value = {"ok": True}
    deployments.file_write_bytes.return_value = {"ok": True}
    deployments.file_delete.return_value = {"ok": True}
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        pod_id="pod-789",
        pod_name="test-pod",
        state="running",
        gateway_url="wss://gw",
        gateway_token="t",
        _deployments=deployments,
    )
    # Bypass the real connect/handshake — route _with_gateway to our fake client.
    agent.gateway = Mock(return_value=gateway_client)  # type: ignore[method-assign]
    return agent, gateway_client, deployments


# --- gateway: name-addressed workspace, resolved agent id ---
def test_gateway_write_hits_files_set_with_resolved_id_and_bare_name():
    agent, gateway_client, deployments = make_agent()
    res = agent.file_write("AGENTS.md", "hi there", "gateway")
    assert gateway_client.file_set_calls == [("main", "AGENTS.md", "hi there")]
    assert gateway_client.closed == 1
    deployments.file_write.assert_not_called()
    assert res == {"name": "AGENTS.md", "source": "gateway", "agentId": "main"}


def test_gateway_read_strips_workspace_prefix_to_bare_name():
    agent, gateway_client, _ = make_agent()
    assert agent.file_read(".openclaw/workspace/AGENTS.md", "gateway") == "hello from gateway"
    assert gateway_client.file_get_calls == [("main", "AGENTS.md")]


def test_gateway_write_bytes_decodes_utf8_and_rejects_binary():
    agent, gateway_client, _ = make_agent()
    agent.file_write_bytes("AGENTS.md", "héllo".encode(), "gateway")
    assert gateway_client.file_set_calls == [("main", "AGENTS.md", "héllo")]
    with pytest.raises(UnicodeDecodeError):
        agent.file_write_bytes("AGENTS.md", b"\xff\xfe\x00binary", "gateway")


def test_gateway_read_bytes_encodes_utf8():
    agent, gateway_client, _ = make_agent()
    assert agent.file_read("AGENTS.md", "gateway") == "hello from gateway"
    assert agent.file_read_bytes("AGENTS.md", "gateway") == b"hello from gateway"
    assert gateway_client.file_get_calls == [("main", "AGENTS.md")] * 2


def test_gateway_list_maps_entries_to_file_entry_shape():
    agent, _, _ = make_agent()
    assert agent.files_list("", "gateway") == [
        {"name": "AGENTS.md", "path": "AGENTS.md", "type": "file", "size": 12}
    ]
    # A non-empty path filters the workspace-flat listing by name/prefix.
    assert agent.files_list("AGENTS.md", "gateway") == [
        {"name": "AGENTS.md", "path": "AGENTS.md", "type": "file", "size": 12}
    ]
    assert agent.files_list("nested/dir", "gateway") == []


# --- agent (pod) / backup (s3): workspace-relative → prefixed backend path ---
def test_agent_source_prefixes_workspace_and_maps_to_wire_pod():
    agent, _, deployments = make_agent()
    agent.file_write("notes/todo.md", "x", "agent")
    deployments.file_write.assert_called_once_with(
        agent, ".openclaw/workspace/notes/todo.md", "x", destination="pod"
    )


def test_backup_source_prefixes_workspace_and_maps_to_wire_s3():
    agent, _, deployments = make_agent()
    agent.files_list("logs", "backup")
    deployments.files_list.assert_called_once_with(
        agent, ".openclaw/workspace/logs", source="s3"
    )


def test_same_workspace_relative_name_is_same_file_on_all_three_sources():
    agent, gateway_client, deployments = make_agent()
    agent.file_read("AGENTS.md", "gateway")
    agent.file_read_bytes("AGENTS.md", "agent")
    agent.file_read_bytes("AGENTS.md", "backup")
    assert gateway_client.file_get_calls == [("main", "AGENTS.md")]
    assert deployments.file_read_bytes.call_args_list[0].args == (
        agent,
        ".openclaw/workspace/AGENTS.md",
    )
    assert deployments.file_read_bytes.call_args_list[0].kwargs == {"source": "pod"}
    assert deployments.file_read_bytes.call_args_list[1].args == (
        agent,
        ".openclaw/workspace/AGENTS.md",
    )
    assert deployments.file_read_bytes.call_args_list[1].kwargs == {"source": "s3"}


# --- full-fs: absolute paths only on agent ---
def test_agent_accepts_absolute_path_for_full_fs():
    agent, _, deployments = make_agent()
    agent.file_read("/etc/hosts", "agent")
    deployments.file_read.assert_called_once_with(agent, "/etc/hosts", source="pod")


def test_absolute_paths_rejected_for_backup_and_gateway():
    agent, _, _ = make_agent()
    with pytest.raises(ValueError, match=r"absolute paths need the 'agent' source"):
        agent.file_read("/etc/hosts", "backup")
    with pytest.raises(ValueError, match=r"absolute paths are not valid for the 'gateway'"):
        agent.file_read("/etc/hosts", "gateway")


# --- deprecated aliases still work ---
def test_pod_s3_aliases_still_map_to_agent_backup():
    agent, _, deployments = make_agent()
    agent.file_write("a.md", "x", "pod")
    agent.file_write("a.md", "x", "s3")
    assert deployments.file_write.call_args_list[0].args == (
        agent,
        ".openclaw/workspace/a.md",
        "x",
    )
    assert deployments.file_write.call_args_list[0].kwargs == {"destination": "pod"}
    assert deployments.file_write.call_args_list[1].args == (
        agent,
        ".openclaw/workspace/a.md",
        "x",
    )
    assert deployments.file_write.call_args_list[1].kwargs == {"destination": "s3"}


def test_non_gateway_sources_delegate_to_backend_deployments():
    agent, gateway_client, deployments = make_agent()
    agent.file_read("logs/out.txt", "auto")
    deployments.file_read.assert_called_once_with(
        agent, ".openclaw/workspace/logs/out.txt", source="auto"
    )
    agent.file_delete("logs/out.txt")
    deployments.file_delete.assert_called_once_with(
        agent, ".openclaw/workspace/logs/out.txt", False
    )
    assert gateway_client.files_list_calls == []
    assert gateway_client.file_get_calls == []
    assert gateway_client.file_set_calls == []


def test_gateway_delete_raises():
    agent, _, deployments = make_agent()
    with pytest.raises(ValueError, match="delete is not supported"):
        agent.file_delete("AGENTS.md", source="gateway")
    deployments.file_delete.assert_not_called()
