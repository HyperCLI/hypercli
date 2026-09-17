"""Tests for backend parity fixes (flow helpers, x402 payloads, transports)."""
import base64
import json
from datetime import datetime, timezone
from unittest.mock import Mock

import pytest

from hypercli.agents import Deployments
from hypercli.billing import Billing
from hypercli.keys import ApiKey
from hypercli.renders import Renders
from hypercli.user import AuthMe, RuntimeIdentity, UserAPI
from hypercli.workspaces import WorkspacesAPI
from hypercli.x402 import X402Client


class DummyHTTP:
    def __init__(self):
        self.calls = []
        self.auth_me = {"auth_type": "user", "capabilities": [], "has_active_subscription": True}

    def get(self, path, params=None):
        self.calls.append(("get", path, params))
        if path == "/api/auth/me":
            return self.auth_me
        return {"id": "render-123", "state": "queued"}

    def post(self, path, json=None):
        self.calls.append(("post", path, json))
        return {"id": "render-123", "state": "queued"}

    def patch(self, path, json=None):
        self.calls.append(("patch", path, json))
        return {"user_id": "user-1"}

    def delete(self, path):
        self.calls.append(("delete", path, None))
        return {"status": "cancelled"}


def make_renders():
    http = DummyHTTP()
    http.auth_me = {"auth_type": "api_key", "capabilities": [], "has_active_subscription": False}
    return Renders(http), http


def test_audio_to_text_routes_through_flow_transport():
    renders, http = make_renders()

    render = renders.audio_to_text(audio_url="https://example.com/a.mp3", file_ids=None)

    assert render.render_id == "render-123"
    assert ("post", "/api/flow/audio-to-text", {"audio_url": "https://example.com/a.mp3"}) in http.calls


def test_text_to_speech_routes_through_flow_transport():
    renders, http = make_renders()

    render = renders.text_to_speech("hello", mode="design", voice_description="warm")

    assert render.render_id == "render-123"
    post = next(c for c in http.calls if c[0] == "post")
    assert post[1] == "/api/flow/text-to-speech"
    assert post[2]["text"] == "hello"
    assert post[2]["mode"] == "design"
    assert post[2]["voice_description"] == "warm"


def test_audio_to_text_uses_subscription_route_when_supported():
    renders, http = make_renders()
    http.auth_me = {
        "auth_type": "orchestra_key",
        "capabilities": ["flows:*"],
        "has_active_subscription": True,
    }

    renders.audio_to_text(audio_url="https://example.com/a.mp3")

    assert ("post", "/agents/flow/audio-to-text", {"audio_url": "https://example.com/a.mp3"}) in http.calls


def test_speaking_video_wan_removed():
    assert not hasattr(Renders, "speaking_video_wan")


def test_x402_create_job_posts_flat_job_create_request(monkeypatch):
    captured = {}

    def fake_x402_post(base_url, path, payload, account, timeout):
        captured["base_url"] = base_url
        captured["path"] = path
        captured["payload"] = payload
        return {
            "job": {"job_id": "job-1", "state": "pending"},
            "access_key": "ak-1",
            "status_url": "https://x/status",
            "logs_url": "https://x/logs",
            "cancel_url": "https://x/cancel",
        }

    monkeypatch.setattr("hypercli.x402._x402_post", fake_x402_post)
    client = X402Client(api_url="https://api.test")
    launch = client.create_job(
        amount=1.5,
        account=object(),
        image="img:latest",
        command="echo hi",
        gpu_type="l40s",
        gpu_count=2,
        env={"A": "1"},
        region="va",
    )

    assert launch.job.job_id == "job-1"
    assert captured["path"] == "/api/x402/job"
    payload = captured["payload"]
    assert "job" not in payload
    assert payload["docker_image"] == "img:latest"
    assert payload["gpu_type"] == "l40s"
    assert payload["gpu_count"] == 2
    assert payload["env_vars"] == {"A": "1"}
    assert payload["region"] == "va"
    assert base64.b64decode(payload["command"]).decode() == "echo hi"


def test_x402_top_up_posts_amount_and_optional_user_id(monkeypatch):
    captured = {}

    def fake_x402_post(base_url, path, payload, account, timeout):
        captured["path"] = path
        captured["payload"] = payload
        return {
            "user_id": "user-1",
            "amount": 10.0,
            "wallet": "0xabc",
            "transaction_id": "tx-1",
            "message": "ok",
        }

    monkeypatch.setattr("hypercli.x402._x402_post", fake_x402_post)
    client = X402Client(api_url="https://api.test")

    result = client.top_up(amount=10.0, account=object())

    assert captured["path"] == "/api/x402/top_up"
    assert captured["payload"] == {"amount": 10.0}
    assert result["transaction_id"] == "tx-1"

    client.top_up(amount=5.0, account=object(), user_id="user-9")
    assert captured["payload"] == {"amount": 5.0, "user_id": "user-9"}

    with pytest.raises(ValueError):
        client.top_up(amount=0, account=object())


def test_auth_me_parses_nested_runtime_kind():
    auth = AuthMe.from_dict(
        {
            "user_id": "u-1",
            "team_id": "t-1",
            "plan_id": "pro",
            "runtime": {"kind": "agent", "agent_id": "agent-9"},
        }
    )
    assert auth.is_runtime_agent is True
    assert auth.runtime_agent_id == "agent-9"


def test_auth_me_parses_legacy_nested_runtime_key():
    auth = AuthMe.from_dict(
        {
            "user_id": "u-1",
            "team_id": "t-1",
            "plan_id": "pro",
            "runtime": {"runtime": "agent", "agent_id": "agent-7"},
        }
    )
    assert auth.is_runtime_agent is True
    assert auth.runtime_agent_id == "agent-7"


def test_auth_me_parses_top_level_runtime_fields():
    auth = AuthMe.from_dict(
        {
            "user_id": "u-1",
            "team_id": "t-1",
            "plan_id": "pro",
            "runtime_kind": "agent",
            "agent_id": "agent-11",
        }
    )
    assert auth.is_runtime_agent is True
    assert auth.runtime_agent_id == "agent-11"


def test_auth_me_without_runtime_is_not_runtime_agent():
    auth = AuthMe.from_dict({"user_id": "u-1", "team_id": "t-1", "plan_id": "free"})
    assert auth.runtime is None
    assert auth.is_runtime_agent is False
    assert auth.runtime_agent_id is None


def test_runtime_identity_accepts_kind_and_runtime_keys():
    assert RuntimeIdentity.from_dict({"kind": "agent", "agent_id": "a-1"}).runtime == "agent"
    assert RuntimeIdentity.from_dict({"runtime": "agent", "agent_id": "a-1"}).runtime == "agent"
    assert RuntimeIdentity.from_dict({}) is None
    assert RuntimeIdentity.from_dict(None) is None


def test_api_key_capabilities_defaults_to_empty_list():
    key = ApiKey.from_dict({"key_id": "k-1", "name": "test"})
    assert key.capabilities == []


def test_user_update_patches_api_user(monkeypatch):
    calls = []

    class StubHTTP:
        def patch(self, path, json=None):
            calls.append((path, json))
            return {"user_id": "user-1", "email": json.get("email"), "name": json.get("name")}

    api = UserAPI(StubHTTP())
    user = api.update(name="New Name", email="new@example.com")

    assert calls == [("/api/user", {"name": "New Name", "email": "new@example.com"})]
    assert user.email == "new@example.com"
    assert user.name == "New Name"

    api.update(name="Only Name")
    assert calls[-1] == ("/api/user", {"name": "Only Name"})


def test_billing_create_stripe_top_up():
    class StubHTTP:
        def __init__(self):
            self.calls = []

        def post(self, path, json=None):
            self.calls.append((path, json))
            return {"checkout_url": "https://stripe.test/cs", "session_id": "cs_1", "message": "ok"}

    http = StubHTTP()
    billing = Billing(http)
    result = billing.create_stripe_top_up(25.0)

    assert http.calls == [("/api/stripe/top_up", {"amount": 25.0})]
    assert result["checkout_url"] == "https://stripe.test/cs"

    with pytest.raises(ValueError):
        billing.create_stripe_top_up(0)


def make_agent():
    from hypercli.agent import HyperAgent

    http = Mock()
    http._session = Mock()
    agent = HyperAgent(
        http,
        agent_api_key="sk-hyper-test",
        agents_api_base_url="https://api.hypercli.com/agents",
    )
    return agent, http


def test_agent_usage_methods_hit_usage_routes():
    from hypercli.agent import HyperAgentUsageHistory, HyperAgentKeyUsage, HyperAgentUsageSummary

    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()

    http._session.get.return_value.json.return_value = {
        "total_tokens": 10,
        "prompt_tokens": 4,
        "completion_tokens": 6,
        "request_count": 2,
        "active_keys": 1,
        "current_tpm": 100,
        "current_rpm": 5,
        "period": "30d",
    }
    summary = agent.usage()
    assert isinstance(summary, HyperAgentUsageSummary)
    assert summary.total_tokens == 10
    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/usage"

    http._session.get.return_value.json.return_value = {
        "history": [{"date": "2026-09-09", "total_tokens": 1, "requests": 1}],
        "days": 7,
    }
    history = agent.usage_history(days=7)
    assert isinstance(history, HyperAgentUsageHistory)
    assert http._session.get.call_args.kwargs["params"] == {"days": 7}

    http._session.get.return_value.json.return_value = {
        "keys": [{"key_hash": "abc", "name": "n", "total_tokens": 3, "requests": 1}],
        "days": 7,
    }
    keys = agent.key_usage(days=14)
    assert isinstance(keys, HyperAgentKeyUsage)
    assert keys.days == 7
    assert http._session.get.call_args.kwargs["params"] == {"days": 14}

    http._session.get.return_value.json.return_value = {"agents": [], "unattributed": {}, "days": 1}
    agent.agent_usage()
    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/usage/agents"
    assert http._session.get.call_args.kwargs["params"] == {"days": 1}


def test_agent_me_hits_agents_me():
    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()
    http._session.get.return_value.json.return_value = {
        "user_id": "u-1",
        "team_id": "t-1",
        "plan_id": "pro",
        "auth_type": "user",
        "capabilities": [],
        "auth_capabilities": [],
        "has_active_subscription": True,
    }

    result = agent.me()

    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/me"
    assert result["plan_id"] == "pro"


def test_create_stripe_checkout_posts_plan_route():
    from hypercli.agent import HyperAgentStripeCheckoutResponse

    agent, http = make_agent()
    http._session.post.return_value.raise_for_status = Mock()
    http._session.post.return_value.json.return_value = {"checkout_url": "https://stripe.test/x"}

    result = agent.create_stripe_checkout("team", success_url="https://app.test/ok")

    assert isinstance(result, HyperAgentStripeCheckoutResponse)
    args = http._session.post.call_args
    assert args.args[0] == "https://api.hypercli.com/agents/stripe/team"
    assert args.kwargs["json"] == {"success_url": "https://app.test/ok"}

    with pytest.raises(ValueError):
        agent.create_stripe_checkout("")


def test_create_stripe_billing_portal_session():
    agent, http = make_agent()
    http._session.post.return_value.raise_for_status = Mock()
    http._session.post.return_value.json.return_value = {"id": "bps_1", "url": "https://stripe.test/portal"}

    result = agent.create_stripe_billing_portal_session(return_url="https://app.test/back")

    args = http._session.post.call_args
    assert args.args[0] == "https://api.hypercli.com/agents/stripe/billing-portal"
    assert args.kwargs["json"] == {"return_url": "https://app.test/back"}
    assert result["url"] == "https://stripe.test/portal"

    with pytest.raises(ValueError):
        agent.create_stripe_billing_portal_session(return_url="")


def test_billing_profile_get_and_put():
    from hypercli.agent import HyperAgentBillingProfileFields, HyperAgentBillingProfileResponse

    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()
    http._session.put.return_value.raise_for_status = Mock()
    payload = {
        "company_billing": {"address": ["1 Main St"], "email": "billing@hypercli.com"},
        "profile": {"billing_name": "Ada"},
        "synced_stripe_customer_ids": ["cus_1"],
    }
    http._session.get.return_value.json.return_value = payload
    http._session.put.return_value.json.return_value = payload

    profile = agent.billing_profile()
    assert isinstance(profile, HyperAgentBillingProfileResponse)
    assert profile.profile.billing_name == "Ada"
    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/billing/profile"

    updated = agent.update_billing_profile(profile=HyperAgentBillingProfileFields(billing_name="Ada"))
    args = http._session.put.call_args
    assert args.args[0] == "https://api.hypercli.com/agents/billing/profile"
    assert args.kwargs["json"]["billing_name"] == "Ada"
    assert updated.synced_stripe_customer_ids == ["cus_1"]


def test_billing_info():
    from hypercli.agent import HyperAgentBillingInfo

    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()
    http._session.get.return_value.json.return_value = {
        "address": ["1 Main St"],
        "email": "billing@hypercli.com",
    }

    info = agent.billing_info()

    assert isinstance(info, HyperAgentBillingInfo)
    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/billing/info"


def test_billing_payments_and_payment():
    from hypercli.agent import HyperAgentPayment, HyperAgentPaymentsResponse

    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()
    payment = {
        "id": "pay-1",
        "user_id": "u-1",
        "provider": "STRIPE",
        "status": "SUCCEEDED",
        "amount": "49.00",
        "currency": "USD",
    }
    http._session.get.return_value.json.return_value = {"items": [payment]}

    payments = agent.billing_payments(limit=10, provider="stripe", status="succeeded")
    assert isinstance(payments, HyperAgentPaymentsResponse)
    args = http._session.get.call_args
    assert args.args[0] == "https://api.hypercli.com/agents/billing/payments"
    assert args.kwargs["params"] == {"limit": 10, "provider": "stripe", "status": "succeeded"}

    http._session.get.return_value.json.return_value = payment
    single = agent.billing_payment("pay-1")
    assert isinstance(single, HyperAgentPayment)
    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/billing/payments/pay-1"


def test_entitlement_instances():
    agent, http = make_agent()
    http._session.get.return_value.raise_for_status = Mock()
    http._session.get.return_value.json.return_value = {
        "items": [
            {
                "id": "ent-1",
                "user_id": "u-1",
                "subscription_id": None,
                "plan_id": "team",
                "plan_name": "Team",
                "provider": "STRIPE",
                "status": "ACTIVE",
                "starts_at": "2026-09-01T00:00:00Z",
                "expires_at": "2026-10-01T00:00:00Z",
                "slot_grants": {"medium": 1},
            }
        ]
    }

    instances = agent.entitlement_instances()

    assert http._session.get.call_args.args[0] == "https://api.hypercli.com/agents/entitlements/instances"
    assert instances[0].id == "ent-1"
    assert instances[0].expires_at == datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_claim_trial_entitlement_warns_deprecation():
    agent, http = make_agent()
    http._session.post.return_value.raise_for_status = Mock()
    http._session.post.return_value.json.return_value = {
        "id": "ent-trial",
        "plan_id": "team",
        "provider": "TRIAL",
        "status": "ACTIVE",
    }

    with pytest.warns(DeprecationWarning):
        agent.claim_trial_entitlement()


def test_deployments_profile_image_delete_and_account_endpoints():
    http = Mock()
    http.api_key = "key"
    http.timeout = 30.0
    deployments = Deployments(http=http, api_key="sk-hyper-test", api_base="https://api.test.hypercli.com")

    deleted_calls = []
    deployments._delete = lambda path: deleted_calls.append(path) or {"id": "agent-1", "avatar_url": None}
    deployments._get = lambda path, params=None: {"id": "user-1", "avatar_url": "https://img", "s3_key": "k"}

    agent_result = deployments.delete_profile_image("agent-1")
    assert deleted_calls == ["/deployments/agent-1/profile-image"]
    assert agent_result["avatar_url"] is None

    assert deployments.get_account_profile_image()["avatar_url"] == "https://img"

    deployments.delete_account_profile_image()
    assert deleted_calls[-1] == "/users/profile-image"


def test_workspace_accept_invite_posts_grant_route(monkeypatch):
    calls = []

    def fake_request(method, url, *, api_key, user_id=None, agent_id=None, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        return {
            "id": "grant-1",
            "workspace_id": "workspace-1",
            "subject_type": "user",
            "subject_id": "user-1",
            "role": "contributor",
        }

    monkeypatch.setattr("hypercli.workspaces._request", fake_request)
    api = WorkspacesAPI("key", api_base="http://workspaces.test/workspaces")

    grant = api.accept_invite("grant/#1")

    assert grant.role == "contributor"
    assert grant.id == "grant-1"
    assert calls == [("POST", "http://workspaces.test/workspaces/invites/accept/grant%2F%231", None)]


@pytest.mark.asyncio
async def test_voice_session_sends_token_query_param_and_bearer_header(monkeypatch):
    from hypercli import voice_stream
    from hypercli.voice_stream import VoiceSession

    captured = {}

    class FakeWS:
        sent = []

        async def send(self, message):
            self.sent.append(message)

        async def close(self):
            pass

    async def fake_connect(url, additional_headers=None, **kwargs):
        captured["url"] = url
        captured["headers"] = additional_headers
        return FakeWS()

    monkeypatch.setattr(voice_stream.websockets, "connect", fake_connect)

    session = VoiceSession("wss://voice.test/ws", "token/with+unsafe=chars")
    await session.open()

    assert captured["url"].startswith("wss://voice.test/ws/voice?token=")
    assert "token%2Fwith%2Bunsafe%3Dchars" in captured["url"]
    assert captured["headers"] == {"Authorization": "Bearer token/with+unsafe=chars"}
    assert session.state == "idle"
