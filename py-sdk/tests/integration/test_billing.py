from __future__ import annotations


def test_balance(client):
    balance = client.billing.balance()

    assert float(balance.total) >= 0
    assert float(balance.available) >= 0
    assert float(balance.rewards) >= 0
    assert float(balance.paid) >= 0
