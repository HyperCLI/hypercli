import importlib
from pathlib import Path
import pytest


@pytest.mark.parametrize("ws_url", [
    "wss://transport.example/custom/bridge",
    "wss://transport.example/custom/bridge?token=synthetic&route=worker",
    "ws://127.0.0.1:8787/custom/socket/",
])
def test_explicit_transport_url_is_preserved_verbatim(ws_url):
    from hypercli import HyperCLI

    client = HyperCLI(
        api_key="synthetic-key", api_url="https://inference.example",
        agents_api_base_url="https://control.example/agents", agents_ws_url=ws_url,
    )
    assert client.deployments._agents_ws_url == ws_url


@pytest.mark.parametrize("source", ["env", "file", "constructor"])
@pytest.mark.parametrize("control,rest,ws", [
    ("https://api.agents.dev.hypercli.com", "https://api.agents.dev.hypercli.com/agents", "wss://api.agents.dev.hypercli.com/ws"),
    ("https://api.agents.hypercli.com/api/", "https://api.agents.hypercli.com/agents", "wss://api.agents.hypercli.com/ws"),
    ("http://control.example:8787/prefix/agents///", "http://control.example:8787/prefix/agents", "ws://control.example:8787/prefix/ws"),
    ("https://api.agents.dev.hypercli.com/prefix/api/", "https://api.agents.dev.hypercli.com/prefix/agents", "wss://api.agents.dev.hypercli.com/prefix/ws"),
])
def test_explicit_control_origin_and_sibling_tunnel(monkeypatch, tmp_path, source, control, rest, ws):
    import httpx
    from hypercli import HyperCLI, config

    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "config")
    monkeypatch.setenv("HYPER_API_BASE", "https://inference.example")
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", control if source == "env" else "")
    (tmp_path / "config").write_text(f"HYPER_AGENTS_API_BASE={control}\n" if source == "file" else "")
    client = HyperCLI(api_key="synthetic-key", agents_api_base_url=control if source == "constructor" else None)
    assert client.deployments._api_base == rest
    assert client.deployments._agents_ws_url == ws
    assert client.agent._base_url == "https://inference.example/v1"
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(str(url))
        payload = {"plans": []} if str(url).endswith("/plans") else []
        return httpx.Response(200, json=payload, request=httpx.Request(method, url))
    monkeypatch.setattr(httpx.Client, "request", request)
    client.jobs.list()
    client.agent.plans()
    client.runners.list()
    assert calls == ["https://inference.example/api/jobs", f"{rest}/plans", f"{rest}/runners"]


@pytest.mark.parametrize("source", ["env", "file"])
def test_divergent_bases_and_constructor_precedence(monkeypatch, tmp_path, source):
    import hypercli.config as config
    from hypercli import HyperCLI

    monkeypatch.setattr(config, "CONFIG_FILE", tmp_path / "config")
    monkeypatch.setenv("HYPER_API_BASE", "https://inference.example/prefix")
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", "https://api.dev.hypercli.com/agents///" if source == "env" else "")
    (tmp_path / "config").write_text("HYPER_AGENTS_API_BASE=https://api.dev.hypercli.com/agents///\n")
    client = HyperCLI(api_key="synthetic-key")
    assert client.api_url == "https://inference.example/prefix"
    assert client.agent._base_url == "https://inference.example/prefix/v1"
    assert client.deployments._api_base == "https://api.dev.hypercli.com/agents"
    assert client.deployments._agents_ws_url == "wss://api.agents.dev.hypercli.com/ws"
    assert client.agent._control_base_url == client.deployments._api_base
    explicit = HyperCLI(api_key="synthetic-key", api_url="https://explicit-product.example", agents_api_base_url="http://explicit-control.example/prefix/api///")
    assert explicit.api_url == "https://explicit-product.example"
    assert explicit.deployments._api_base == "http://explicit-control.example/prefix/agents"
    assert explicit.deployments._agents_ws_url == "ws://explicit-control.example/prefix/ws"
    transport = HyperCLI(api_key="synthetic-key", agents_ws_url="wss://transport.example/custom/ws")
    assert transport.deployments._agents_ws_url == "wss://transport.example/custom/ws"
    assert HyperCLI(api_key="synthetic-key", api_url="https://external.example").deployments._api_base == client.deployments._api_base
    monkeypatch.setenv("HYPER_AGENTS_API_BASE", "https://env-control.example/prefix/")
    assert config.get_agents_api_base_url() == "https://env-control.example/prefix/agents"
    monkeypatch.delenv("HYPER_API_BASE")
    assert config.get_api_url() == config.DEFAULT_API_URL


@pytest.mark.parametrize("quote", ["", '"', "'"])
def test_shared_config_parsing_and_key_precedence(monkeypatch, tmp_path, quote):
    import hypercli.config as config
    from hypercli import HyperCLI

    config_path = tmp_path / "config"
    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    config_path.write_text(
        "# shared CLI/SDK config\n"
        f" export HYPER_API_KEY = {quote}canonical=key{quote} \n"
        f" export HYPER_API_BASE = {quote}https://file.example/prefix{quote} \n"
    )
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "managed-fallback")
    monkeypatch.setenv("HYPER_API_KEY", "canonical-env")
    monkeypatch.setenv("HYPER_API_BASE", "https://env.example")
    assert config.get_agent_api_key() == "canonical-env"
    assert config.get_api_url() == "https://env.example"
    monkeypatch.delenv("HYPER_API_KEY")
    monkeypatch.delenv("HYPER_API_BASE")
    client = HyperCLI()
    assert client.api_key == "canonical=key"
    assert client.deployments._api_key == "canonical=key"
    assert client.api_url == "https://file.example/prefix"
    assert client.deployments._api_base == "https://file.example/prefix/agents"
    config_path.write_text('export HYPER_API_KEY=""\n')
    fallback_client = HyperCLI()
    assert fallback_client.api_key == "managed-fallback"
    assert fallback_client.deployments._api_key == "managed-fallback"


@pytest.mark.parametrize("source", ["env", "file"])
def test_namespace_bases_ignore_stale_overrides(monkeypatch, tmp_path, source):
    import hypercli.config as config
    from hypercli.workspaces import _derive_workspaces_base, WorkspacesAPI
    from hypercli.routines import _derive_routines_base, RoutinesAPI
    from hypercli.runners import _derive_runners_base, RunnersAPI

    config_path = tmp_path / "config"
    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    stale_keys = [
        "HYPER_WORKSPACES_API_BASE",
        "HYPER_ROUTINES_API_BASE", "HYPER_RUNNERS_API_BASE", "HYPER_INTEGRATIONS_API_BASE",
    ]
    stale_config = "\n".join(f"{key}=https://stale.example/wrong" for key in stale_keys)
    for key in stale_keys:
        monkeypatch.setenv(key, "https://stale.example/wrong" if source == "env" else "")
    config_path.write_text(stale_config if source == "file" else "")
    assert config.get_api_url() == config.DEFAULT_API_URL
    assert config.get_agents_api_base_url() == config.DEFAULT_AGENTS_API_BASE_URL
    assert config.get_agents_ws_url() == config.DEFAULT_AGENTS_WS_URL
    namespaces = [
        (_derive_workspaces_base, WorkspacesAPI, "/workspaces"),
        (_derive_routines_base, RoutinesAPI, "/routines"),
        (_derive_runners_base, RunnersAPI, "/agents/runners"),
    ]
    for derive, api_type, suffix in namespaces:
        assert derive() == f"https://api.hypercli.com{suffix}"
        assert derive("https://explicit.example/prefix/agents") == f"https://explicit.example/prefix{suffix}"
        assert api_type("synthetic-key", api_base="https://explicit.example/custom").api_base == "https://explicit.example/custom"
    config_path.write_text(
        (stale_config if source == "file" else "")
        + "\nHYPER_API_BASE=https://file.example/prefix\n"
    )
    assert config.get_agents_api_base_url() == "https://file.example/prefix/agents"
    for derive, _, suffix in namespaces:
        assert derive() == f"https://file.example/prefix{suffix}"
    monkeypatch.setenv("HYPER_API_BASE", "https://env.example")
    assert config.get_api_url() == "https://env.example"
    assert config.get_agents_api_base_url() == "https://env.example/agents"
    for derive, _, suffix in namespaces:
        assert derive() == f"https://env.example{suffix}"


def test_agents_urls_default_to_agents_hosts(monkeypatch):
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.setenv("HOME", str(Path("/tmp/hypercli-sdk-test-home")))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"
    assert config.get_agents_api_base_url(dev=True) == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url(dev=True) == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_urls_ignore_legacy_override_envs(monkeypatch):
    """Strict derive-only: only HYPER_API_BASE steers resolution."""
    monkeypatch.setenv("AGENTS_API_BASE_URL", "https://api.dev.hypercli.com/agents")
    monkeypatch.setenv("AGENTS_WS_URL", "wss://api.agents.dev.hypercli.com/ws")
    monkeypatch.setenv("HYPERCLI_API_URL", "https://api.dev.hypercli.com")
    monkeypatch.setenv("HYPERCLI_WS_URL", "wss://api.dev.hypercli.com")
    monkeypatch.delenv("HYPER_API_BASE", raising=False)
    monkeypatch.setenv("HOME", str(Path("/tmp/hypercli-sdk-test-home")))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_url() == "https://api.hypercli.com"
    assert config.get_ws_url() == "wss://api.hypercli.com"
    assert config.get_agents_api_base_url() == "https://api.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.hypercli.com/ws"


def test_agent_key_prefers_product_env_then_managed_agent_env(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_product")
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agent_api_key() == "hyper_api_product"
    assert config.get_api_key() == "hyper_api_product"


def test_agent_key_prefers_product_config_before_managed_agent_env(
    monkeypatch, tmp_path
):
    config_path = tmp_path / "config"
    config_path.write_text("HYPER_API_KEY=hyper_api_configured\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HYPER_AGENTS_API_KEY", "hyper_api_agent")

    import hypercli.config as config

    monkeypatch.setattr(config, "CONFIG_FILE", config_path)

    assert config.get_agent_api_key() == "hyper_api_configured"


def test_hyper_home_is_data_dir(monkeypatch, tmp_path):
    hyper_home = tmp_path / "hyper-data"
    hyper_home.mkdir()
    (hyper_home / "config").write_text("HYPER_API_KEY=hyper_api_home\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HYPER_HOME", str(hyper_home))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_key() == "hyper_api_home"


def test_hyper_home_missing_config_does_not_read_default_home(monkeypatch, tmp_path):
    fake_home = tmp_path / "home"
    default_dir = fake_home / ".hypercli"
    hyper_home = tmp_path / "custom-data"
    default_dir.mkdir(parents=True)
    hyper_home.mkdir()
    (default_dir / "config").write_text("HYPER_API_KEY=hyper_api_default\n")
    monkeypatch.delenv("HYPER_API_KEY", raising=False)
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("HYPER_HOME", str(hyper_home))

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_api_key() is None


def test_agents_base_tracks_product_base(monkeypatch):
    monkeypatch.setenv("HYPER_API_BASE", "https://api.dev.hypercli.com")

    import hypercli.config as config

    importlib.reload(config)

    assert config.get_agents_api_base_url() == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url() == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_base_can_be_derived_from_explicit_product_base():
    import hypercli.config as config

    assert config.get_agents_api_base_url_from_product_base("https://api.dev.hypercli.com") == "https://api.dev.hypercli.com/agents"
    assert config.get_agents_ws_url_from_product_base("https://api.dev.hypercli.com") == "wss://api.agents.dev.hypercli.com/ws"


def test_agents_admin_base_derives_from_product_base():
    import hypercli.config as config

    assert config.get_agents_admin_api_base_url_from_product_base("") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.hypercli.com") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.hypercli.com/api") == "https://api.agents.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.dev.hypercli.com") == "https://api.agents.dev.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("https://api.dev.hypercli.com/agents") == "https://api.agents.dev.hypercli.com"
    assert config.get_agents_admin_api_base_url_from_product_base("http://127.0.0.1:8787") == "http://127.0.0.1:8787"
    assert config.get_agents_admin_api_base_url_from_product_base("http://127.0.0.1:8787/api") == "http://127.0.0.1:8787"


# LOCKSTEP cross-SDK byte-match vector table, mirrored with ts-sdk
# (agent-urls.ts: resolveAgentsApiBase / defaultAgentsWsUrl /
# agentsAdminApiBaseFromProductBase) and rs-sdk (config.rs:
# normalize_agents_api_base / default_agents_ws_url). Every row must produce
# byte-identical output in all three SDKs: host case is lowercased, default
# ports are stripped, non-default ports are preserved, and trailing slashes
# collapse before derivation.
# Columns: (input, agents_api_base, agents_ws_url, agents_admin_base).
_LOCKSTEP_URL_VECTORS = [
    (
        "",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://api.hypercli.com",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://api.hyperclaw.app",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://api.agents.hypercli.com",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "api.hypercli.com",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://api.dev.hypercli.com",
        "https://api.dev.hypercli.com/agents",
        "wss://api.agents.dev.hypercli.com/ws",
        "https://api.agents.dev.hypercli.com",
    ),
    (
        "https://api.dev.hyperclaw.app",
        "https://api.dev.hypercli.com/agents",
        "wss://api.agents.dev.hypercli.com/ws",
        "https://api.agents.dev.hypercli.com",
    ),
    (
        "https://dev-api.hyperclaw.app",
        "https://api.dev.hypercli.com/agents",
        "wss://api.agents.dev.hypercli.com/ws",
        "https://api.agents.dev.hypercli.com",
    ),
    (
        "api.agents.dev.hypercli.com",
        "https://api.dev.hypercli.com/agents",
        "wss://api.agents.dev.hypercli.com/ws",
        "https://api.agents.dev.hypercli.com",
    ),
    (
        "https://api.hypercli.com:443/agents",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "HTTPS://API.HYPERCLI.COM",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://API.AGENTS.HYPERCLI.COM/api",
        "https://api.hypercli.com/agents",
        "wss://api.agents.hypercli.com/ws",
        "https://api.agents.hypercli.com",
    ),
    (
        "https://staging.eu.example.com",
        "https://staging.eu.example.com/agents",
        "wss://staging.eu.example.com/ws",
        "https://staging.eu.example.com",
    ),
    (
        "https://staging.example.com:8443",
        "https://staging.example.com:8443/agents",
        "wss://staging.example.com:8443/ws",
        "https://staging.example.com:8443",
    ),
    (
        "https://edge.example.com/api",
        "https://edge.example.com/agents",
        "wss://edge.example.com/ws",
        "https://edge.example.com",
    ),
    (
        "https://edge.example.com/agents",
        "https://edge.example.com/agents",
        "wss://edge.example.com/ws",
        "https://edge.example.com",
    ),
    (
        "https://edge.example.com/agents/",
        "https://edge.example.com/agents",
        "wss://edge.example.com/ws",
        "https://edge.example.com",
    ),
    (
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8080/agents",
        "ws://127.0.0.1:8080/ws",
        "http://127.0.0.1:8080",
    ),
    (
        "http://127.0.0.1:80/api",
        "http://127.0.0.1/agents",
        "ws://127.0.0.1/ws",
        "http://127.0.0.1",
    ),
    (
        "https://edge.example.com/agents/admin",
        "https://edge.example.com/agents/admin/agents",
        "wss://edge.example.com/agents/admin/ws",
        "https://edge.example.com",
    ),
]


def test_agents_url_lockstep_vectors_byte_match_cross_sdk():
    import hypercli.config as config

    for product_base, api_base, ws_url, admin_base in _LOCKSTEP_URL_VECTORS:
        assert config.get_agents_api_base_url_from_product_base(product_base) == api_base, product_base
        assert config.get_agents_ws_url_from_product_base(product_base) == ws_url, product_base
        assert config.get_agents_admin_api_base_url_from_product_base(product_base) == admin_base, product_base


def test_agents_url_vectors_schemeless_custom_host_echoes_raw_input():
    """Scheme-less custom hosts echo the input verbatim (py/ts behavior);
    rs-sdk prepends the implied https:// in its typed-Url output — a
    documented divergence, so this vector stays out of the shared table."""
    import hypercli.config as config

    assert config.get_agents_api_base_url_from_product_base("staging.eu.example.com") == "staging.eu.example.com/agents"
    # The WS derivation re-normalizes its input (mirrors ts
    # defaultAgentsWsUrl → resolveAgentsApiBase), which upgrades the
    # scheme-less echo to the implied https↔wss scheme.
    assert config.get_agents_ws_url_from_product_base("staging.eu.example.com") == "wss://staging.eu.example.com/ws"
    assert config.get_agents_admin_api_base_url_from_product_base("staging.eu.example.com") == "https://staging.eu.example.com"


def test_configure_prunes_legacy_keys_on_write(monkeypatch, tmp_path):
    config_path = tmp_path / "config"
    config_path.write_text(
        "HYPERCLI_API_KEY=legacy_key\n"
        "HYPERCLI_API_URL=https://legacy.example.com\n"
        "HYPERCLI_WS_URL=wss://legacy.example.com\n"
        "AGENTS_API_BASE_URL=https://legacy.example.com/agents\n"
        "AGENTS_WS_URL=wss://legacy.example.com/ws\n"
        "HYPER_API_KEY=old_key\n"
        "HYPER_AGENTS_API_BASE=https://control.example/prefix\n"
        "UNRELATED_KEY=keepme\n"
    )

    import hypercli.config as config

    monkeypatch.setattr(config, "CONFIG_FILE", config_path)
    config.configure("new_key", api_url="https://api.dev.hypercli.com")

    written = dict(
        line.split("=", 1)
        for line in config_path.read_text().splitlines()
        if line and "=" in line
    )
    assert written == {
        "UNRELATED_KEY": "keepme",
        "HYPER_API_KEY": "new_key",
        "HYPER_API_BASE": "https://api.dev.hypercli.com",
        "HYPER_AGENTS_API_BASE": "https://control.example/prefix",
    }


def test_hyper_home_tilde_is_used_verbatim(monkeypatch):
    """HYPER_HOME is not tilde-expanded: matches ts-cli `cliConfigDir` and
    rs-sdk `config_dir_from_home`, which treat the value as a literal path."""
    monkeypatch.setenv("HYPER_HOME", "~/hyper-tilde-test")

    import hypercli.config as config

    importlib.reload(config)

    assert config.config_file() == Path("~/hyper-tilde-test/config")
