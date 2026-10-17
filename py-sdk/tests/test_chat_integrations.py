import json
from pathlib import Path

import pytest

from hypercli import build_chat_integration_config

FIXTURES = json.loads((Path(__file__).parents[2] / "tests/fixtures/chat-integrations.json").read_text())


@pytest.mark.parametrize("integration", ["buzz", "teams", "telegram"])
@pytest.mark.parametrize("valid,authority", [
    (valid, authority) for valid in (True, False)
    for authority in FIXTURES["urlAuthorities"]["valid" if valid else "invalid"]
])
def test_url_authorities(integration, valid, authority):
    template = next(case for case in FIXTURES["valid"] if case["integration"] == integration
                    and (integration != "telegram" or case["values"].get("TELEGRAM_MODE") == "webhook"))
    values = dict(template["values"])
    url = f"{'wss' if integration == 'buzz' else 'https'}://{authority}/"
    key = {"buzz": "BUZZ_RELAY_URL", "teams": "TEAMS_TRUSTED_SERVICE_BASES", "telegram": "TELEGRAM_WEBHOOK_URL"}[integration]
    values[key] = json.dumps([url]) if integration == "teams" else url
    if valid:
        build_chat_integration_config(integration, values)
    else:
        with pytest.raises(ValueError):
            build_chat_integration_config(integration, values)


@pytest.mark.parametrize("case", FIXTURES["valid"], ids=lambda case: case["name"])
def test_launch_maps(case):
    values = dict(case["values"])
    assert build_chat_integration_config(case["integration"], values) == case["expected"]
    assert values == case["values"]


@pytest.mark.parametrize("case", FIXTURES["invalid"], ids=lambda case: case["name"])
def test_rejected_without_credential_disclosure(case):
    with pytest.raises(ValueError) as error:
        build_chat_integration_config(case["integration"], case["values"])
    assert "synthetic-private" not in str(error.value)
