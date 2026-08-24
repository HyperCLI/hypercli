from hypercli.models import ModelsAPI


class DummyHTTP:
    def __init__(self):
        self.calls = []

    def get(self, path):
        self.calls.append(("get", path, None))
        assert path == "/v1/models"
        return {
            "object": "list",
            "data": [
                {"id": "kimi-k3", "object": "model", "owned_by": "hypercli"},
                {"id": "kimi-k2.6", "object": "model", "owned_by": "hypercli"},
            ],
        }


def test_models_list_reads_openai_models_payload():
    http = DummyHTTP()
    models = ModelsAPI(http)

    listed = models.list()

    assert [model.id for model in listed] == ["kimi-k3", "kimi-k2.6"]
    assert http.calls == [("get", "/v1/models", None)]
