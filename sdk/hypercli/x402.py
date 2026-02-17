"""x402 payment helpers for pay-per-use job and flow launches."""
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
class X402FlowCreate:
    """Response payload for x402 flow render creation."""

    render: Render
    access_key: str
    status_url: str
    cancel_url: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "X402FlowCreate":
        return cls(
            render=Render.from_dict(data.get("render", {})),
            access_key=data.get("access_key", ""),
            status_url=data.get("status_url", ""),
            cancel_url=data.get("cancel_url", ""),
        )


@dataclass
class FlowCatalogItem:
    """Public flow catalog entry."""

    flow_type: str
    price_usd: float
    template: str | None = None
    type: str = "comfyui"
    regions: dict[str, str] | None = None
    interruptible: bool | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FlowCatalogItem":
        flow_type = str(data.get("flow_type") or data.get("name") or "")
        return cls(
            flow_type=flow_type,
            price_usd=float(data.get("price_usd", 0)),
            template=data.get("template"),
            type=str(data.get("type", "comfyui")),
            regions=data.get("regions") if isinstance(data.get("regions"), dict) else {},
            interruptible=data.get("interruptible"),
        )


# Backward-compat alias. Raw x402 render endpoint was replaced by flow endpoints.
X402RenderCreate = X402FlowCreate


def _require_x402_deps():
    try:
        from x402 import x402ClientSync
        from x402.http import x402HTTPClientSync
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact.register import register_exact_evm_client
        return x402ClientSync, x402HTTPClientSync, EthAccountSigner, register_exact_evm_client
    except ImportError as exc:
        raise RuntimeError(
            "x402 dependencies missing. Install with: pip install x402[httpx,evm] eth-account"
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


def _json_get(base_url: str, path: str, timeout: float) -> Any:
    endpoint = f"{base_url.rstrip('/')}{path}"
    with httpx.Client(timeout=timeout) as client:
        response = client.get(endpoint)
    if response.status_code >= 400:
        raise APIError(response.status_code, _error_detail(response))
    return response.json()


class X402Client:
    """x402 pay-per-use client for launching jobs and flow renders without a full API account."""

    def __init__(self, api_url: str | None = None, timeout: float = 30.0):
        self.api_url = (api_url or get_api_url()).rstrip("/")
        self.timeout = timeout

    def get_flow_catalog(self) -> list[FlowCatalogItem]:
        data = _json_get(self.api_url, "/flows", self.timeout)

        rows: list[dict[str, Any]] = []
        if isinstance(data, list):
            # Backward compatibility with old /api/flow/public response shape
            rows = [row for row in data if isinstance(row, dict)]
        elif isinstance(data, dict):
            flows = data.get("flows")
            if isinstance(flows, list):
                rows = [row for row in flows if isinstance(row, dict)]

        if not rows:
            raise APIError(500, "Malformed flow catalog response")

        expanded_rows: list[dict[str, Any]] = []
        for row in rows:
            flow_name = str(row.get("flow_type") or row.get("name") or "")
            if not flow_name:
                continue

            has_details = any(k in row for k in ("template", "regions", "type"))
            if has_details:
                expanded_rows.append(row)
                continue

            flow_path = row.get("path")
            if not isinstance(flow_path, str) or not flow_path:
                flow_path = f"/flows/{flow_name}"

            try:
                detail = _json_get(self.api_url, flow_path, self.timeout)
            except APIError:
                detail = {}

            if isinstance(detail, dict):
                # Preserve index price/path while augmenting with detail fields.
                merged = {**detail, **row}
                expanded_rows.append(merged)
            else:
                expanded_rows.append(row)

        items = [FlowCatalogItem.from_dict(row) for row in expanded_rows]
        return [item for item in items if item.flow_type]

    def get_flow_price(self, flow_type: str) -> float:
        if not flow_type:
            raise ValueError("flow_type is required")
        for item in self.get_flow_catalog():
            if item.flow_type == flow_type:
                if item.price_usd <= 0:
                    raise APIError(500, f"Flow {flow_type} has invalid configured price")
                return item.price_usd
        raise APIError(404, f"Flow {flow_type} not found in flow catalog")

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

    def create_flow(
        self,
        *,
        flow_type: str,
        amount: float,
        account: Any,
        params: dict[str, Any] | None = None,
        notify_url: str | None = None,
    ) -> X402FlowCreate:
        if amount <= 0:
            raise ValueError("amount must be greater than 0")
        if not flow_type:
            raise ValueError("flow_type is required")

        payload: dict[str, Any] = dict(params or {})
        if notify_url:
            payload["notify_url"] = notify_url

        data = _x402_post(self.api_url, f"/api/x402/flow/{flow_type}", payload, account, self.timeout)
        return X402FlowCreate.from_dict(data)

    def create_render(
        self,
        *,
        amount: float,
        account: Any,
        params: dict[str, Any],
        render_type: str = "comfyui",
        notify_url: str | None = None,
    ) -> X402RenderCreate:
        del amount, account, params, render_type, notify_url
        raise RuntimeError(
            "x402 render endpoint has been removed. Use create_flow(flow_type=..., amount=..., params=...) instead."
        )
