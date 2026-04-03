import logging

import httpx

from hypercli.http import APIError, _handle_response


def test_handle_response_logs_and_raises_api_error(caplog) -> None:
    request = httpx.Request("GET", "https://api.hypercli.com/api/jobs?tag=service%3Dgpu-operator")
    response = httpx.Response(
        500,
        request=request,
        text='{"detail":"TagValidationError: Invalid tag \\"hypercall_image=vllm/vllm-openai:v0.18.0-cu130\\""}',
    )

    caplog.set_level(logging.ERROR)

    try:
        _handle_response(response)
    except APIError as exc:
        assert exc.status_code == 500
        assert exc.method == "GET"
        assert exc.url == "https://api.hypercli.com/api/jobs?tag=service%3Dgpu-operator"
        assert "TagValidationError" in exc.detail
        assert "hypercall_image" in (exc.response_text or "")
    else:
        raise AssertionError("Expected APIError")

    assert "HyperCLI API request failed" in caplog.text
    assert "https://api.hypercli.com/api/jobs?tag=service%3Dgpu-operator" in caplog.text
    assert "TagValidationError" in caplog.text
