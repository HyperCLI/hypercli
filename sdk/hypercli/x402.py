"""x402 payment helpers for pay-per-use job and render launches."""
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

import httpx

from .config import get_api_url
from .http import APIError
from .jobs import Job
from .renders import Render


@dataclass
class X402JobLaunch:
    """Response payload for x402 job launch."""

    job: Job
    access_key: str
    status_url: str
    logs_url: str
    cancel_url: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "X402JobLaunch":
        return cls(
            job=Job.from_dict(data.get("job", {})),
            access_key=data.get("access_key", ""),
            status_url=data.get("status_url", ""),
            logs_url=data.get("logs_url", ""),
            cancel_url=data.get("cancel_url", ""),
        )


@dataclass
class X402RenderCreate:
    """Response payload for x402 render creation."""

    render: Render
    access_key: str
    status_url: str
    cancel_url: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "X402RenderCreate":
        return cls(
            render=Render.from_dict(data.get("render", {})),
            access_key=data.get("access_key", ""),
            status_url=data.get("status_url", ""),
            cancel_url=data.get("cancel_url", ""),
        )


def _require_x402_deps():
    try:
        from x402 import x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact.register import register_exact_evm_client
        return x402ClientSync, x402HTTPClientSync, EthAccountSigner, register_exact_evm_client
    except ImportError as exc:
        raise RuntimeError(
            "x402 dependencies missing. Install with: pip install 'x402[httpx,evm]' eth-account"
        ) from exc


def _error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            return str(data.get("detail") or data.get("message") or data)
        return str(data)
    except Exception:
        return response.text


def _x402_post(
    base_url: str,
    path: str,
    payload: dict[str, Any],
    account: Any,
    timeout: float,
) -> dict[str, Any]:
    x402ClientSync, x402HTTPClientSync, EthAccountSigner, register_exact_evm_client = _require_x402_deps()

    signer = EthAccountSigner(account)
    x402_client = x402ClientSync()
    register_exact_evm_client(x402_client, signer)
    http_client = x402HTTPClientSync(x402_client)

    endpoint = f"{base_url.rstrip('/')}{path}"
    headers = {"Content-Type": "application/json"}

    with httpx.Client(timeout=timeout) as client:
        response = client.post(endpoint, headers=headers, json=payload)

        if response.status_code == 402:
            payment_headers, _ = http_client.handle_402_response(dict(response.headers), response.content)
            retry_headers = {**headers, **payment_headers}
            retry_headers["Access-Control-Expose-Headers"] = "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE"
            response = client.post(endpoint, headers=retry_headers, json=payload)

    if response.status_code >= 400:
        raise APIError(response.status_code, _error_detail(response))

    data = response.json()
    if not isinstance(data, dict):
        raise APIError(response.status_code, "Malformed API response")
    return data


class X402Client:
    """x402 pay-per-use client for launching jobs and renders without a full API account."""

    def __init__(self, api_url: str | None = None, timeout: float = 30.0):
        self.api_url = (api_url or get_api_url()).rstrip("/")
        self.timeout = timeout

    def create_job(
        self,
        *,
        amount: float,
        account: Any,
        image: str,
        command: str | None = None,
        gpu_type: str = "l40s",
        gpu_count: int = 1,
        region: str | None = None,
        interruptible: bool = True,
        env: dict[str, str] | None = None,
        ports: dict[str, int] | None = None,
        auth: bool = False,
        registry_auth: dict[str, str] | None = None,
    ) -> X402JobLaunch:
        if amount <= 0:
            raise ValueError("amount must be greater than 0")

        job_payload: dict[str, Any] = {
            "docker_image": image,
            "gpu_type": gpu_type,
            "gpu_count": gpu_count,
            "interruptible": interruptible,
            "command": base64.b64encode((command or "").encode()).decode(),
        }
        if region:
            job_payload["region"] = region
        if env:
            job_payload["env_vars"] = env
        if ports:
            job_payload["ports"] = ports
        if auth:
            job_payload["auth"] = auth
        if registry_auth:
            job_payload["registry_auth"] = registry_auth

        payload = {"amount": amount, "job": job_payload}
        data = _x402_post(self.api_url, "/api/x402/job", payload, account, self.timeout)
        return X402JobLaunch.from_dict(data)

    def create_render(
        self,
        *,
        amount: float,
        account: Any,
        params: dict[str, Any],
        render_type: str = "comfyui",
        notify_url: str | None = None,
    ) -> X402RenderCreate:
        if amount <= 0:
            raise ValueError("amount must be greater than 0")

        render_payload: dict[str, Any] = {
            "type": render_type,
            "params": params,
        }
        if notify_url:
            render_payload["notify_url"] = notify_url

        payload = {"amount": amount, "render": render_payload}
        data = _x402_post(self.api_url, "/api/x402/render", payload, account, self.timeout)
        return X402RenderCreate.from_dict(data)
