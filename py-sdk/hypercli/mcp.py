"""Explicit MCP selections for existing deployment launch environment maps."""
import json


def build_additional_mcp_env(*groups: list[dict]) -> dict[str, str]:
    """Assemble standard ACP entries without credential discovery or transport policy.

    Pass the result through the existing launch ``env`` option. The host owns
    merging/conflicts and the runtime owns support; this does not configure ACP
    sessions from the SDK process environment.
    """
    return {"HYPER_ADDITIONAL_MCP_SERVERS": json.dumps(
        [server for group in groups for server in group], separators=(",", ":"))}
