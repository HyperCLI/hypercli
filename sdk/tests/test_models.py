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
                {"id": "glm-5", "object": "model", "owned_by": "hypercli"},
                {"id": "kimi-k2.5", "object": "model", "owned_by": "hypercli"},
            ],
        }


def test_models_list_reads_openai_models_payload():
    http = DummyHTTP()
    models = ModelsAPI(http)

    listed = models.list()

    assert [model.id for model in listed] == ["glm-5", "kimi-k2.5"]
    assert http.calls == [("get", "/v1/models", None)]
