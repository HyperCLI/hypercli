from __future__ import annotations


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
