"""HTTP client utilities"""
import time
import httpx
import logging
from typing import Any, Optional, Iterator, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def request_with_retry(
    method: str,
    url: str,
    headers: dict = None,
    retries: int = 3,
    backoff: float = 1.0,
    timeout: float = 30.0,
    **kwargs,
) -> httpx.Response:
    """Make an HTTP request with retry logic for transient errors.

    Args:
        method: HTTP method (get, post, etc.)
        url: Full URL to request
        headers: Request headers
        retries: Number of retry attempts
        backoff: Backoff multiplier between retries
        timeout: Request timeout in seconds
        **kwargs: Additional args passed to httpx (json, params, etc.)

    Returns:
        httpx.Response

    Raises:
        Last exception if all retries fail
    """
    last_error = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = getattr(client, method)(url, headers=headers, **kwargs)
                return resp
        except (httpx.ProxyError, httpx.ConnectError, httpx.ReadTimeout) as e:
            last_error = e
            if attempt < retries - 1:
                time.sleep(backoff * (attempt + 1))
                continue
            raise
    raise last_error


@dataclass
class APIError(Exception):
    """API error with status code and detail"""
    status_code: int
    detail: str
    method: str | None = None
    url: str | None = None
    response_text: str | None = None

    def __str__(self):
        context = []
        if self.method:
            context.append(self.method)
        if self.url:
            context.append(self.url)
        prefix = f" ({' '.join(context)})" if context else ""
        return f"API Error {self.status_code}{prefix}: {self.detail}"


def _truncate_for_log(value: str, limit: int = 1000) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "...<truncated>"


def _handle_response(response: httpx.Response) -> Any:
    """Handle API response, raise on error"""
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except Exception:
            detail = response.text
        body = response.text or ""
        method = response.request.method if response.request else None
        url = str(response.request.url) if response.request else None
        logger.error(
            "HyperCLI API request failed: method=%s url=%s status=%s detail=%r body=%r",
            method,
            url,
            response.status_code,
            detail,
            _truncate_for_log(body),
        )
        raise APIError(
            response.status_code,
            detail,
            method=method,
            url=url,
            response_text=body,
        )
    if response.status_code == 204:
        return None
    return response.json()


class HTTPClient:
    """Sync HTTP client"""

    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        # Some higher-level SDK surfaces still expect a requests/httpx-style session.
        self._session = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._session.close()

    @property
    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def get(self, path: str, params: dict = None) -> Any:
        resp = request_with_retry(
            "get", f"{self.base_url}{path}",
            headers=self.headers, timeout=self.timeout, params=params
        )
        return _handle_response(resp)

    def post(self, path: str, json: dict = None) -> Any:
        resp = request_with_retry(
            "post", f"{self.base_url}{path}",
            headers=self.headers, timeout=self.timeout, json=json
        )
        return _handle_response(resp)

    def patch(self, path: str, json: dict = None) -> Any:
        resp = request_with_retry(
            "patch", f"{self.base_url}{path}",
            headers=self.headers, timeout=self.timeout, json=json
        )
        return _handle_response(resp)

    def delete(self, path: str) -> Any:
        resp = request_with_retry(
            "delete", f"{self.base_url}{path}",
            headers=self.headers, timeout=self.timeout
        )
        return _handle_response(resp)

    def stream_post(self, path: str, json: dict) -> Iterator[str]:
        """Streaming POST for SSE responses"""
        with httpx.Client(timeout=None) as client:
            with client.stream(
                "POST",
                f"{self.base_url}{path}",
                headers=self.headers,
                json=json,
            ) as response:
                if response.status_code >= 400:
                    raise APIError(response.status_code, response.read().decode())
                for line in response.iter_lines():
                    yield line

    def post_multipart(self, path: str, files: dict) -> Any:
        """POST with multipart form data for file uploads.

        Args:
            path: API path
            files: Dict of {field_name: file_tuple} where file_tuple is
                   (filename, file_bytes, content_type) or just file_bytes
        """
        # Build headers without Content-Type (httpx sets it for multipart)
        headers = {"Authorization": f"Bearer {self.api_key}"}

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                f"{self.base_url}{path}",
                headers=headers,
                files=files,
            )
            return _handle_response(response)


class AsyncHTTPClient:
    """Async HTTP client for use in async contexts (e.g., Telegram bot, web servers)"""

    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    @property
    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def get(self, path: str, params: dict = None) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}{path}",
                headers=self.headers,
                params=params,
            )
            return _handle_response(response)

    async def post(self, path: str, json: dict = None) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}{path}",
                headers=self.headers,
                json=json,
            )
            return _handle_response(response)

    async def patch(self, path: str, json: dict = None) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.patch(
                f"{self.base_url}{path}",
                headers=self.headers,
                json=json,
            )
            return _handle_response(response)

    async def delete(self, path: str) -> Any:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.delete(
                f"{self.base_url}{path}",
                headers=self.headers,
            )
            return _handle_response(response)

    async def post_multipart(self, path: str, files: dict, params: dict = None) -> Any:
        """POST with multipart form data for file uploads.

        Args:
            path: API path
            files: Dict of {field_name: file_tuple} where file_tuple is
                   (filename, file_bytes, content_type) or just file_bytes
            params: Optional query parameters
        """
        headers = {"Authorization": f"Bearer {self.api_key}"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}{path}",
                headers=headers,
                files=files,
                params=params,
            )
            return _handle_response(response)
