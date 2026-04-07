from __future__ import annotations

import uuid

import pytest

from hypercli import HyperCLI
from hypercli.http import APIError


def _resolve_available_agent_tier(client: HyperCLI) -> str:
    summary = client.agent.subscription_summary()
    for tier in ("large", "medium", "small"):
        inventory = (summary.slot_inventory or {}).get(tier) or {}
        if int(inventory.get("available", 0) or 0) > 0:
            return tier
    raise AssertionError("No available entitlement slots for integration agent tests")


def test_list_agents_requires_agent_key(client, test_agent_api_key: str):
    if not test_agent_api_key:
        pytest.skip(
            "TEST_AGENT_API_KEY not set; the deployments and agent APIs do not accept the account-level TEST_API_KEY"
        )

    result = client.deployments.list()
    assert isinstance(result, list)


def test_exact_agent_child_key_is_scoped_to_one_agent(client, test_api_base: str, test_agent_api_key: str):
    if not test_agent_api_key:
        pytest.skip(
            "TEST_AGENT_API_KEY not set; the deployments and agent APIs do not accept the account-level TEST_API_KEY"
        )

    tier = _resolve_available_agent_tier(client)
    agent_a = client.deployments.create(
        name=f"sdk-scope-{uuid.uuid4().hex[:8]}",
        size=tier,
        start=False,
        tags=["team=dev", "suite=sdk-integration"],
    )
    agent_b = client.deployments.create(
        name=f"sdk-scope-{uuid.uuid4().hex[:8]}",
        size=tier,
        start=False,
        tags=["team=ops", "suite=sdk-integration"],
    )

    try:
        child = client.deployments.create_scoped_key(agent_a.id, name="sdk-scoped-child")
        scoped = HyperCLI(
            api_key=client.api_key,
            api_url=test_api_base,
            agent_api_key=child["api_key"],
        )

        visible = scoped.deployments.list()
        visible_ids = {item.id for item in visible}
        assert agent_a.id in visible_ids
        assert agent_b.id not in visible_ids

        resolved = scoped.deployments.get(agent_a.id)
        assert resolved.id == agent_a.id

        with pytest.raises(APIError) as missing_exc:
            scoped.deployments.get(agent_b.id)
        assert missing_exc.value.status_code == 404

        dry_started = scoped.deployments.start_openclaw(agent_a.id, dry_run=True)
        assert dry_started.id == agent_a.id
        assert getattr(dry_started, "dry_run", False) is True

        with pytest.raises(APIError) as create_exc:
            scoped.deployments.create(
                name=f"sdk-scope-{uuid.uuid4().hex[:8]}",
                size=tier,
                start=False,
            )
        assert create_exc.value.status_code == 403
    finally:
        client.deployments.delete(agent_a.id)
        client.deployments.delete(agent_b.id)
