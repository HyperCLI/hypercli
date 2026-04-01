from __future__ import annotations

import os


def test_auth_identity(client):
    user = client.user.get()
    expected_email = os.getenv("EXPECTED_TEST_EMAIL", "agent@nedos.io").strip()

    assert user.user_id
    assert user.email == expected_email
    assert user.is_active is True
    assert user.created_at
