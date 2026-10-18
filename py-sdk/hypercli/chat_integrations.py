"""Pure chat-connector configuration for deployment env/secrets maps."""
import json
import re
from urllib.parse import urlsplit

CHAT_INTEGRATIONS = {
    "slack": {
        "fields": ("SLACK_MODE", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"),
        "secrets": ("SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"),
        "defaults": {"SLACK_MODE": "socket"},
    },
    "buzz": {
        "fields": ("BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY", "BUZZ_AUTH_TAG"),
        "secrets": ("BUZZ_PRIVATE_KEY", "BUZZ_AUTH_TAG"), "defaults": {},
    },
    "teams": {
        "fields": ("TEAMS_APP_ID", "TEAMS_APP_SECRET", "TEAMS_TENANT_ID", "TEAMS_TRUSTED_SERVICE_BASES"),
        "secrets": ("TEAMS_APP_SECRET",), "defaults": {},
    },
    "telegram": {
        "fields": ("TELEGRAM_MODE", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET"),
        "secrets": ("TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"),
        "defaults": {"TELEGRAM_MODE": "polling"},
    },
}


def build_chat_integration_config(integration: str, values: dict[str, str]) -> dict[str, dict[str, str]]:
    """Validate one complete connector; return maps accepted by launch builders.

    Does not read ambient credentials, verify provider access, or start transports.
    Errors name fields only, never their values.
    """
    if integration not in CHAT_INTEGRATIONS:
        raise ValueError("Unknown chat integration")
    descriptor = CHAT_INTEGRATIONS[integration]
    normalized = dict(descriptor["defaults"])
    for key, value in values.items():
        if key not in descriptor["fields"]:
            raise ValueError("Unknown field for chat integration")
        if not isinstance(value, str) or any(c in value for c in "\r\n\0"):
            raise ValueError(f"{key} must be a single-line string")
        if value.strip():
            normalized[key] = value.strip()

    def require(*keys):
        for key in keys:
            if not normalized.get(key):
                raise ValueError(f"{key} is required")

    def absent(*keys):
        for key in keys:
            if normalized.get(key):
                raise ValueError(f"{key} does not apply to the selected mode")

    def url(key, protocols, value=None):
        try:
            value = normalized[key] if value is None else value
            if not re.match(r"^[a-z]+://", value, re.IGNORECASE) or re.search(r"[\s\\?#\x00-\x1f\x7f-\x9f\ufeff]", value):
                raise ValueError()
            parsed = urlsplit(value)
            if parsed.scheme not in protocols or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError()
            # Access validates malformed/out-of-range ports without exposing input.
            _ = parsed.port
        except ValueError:
            raise ValueError(f"{key} has an invalid URL") from None

    if integration == "slack":
        require("SLACK_BOT_TOKEN")
        if normalized["SLACK_MODE"] == "socket":
            require("SLACK_APP_TOKEN")
            absent("SLACK_SIGNING_SECRET")
        elif normalized["SLACK_MODE"] == "http":
            require("SLACK_SIGNING_SECRET")
            absent("SLACK_APP_TOKEN")
        else:
            raise ValueError("SLACK_MODE must be socket or http")
    elif integration == "buzz":
        require("BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY")
        url("BUZZ_RELAY_URL", ("ws", "wss"))
    elif integration == "teams":
        require(*descriptor["fields"])
        for key in ("TEAMS_APP_ID", "TEAMS_TENANT_ID"):
            if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", normalized[key]):
                raise ValueError(f"{key} must be a UUID")
        try:
            bases = json.loads(normalized["TEAMS_TRUSTED_SERVICE_BASES"])
        except ValueError:
            bases = None
        if not isinstance(bases, list) or not bases or any(not isinstance(base, str) for base in bases):
            raise ValueError("TEAMS_TRUSTED_SERVICE_BASES must be a nonempty JSON array of URLs")
        for base in bases:
            url("TEAMS_TRUSTED_SERVICE_BASES", ("https",), base)
            if not base.endswith("/"):
                raise ValueError("TEAMS_TRUSTED_SERVICE_BASES URLs must end with /")
        normalized["TEAMS_TRUSTED_SERVICE_BASES"] = json.dumps(bases, separators=(",", ":"), ensure_ascii=False)
    elif integration == "telegram":
        require("TELEGRAM_BOT_TOKEN")
        if normalized["TELEGRAM_MODE"] == "webhook":
            require("TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET")
            url("TELEGRAM_WEBHOOK_URL", ("https",))
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", normalized["TELEGRAM_WEBHOOK_SECRET"]):
                raise ValueError("TELEGRAM_WEBHOOK_SECRET must contain 1–256 letters, digits, _ or -")
        elif normalized["TELEGRAM_MODE"] == "polling":
            absent("TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET")
        else:
            raise ValueError("TELEGRAM_MODE must be polling or webhook")
    result = {"env": {}, "secrets": {}}
    for key, value in normalized.items():
        result["secrets" if key in descriptor["secrets"] else "env"][key] = value
    return result
