from dataclasses import asdict
from unittest.mock import Mock

import httpx
import pytest

from hypercli.files import File, Files
from hypercli.http import APIError, _handle_response
from hypercli.renders import Render


def test_arbitrary_upload_and_result_metadata(tmp_path):
    path = tmp_path / "analysis (1).unknownext"
    path.write_bytes(b"\xff\x00")
    link = "https://storage.example/download?signature=fixture"
    wire = dict(id="f", filename=path.name, url="s3://raw", file_size=2,
                download_url=link, expires_at="2027-01-01T00:00:00Z")
    http = Mock()
    http.post_multipart.return_value = wire
    file = Files(http).upload(str(path))
    http.post_multipart.assert_called_once_with(
        "/api/files/multi", files={"file": (path.name, b"\xff\x00", "application/octet-stream")}
    )
    for key, value in wire.items():
        assert asdict(file)[key] == value
    assert link not in repr(file)
    render = Render.from_dict({"result_url": "legacy", "result_file_id": file.id})
    assert (render.result_url, render.result_file_id) == ("legacy", "f")


def test_processing_metadata_and_legacy_defaults():
    fields = dict(filename=None, url=None, content_type=None, file_size=None, download_url=None)
    pending = asdict(File.from_dict(dict(state="processing", **fields)))
    assert all(pending[key] is None for key in fields)
    assert File.from_dict({"file_size": 0}).file_size == 0
    assert Render.from_dict({}).result_file_id is None


def test_file_error_does_not_log_response_secrets(caplog):
    request = httpx.Request("POST", "https://api.example/api/files/url")
    response = httpx.Response(422, request=request, json={"detail": "https://storage.example/?sig=private"})
    with pytest.raises(APIError):
        _handle_response(response)
    assert "422" in caplog.text
    assert "private" not in caplog.text
