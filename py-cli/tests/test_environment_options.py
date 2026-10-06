"""Public endpoints come from canonical config, never environment flags."""

import re
import socket

import httpx
import pytest
from hypercli_cli.cli import app
from typer.core import TyperGroup
from typer.main import get_command
from typer.testing import CliRunner

REMOVED_OPTIONS = {
    "--dev", "--prod", "--base-url", "--api-url", "--agents-ws-url", "--relay-base-url",
}


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch, tmp_path):
    from hypercli import config

    monkeypatch.setenv("HYPER_HOME", str(tmp_path))
    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "config")
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.delenv("HYPER_AGENTS_API_BASE", raising=False)
    monkeypatch.setenv("HYPER_API_KEY", "test-only-key")

    def no_network(*args, **kwargs):
        raise AssertionError("These CLI tests must not access the network")

    monkeypatch.setattr(socket.socket, "connect", no_network)


def test_no_public_command_registers_endpoint_options():
    visited = []

    def check(command, path=()):
        visited.append(path)
        for param in command.params:
            assert REMOVED_OPTIONS.isdisjoint(param.opts + param.secondary_opts), path
        if isinstance(command, TyperGroup):
            for name, child in command.commands.items():
                check(child, (*path, name))

    check(get_command(app))
    assert ("wallet", "login") in visited
    assert ("agent", "embed", "text") in visited


@pytest.mark.parametrize("command", [
    [], ["agents"], ["agent", "plans"], ["agent", "onboard"],
    ["agent", "embed", "test"], ["voice", "tts"], ["llm", "chat"],
    ["wallet", "topup"], ["wallet", "login"],
])
def test_help_documents_config_without_removed_flags(command):
    result = CliRunner().invoke(app, [*command, "--help"], color=False)
    assert result.exit_code == 0, result.output
    plain = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
    for flag in REMOVED_OPTIONS:
        assert re.search(re.escape(flag) + r"(?![\w-])", plain) is None
    if not command:
        assert "HYPER_API_BASE" in plain


@pytest.mark.parametrize("command", [
    [], ["agents"], ["agent", "plans"], ["agent", "current-plan"],
    ["agent", "subscriptions"], ["agent", "subscription-summary"],
    ["agent", "start"], ["agent", "stop"], ["agent", "enable"],
    ["agent", "activate-code"], ["agent", "models"], ["agent", "onboard"],
    ["agent", "embed", "text"], ["agent", "embed", "test"],
    ["wallet", "topup"], ["wallet", "login"],
])
@pytest.mark.parametrize("flag", ["--dev", "--prod"])
def test_environment_flags_rejected_before_command_execution(command, flag):
    result = CliRunner().invoke(app, [*command, flag], color=False)
    assert result.exit_code == 2, result.output
    assert "No such option" in result.output
    plain = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
    assert flag in plain


@pytest.mark.parametrize(("command", "flag"), [
    (["agents"], "--agents-ws-url"),
    (["agent", "enable"], "--relay-base-url"),
    (["agent", "login"], "--api-url"),
    (["wallet", "login"], "--api-url"),
    (["wallet", "topup"], "--api-url"),
    (["llm", "chat"], "--base-url"),
    (["llm", "image"], "--base-url"),
    (["voice", "tts"], "--base-url"),
    (["voice", "clone"], "--base-url"),
    (["voice", "design"], "--base-url"),
    (["memory", "import"], "--base-url"),
])
def test_endpoint_override_flags_rejected(command, flag):
    result = CliRunner().invoke(app, [*command, flag, "https://unused.test"])
    assert result.exit_code == 2, result.output
    assert "No such option" in result.output


@pytest.mark.parametrize("source", ["env", "config"])
@pytest.mark.parametrize(("base", "service_base"), [
    ("https://api.dev.hypercli.com", "https://api.agents.dev.hypercli.com"),
    ("https://api.hypercli.com", "https://api.agents.hypercli.com"),
    ("https://customer.example.test", "https://customer.example.test"),
    ("http://127.0.0.1:8787", "http://127.0.0.1:8787"),
])
def test_canonical_base_routes_public_clients(monkeypatch, tmp_path, source, base, service_base):
    from hypercli_cli import agent, agents, llm, voice

    if source == "env":
        (tmp_path / "config").write_text("HYPER_API_BASE=https://default.example.test\n")
        monkeypatch.setenv("HYPER_API_BASE", base)
    else:
        (tmp_path / "config").write_text(f"HYPER_API_BASE={base}\n")
    monkeypatch.setenv("HYPER_SLACK_RELAY_BASE_URL", "https://ignored.test")
    monkeypatch.setenv("SLACK_RELAY_BASE_URL", "https://ignored.test")

    assert agent._get_agent_query_client().api_url == base
    assert agent._get_deployments_client()._api_base == f"{base}/agents"
    assert agents._get_deployments_client()._api_base == f"{base}/agents"
    assert agent._resolve_slack_relay_base() == service_base
    assert agent._resolve_api_base() == service_base
    assert llm._resolve_api_base(None) == base
    assert voice._resolve_api_base(None) == base


@pytest.mark.parametrize("source", ["env", "config"])
def test_divergent_bases_route_public_clients(monkeypatch, tmp_path, source):
    from hypercli_cli import agent, agents, llm, voice

    monkeypatch.setenv("HYPER_API_BASE", "https://inference.example/prefix")
    if source == "env":
        monkeypatch.setenv("HYPER_AGENTS_API_BASE", "https://api.dev.hypercli.com/agents///")
    else:
        (tmp_path / "config").write_text("HYPER_AGENTS_API_BASE=https://api.dev.hypercli.com/agents///\n")
    client = agent._get_agent_query_client()
    assert client.api_url == "https://inference.example/prefix"
    assert client.agent._base_url == "https://inference.example/prefix/v1"
    assert client.agent._control_base_url == "https://api.dev.hypercli.com/agents"
    deployments = agents._get_deployments_client()
    assert deployments._api_base == "https://api.dev.hypercli.com/agents"
    assert deployments._agents_ws_url == "wss://api.agents.dev.hypercli.com/ws"
    assert agent._resolve_slack_relay_base() == "https://api.agents.dev.hypercli.com"
    assert agent._resolve_api_base() == "https://inference.example/prefix"
    assert llm._resolve_api_base(None) == "https://inference.example/prefix"
    assert voice._voice_client("synthetic-key")._agents_api_base_url == "https://api.dev.hypercli.com/agents"


@pytest.mark.parametrize(("product_env", "product_config", "expected"), [
    ("test-customer-env", "test-config", "test-customer-env"),
    (None, "test-customer-config", "test-customer-config"),
    (None, None, "test-runtime-fallback"),
])
def test_canonical_key_precedes_runtime_fallback(
    monkeypatch, tmp_path, product_env, product_config, expected,
):
    from hypercli_cli import agent, agents, embed, llm, voice, workspaces

    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "test-runtime-fallback")
    if product_env:
        monkeypatch.setenv("HYPER_API_KEY", product_env)
    if product_config:
        (tmp_path / "config").write_text(f"HYPER_API_KEY={product_config}\n")

    assert agent._resolve_agent_query_key() == expected
    assert agents._get_agent_api_key() == expected
    assert workspaces._workspace_api_key() == expected
    assert agent._get_agent_query_client().api_key == expected
    for resolve in (agent._resolve_api_key, embed._get_api_key, llm._resolve_api_key, voice._get_api_key):
        assert resolve(None) == expected
        assert resolve("test-explicit-key") == "test-explicit-key"


@pytest.mark.parametrize("source", ["env", "config"])
def test_embedding_request_uses_canonical_base(monkeypatch, tmp_path, source):
    base = "https://api.dev.hypercli.com"
    if source == "env":
        monkeypatch.setenv("HYPER_API_BASE", base)
    else:
        (tmp_path / "config").write_text(f"HYPER_API_BASE={base}\n")
    requests = []

    def post(url, **kwargs):
        requests.append(url)
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "data": [{"embedding": [0.1, 0.2]}], "usage": {"total_tokens": 1},
        })

    monkeypatch.setattr("hypercli_cli.embed.httpx.post", post)
    result = CliRunner().invoke(app, ["agent", "embed", "text", "hello", "--json"])
    assert result.exit_code == 0, result.output
    assert requests == [f"{base}/v1/embeddings"]


def test_onboarding_uses_configured_base(monkeypatch):
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")
    called = []
    monkeypatch.setattr("hypercli_cli.onboard._run_dry", lambda base, **kwargs: called.append(base))
    result = CliRunner().invoke(app, ["agent", "onboard", "--dry-run"])
    assert result.exit_code == 0, result.output
    assert called == ["https://api.dev.hypercli.com"]
