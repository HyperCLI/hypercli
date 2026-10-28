from hypercli.renders import Renders


def test_catalog_transport_and_submission_preserve_upstream_input_names():
    for subscription in (False, True):
        class HTTP:
            calls = []

            def get(self, path):
                self.calls.append(("GET", path))
                if path == "/api/auth/me":
                    return {"capabilities": ["flows:*"] if subscription else []}
                return {"qwen21": {"templates": {"sample": {"inputs": {}}}}}

            def post(self, path, json):
                self.calls.append(("POST", path, json))
                return {"id": "render-1", "state": "pending"}

        http = HTTP()
        renders = Renders(http)
        assert "qwen21" in renders.catalog()
        assert http.calls[-1][1] == ("/agents/flow/catalog" if subscription else "/api/renders/catalog")
        values = {"seed": 0, "switch": False, "images.image_5_1": {"file_id": "owned"}}
        renders.submit("qwen21", "sample", values)
        _, path, payload = http.calls[-1]
        assert path == ("/agents/flow/catalog" if subscription else "/api/renders")
        assert (payload if subscription else payload["params"]) == {"family": "qwen21", "template": "sample", "inputs": values}
