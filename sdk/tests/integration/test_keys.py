import uuid

import pytest

from hypercli import HyperCLI
from hypercli.http import APIError


def test_list_keys(client, test_api_key: str):
    keys = client.keys.list()
    expected_last4 = test_api_key[-4:]

    assert keys
    matching = next((key for key in keys if key.last4 == expected_last4), None)
    assert matching is not None
    assert matching.key_id
    assert matching.name
    assert matching.api_key is None
    assert matching.api_key_preview
    assert matching.is_active is True


def test_create_and_disable_tagged_key(client):
    name = f"sdk-integration-{uuid.uuid4().hex[:8]}"
    created = client.keys.create(name=name, tags=["jobs:self", "team=integration"])

    assert created.name == name
    assert created.api_key
    assert "jobs:self" in created.tags
    assert "team=integration" in created.tags

    listed = client.keys.get(created.key_id)
    assert listed.name == name
    assert "jobs:self" in listed.tags
    assert listed.api_key is None

    disabled = client.keys.disable(created.key_id)
    assert disabled["status"] == "deactivated"


def test_created_key_authenticates_against_models_api(client, test_api_base: str):
    name = f"sdk-models-scope-{uuid.uuid4().hex[:8]}"
    created = client.keys.create(name=name, tags=["models:*"])

    try:
        scoped = HyperCLI(api_key=created.api_key, api_url=test_api_base)
        models = scoped.models.list()
        assert models
        assert all(model.id for model in models)
    finally:
        client.keys.disable(created.key_id)


def test_api_scoped_key_allows_key_admin_but_denies_profile(client, test_api_base: str):
    name = f"sdk-api-scope-{uuid.uuid4().hex[:8]}"
    created = client.keys.create(name=name, tags=["api:self"])

    try:
        scoped = HyperCLI(api_key=created.api_key, api_url=test_api_base)
        listed = scoped.keys.list()
        assert any(item.key_id == created.key_id for item in listed)

        with pytest.raises(APIError) as exc:
            scoped.user.get()
        assert exc.value.status_code == 403
    finally:
        client.keys.disable(created.key_id)


def test_user_scoped_key_allows_profile_but_denies_key_admin(client, test_api_base: str):
    name = f"sdk-user-scope-{uuid.uuid4().hex[:8]}"
    created = client.keys.create(name=name, tags=["user:self"])

    try:
        scoped = HyperCLI(api_key=created.api_key, api_url=test_api_base)
        profile = scoped.user.get()
        assert profile.user_id

        with pytest.raises(APIError) as exc:
            scoped.keys.list()
        assert exc.value.status_code == 403
    finally:
        client.keys.disable(created.key_id)
