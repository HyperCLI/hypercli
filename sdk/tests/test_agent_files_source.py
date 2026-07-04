"""Unified file API source switch (mirrors ts-sdk/tests/agent-files-source.test.ts).

Base Agent = backend sources (auto|pod|s3); OpenClawAgent adds the `gateway`
source routing to the operator-WS `agents.files.*` RPC.
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
    deployments.files_list.return_value = [{"name": "log.txt", "path": "log.txt", "type": "file"}]
    deployments.file_read_bytes.return_value = b"pod bytes"
    deployments.file_read.return_value = "pod bytes"
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


def test_gateway_write_routes_to_files_set_and_closes_client():
    agent, gateway_client, deployments = make_agent()
    res = agent.file_write("AGENTS.md", "hi there", "gateway")
    assert gateway_client.file_set_calls == [("agent-123", "AGENTS.md", "hi there")]
    assert gateway_client.closed == 1
    deployments.file_write.assert_not_called()
    assert res == {"name": "AGENTS.md", "source": "gateway"}


def test_gateway_write_bytes_decodes_utf8_and_rejects_binary():
    agent, gateway_client, _ = make_agent()
    agent.file_write_bytes("AGENTS.md", "héllo".encode(), "gateway")
    assert gateway_client.file_set_calls == [("agent-123", "AGENTS.md", "héllo")]
    with pytest.raises(UnicodeDecodeError):
        agent.file_write_bytes("AGENTS.md", b"\xff\xfe\x00binary", "gateway")


def test_gateway_read_routes_to_files_get():
    agent, gateway_client, _ = make_agent()
    assert agent.file_read("AGENTS.md", "gateway") == "hello from gateway"
    assert agent.file_read_bytes("AGENTS.md", "gateway") == b"hello from gateway"
    assert gateway_client.file_get_calls == [("agent-123", "AGENTS.md")] * 2


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


def test_non_gateway_sources_delegate_to_backend_deployments():
    agent, gateway_client, deployments = make_agent()
    agent.file_write("logs/out.txt", "data", "pod")
    deployments.file_write.assert_called_once_with(agent, "logs/out.txt", "data", destination="pod")
    assert gateway_client.file_set_calls == []

    agent.files_list("logs", "auto")
    deployments.files_list.assert_called_once_with(agent, "logs", source="auto")

    agent.file_read("logs/out.txt", "s3")
    deployments.file_read.assert_called_once_with(agent, "logs/out.txt", source="s3")

    agent.file_delete("logs/out.txt")
    deployments.file_delete.assert_called_once_with(agent, "logs/out.txt", False)
    assert gateway_client.files_list_calls == []
    assert gateway_client.file_get_calls == []


def test_gateway_delete_raises():
    agent, _, deployments = make_agent()
    with pytest.raises(ValueError, match="delete is not supported"):
        agent.file_delete("AGENTS.md", source="gateway")
    deployments.file_delete.assert_not_called()
