from __future__ import annotations

import pytest


def test_list_agents_requires_agent_key(client, test_agent_api_key: str):
    if not test_agent_api_key:
        pytest.skip(
            "TEST_AGENT_API_KEY not set; the deployments and agent APIs do not accept the account-level TEST_API_KEY"
        )

    result = client.deployments.list()
    assert isinstance(result, list)
