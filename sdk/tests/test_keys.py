from hypercli.keys import KeysAPI


class DummyHTTP:
    def __init__(self):
        self.calls = []

    def post(self, path, json=None):
        self.calls.append(("post", path, json))
        return {
            "key_id": "key-123",
            "name": json["name"],
            "tags": list(json.get("tags") or []),
            "api_key": "hyper_api_live",
            "is_active": True,
            "created_at": "2026-04-02T00:00:00Z",
            "last_used_at": None,
        }

    def get(self, path):
        self.calls.append(("get", path, None))
        if path == "/api/keys":
            return [{
                "key_id": "key-123",
                "name": "team-dev",
                "tags": ["jobs:self"],
                "api_key_preview": "hyper_api_abcd****1234",
                "last4": "1234",
                "is_active": True,
                "created_at": "2026-04-02T00:00:00Z",
                "last_used_at": "2026-04-02T01:00:00Z",
            }]
        return {
            "key_id": "key-123",
            "name": "team-dev",
            "tags": ["jobs:self"],
            "api_key_preview": "hyper_api_abcd****1234",
            "last4": "1234",
            "is_active": True,
            "created_at": "2026-04-02T00:00:00Z",
            "last_used_at": "2026-04-02T01:00:00Z",
        }

    def patch(self, path, json=None):
        self.calls.append(("patch", path, json))
        return {
            "key_id": "key-123",
            "name": json["name"],
            "tags": ["jobs:self"],
            "api_key_preview": "hyper_api_abcd****1234",
            "last4": "1234",
            "is_active": True,
            "created_at": "2026-04-02T00:00:00Z",
            "last_used_at": "2026-04-02T01:00:00Z",
        }

    def delete(self, path):
        self.calls.append(("delete", path, None))
        return {"status": "deactivated", "key_id": "key-123"}


def test_keys_create_includes_tags():
    http = DummyHTTP()
    keys = KeysAPI(http)

    created = keys.create(name="team-dev", tags=["jobs:self", "team=dev"])

    assert created.name == "team-dev"
    assert created.tags == ["jobs:self", "team=dev"]
    assert created.api_key == "hyper_api_live"
    assert http.calls[0] == ("post", "/api/keys", {"name": "team-dev", "tags": ["jobs:self", "team=dev"]})


def test_keys_list_returns_masked_records():
    http = DummyHTTP()
    keys = KeysAPI(http)

    listed = keys.list()

    assert len(listed) == 1
    assert listed[0].api_key is None
    assert listed[0].api_key_preview == "hyper_api_abcd****1234"
    assert listed[0].tags == ["jobs:self"]


def test_keys_get_and_rename():
    http = DummyHTTP()
    keys = KeysAPI(http)

    fetched = keys.get("key-123")
    renamed = keys.rename("key-123", "team-ops")

    assert fetched.name == "team-dev"
    assert renamed.name == "team-ops"
    assert http.calls[1] == ("patch", "/api/keys/key-123", {"name": "team-ops"})


def test_keys_disable():
    http = DummyHTTP()
    keys = KeysAPI(http)

    result = keys.disable("key-123")

    assert result["status"] == "deactivated"
    assert http.calls[0] == ("delete", "/api/keys/key-123", None)
