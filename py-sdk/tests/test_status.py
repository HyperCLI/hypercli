from hypercli import HyperCLI


def test_client_status_calls_public_status_endpoint(monkeypatch):
    monkeypatch.setenv("HYPER_API_KEY", "hyper_api_test")
    observed = {}

    class FakeHTTP:
        def get(self, path):
            observed["path"] = path
            return {
                "ok": False,
                "checked_at": "2026-06-16T10:00:00Z",
                "models": {"qwen3-tts": True},
                "clusters": {"large": False},
            }

    client = HyperCLI(api_key="hyper_api_test", api_url="https://api.example.com")
    client._agents_http = FakeHTTP()

    assert client.status() == {
        "ok": False,
        "checked_at": "2026-06-16T10:00:00Z",
        "models": {"qwen3-tts": True},
        "clusters": {"large": False},
    }
    assert observed["path"] == "/status"
