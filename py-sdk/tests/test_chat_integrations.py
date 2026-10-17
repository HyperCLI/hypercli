import json
from pathlib import Path

import pytest

from hypercli import build_chat_integration_config

FIXTURES = json.loads((Path(__file__).parents[2] / "tests/fixtures/chat-integrations.json").read_text())


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
