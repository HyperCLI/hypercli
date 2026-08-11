"""The public agent file client is Reef-only and workspace-relative."""
from unittest.mock import Mock

import pytest

from hypercli.agents import Deployments, OpenClawAgent


def make_agent():
    deployments = Mock()
    deployments.files_list.return_value = [{"name": "out.txt", "type": "file"}]
    deployments.file_read_bytes.return_value = b"backend bytes"
    deployments.file_read_bytes_with_metadata.return_value = {
        "content": b"backend bytes",
        "mime_type": "text/plain",
    }
    deployments.file_read.return_value = "backend bytes"
    deployments.file_write.return_value = {"ok": True}
    deployments.file_write_bytes.return_value = {"ok": True}
    deployments.file_delete.return_value = {"ok": True}
    agent = OpenClawAgent(
        id="agent-123",
        user_id="user-456",
        state="STOPPED",
        _deployments=deployments,
    )
    return agent, deployments


def test_agent_files_delegate_without_source_or_destination_selectors():
    agent, deployments = make_agent()

    assert agent.files_list("notes") == [{"name": "out.txt", "type": "file"}]
    assert agent.file_read("AGENTS.md") == "backend bytes"
    assert agent.file_read_bytes("data.bin") == b"backend bytes"
    assert agent.file_read_bytes_with_metadata("data.bin")["mime_type"] == "text/plain"
    assert agent.file_write("notes/todo.md", "x") == {"ok": True}
    assert agent.file_write_bytes("data.bin", b"x") == {"ok": True}
    assert agent.file_delete("notes", recursive=True) == {"ok": True}

    deployments.files_list.assert_called_once_with(agent, "notes")
    deployments.file_read.assert_called_once_with(agent, "AGENTS.md")
    deployments.file_read_bytes.assert_called_once_with(agent, "data.bin")
    deployments.file_read_bytes_with_metadata.assert_called_once_with(agent, "data.bin")
    deployments.file_write.assert_called_once_with(agent, "notes/todo.md", "x")
    deployments.file_write_bytes.assert_called_once_with(agent, "data.bin", b"x")
    deployments.file_delete.assert_called_once_with(agent, "notes", recursive=True)


@pytest.mark.parametrize("path", ["/etc/hosts", "../outside", "notes/../../outside"])
def test_deployments_file_paths_cannot_escape_workspace(path):
    deployments = Deployments(
        Mock(api_key="test"),
        api_key="test",
        api_base="https://api.test.hypercli.com",
    )
    with pytest.raises(ValueError, match="workspace"):
        deployments.file_write("agent-123", path, "blocked")


def test_gateway_file_rpc_remains_explicit_on_openclaw_agent():
    agent, _ = make_agent()
    assert hasattr(agent, "workspace_files")
    assert hasattr(agent, "file_get")
    assert hasattr(agent, "file_set")
