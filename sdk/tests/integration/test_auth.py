from __future__ import annotations

EXPECTED_TEST_EMAIL = "agent@nedos.io"


def test_auth_identity(client):
    user = client.user.get()

    assert user.user_id
    assert user.email == EXPECTED_TEST_EMAIL
    assert user.is_active is True
    assert user.created_at
