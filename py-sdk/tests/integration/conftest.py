from __future__ import annotations

import os
from pathlib import Path

import pytest

from hypercli import HyperCLI

EXPECTED_TEST_EMAIL = os.getenv("EXPECTED_TEST_EMAIL", "agent@hypercli.com").strip()


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Keep every test in this live-service directory behind the integration marker."""
    root = Path(__file__).resolve().parent
    for item in items:
        if item.path.resolve().is_relative_to(root):
            item.add_marker(pytest.mark.integration)


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@pytest.fixture(scope="session")
def test_api_key() -> str:
    value = _env("TEST_API_KEY")
    if not value:
        pytest.skip("TEST_API_KEY not set")
    return value


@pytest.fixture(scope="session")
def test_api_base() -> str:
    return _env("TEST_API_BASE", "https://api.hypercli.com")


@pytest.fixture(scope="session")
def test_agent_api_key() -> str:
    return _env("TEST_AGENT_API_KEY")


@pytest.fixture(scope="session")
def client(test_api_key: str, test_api_base: str, test_agent_api_key: str) -> HyperCLI:
    return HyperCLI(
        api_key=test_api_key,
        api_url=test_api_base,
        agent_api_key=test_agent_api_key or None,
    )
