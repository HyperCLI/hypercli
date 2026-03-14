from __future__ import annotations

import os

import pytest

from hypercli import HyperCLI


EXPECTED_TEST_EMAIL = "agent@nedos.io"


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
