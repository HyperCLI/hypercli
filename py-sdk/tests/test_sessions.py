from unittest.mock import MagicMock

import pytest

from hypercli.agents import Deployments
from hypercli.http import HTTPClient
from hypercli.sessions import SessionRecord


@pytest.mark.parametrize("source", [None, "slack", "future-client"])
def test_catalog_decodes_source_and_keeps_pagination(source):
    http = MagicMock(spec=HTTPClient)
    http.api_key = "test"
    api = Deployments(http, api_base="https://example.com/agents")
    api._get = MagicMock(return_value={
        "items": [{"id": "session", "source": source, "summary_text": "My title"}],
        "next_cursor": "opaque", "has_more": True,
    })
    page = api.list_sessions(agent_id="agent", cursor="previous", limit=20)
    api._get.assert_called_once_with("/sessions", params={"agent_id": "agent", "cursor": "previous", "limit": 20})
    assert page.items[0].source == source
    assert page.items[0].summary_text == "My title"
    assert page.next_cursor == "opaque"
    assert page.has_more is True


def test_old_server_missing_source_is_null():
    assert SessionRecord.from_dict({"id": "old-session"}).source is None
