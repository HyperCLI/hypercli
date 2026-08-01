import json
import re
from pathlib import Path

from typer.main import get_command

from hypercli_cli.cli import app


REPO_ROOT = Path(__file__).resolve().parents[2]

ROOT_COMMAND_DOCS = {
    "launch": "docs/cli/commands/instances.mdx",
    "me": "docs/cli/configuration.mdx",
    "status": "docs/cli/configuration.mdx",
    "configure": "docs/cli/configuration.mdx",
    "agents": "docs/cli/commands/agents.mdx",
    "agent": "docs/cli/commands/agent.mdx",
    "config": "docs/cli/configuration.mdx",
    "billing": "docs/cli/commands/billing.mdx",
    "comfyui": "docs/cli/commands/comfyui.mdx",
    "files": "docs/cli/commands/files.mdx",
    "flow": "docs/cli/commands/flow.mdx",
    "instances": "docs/cli/commands/instances.mdx",
    "keys": "docs/cli/commands/keys.mdx",
    "jobs": "docs/cli/commands/jobs.mdx",
    "llm": "docs/cli/commands/llm.mdx",
    "memory": "docs/cli/commands/memory.mdx",
    "user": "docs/cli/commands/user.mdx",
    "voice": "docs/cli/commands/voice.mdx",
    "wallet": "docs/cli/commands/wallet.mdx",
    "workspaces": "docs/cli/commands/workspaces.mdx",
}

GROUP_DOCS = {
    name: path
    for name, path in ROOT_COMMAND_DOCS.items()
    if name not in {"launch", "me", "status", "configure"}
}

GROUP_SKILL_OWNERS = {
    "agents": "hypercli-agents",
    "billing": "hypercli-account",
    "config": "hypercli-auth",
    "files": "hypercli-knowledge",
    "flow": "hypercli-flows",
    "instances": "hypercli-compute",
    "jobs": "hypercli-compute",
    "keys": "hypercli-account",
    "memory": "hypercli-knowledge",
    "voice": "hypercli-voice",
    "wallet": "hypercli-account",
    "workspaces": "hypercli-knowledge",
}

EXACT_SKILL_OWNERS = {
    ("launch",): "hypercli-compute",
    ("me",): "hypercli-auth",
    ("status",): "hypercli-auth",
    ("configure",): "hypercli-auth",
    ("user",): "hypercli-account",
    ("llm", "image"): "hypercli",
    ("agent", "onboard"): "hypercli-account",
    ("agent", "subscribe"): "hypercli-account",
    ("agent", "status"): "hypercli-account",
    ("agent", "plans"): "hypercli-account",
    ("agent", "current-plan"): "hypercli-account",
    ("agent", "subscriptions"): "hypercli-account",
    ("agent", "subscription-summary"): "hypercli-account",
    ("agent", "start"): "hypercli-agents",
    ("agent", "stop"): "hypercli-agents",
    ("agent", "enable"): "hypercli-agents",
    ("agent", "activate-code"): "hypercli-account",
    ("agent", "login"): "hypercli-account",
    ("agent", "openclaw-setup"): "hypercli-auth",
    ("agent", "exec"): "hypercli-agents",
    ("agent", "shell"): "hypercli-agents",
    ("agent", "config"): "hypercli-auth",
    ("agent", "voice", "transcribe"): "hypercli-voice",
    ("agent", "voice", "tts"): "hypercli-voice",
    ("agent", "voice", "clone"): "hypercli-voice",
    ("agent", "voice", "design"): "hypercli-voice",
    ("agent", "embed", "text"): "hypercli",
    ("agent", "embed", "test"): "hypercli",
}

SKILL_POLICY_EXCLUSIONS = {
    ("agent", "models"),
    ("llm", "chat"),
    ("comfyui", "run"),
    ("comfyui", "templates"),
    ("comfyui", "show"),
    ("comfyui", "status"),
    ("comfyui", "download"),
    ("comfyui", "stop"),
}

SKILL_POLICY_EXCLUDED_ROOTS = {"comfyui"}

EXPECTED_SKILL_LEAF_COUNTS = {
    "hypercli": 3,
    "hypercli-account": 24,
    "hypercli-agents": 34,
    "hypercli-auth": 7,
    "hypercli-compute": 14,
    "hypercli-flows": 14,
    "hypercli-knowledge": 23,
    "hypercli-voice": 8,
}


def _registered_leaf_paths():
    leaves = set()

    def visit(command, prefix=()):
        children = getattr(command, "commands", {})
        if not children:
            leaves.add(prefix)
            return
        for name, child in children.items():
            visit(child, (*prefix, name))

    visit(get_command(app))
    return leaves


def test_every_root_command_has_a_detailed_doc():
    registered = set(get_command(app).commands)
    docs_navigation = json.loads((REPO_ROOT / "docs/docs.json").read_text())
    serialized_navigation = json.dumps(docs_navigation["navigation"])

    assert registered == set(ROOT_COMMAND_DOCS)
    for relative_path in ROOT_COMMAND_DOCS.values():
        assert (REPO_ROOT / relative_path).is_file(), relative_path
        nav_path = relative_path.removeprefix("docs/").removesuffix(".mdx")
        assert nav_path in serialized_navigation, nav_path


def test_cli_index_and_canonical_skill_cover_every_root_command():
    cli_index = (REPO_ROOT / "docs/cli/index.mdx").read_text()
    skill = "\n".join(
        path.read_text()
        for path in sorted((REPO_ROOT / "skills").glob("*/SKILL.md"))
    )

    for command in ROOT_COMMAND_DOCS:
        assert f"`hyper {command}`" in cli_index
        if command not in SKILL_POLICY_EXCLUDED_ROOTS:
            assert f"`{command}`" in skill or f"`hyper {command} " in skill


def test_canonical_skills_use_named_directories_and_are_publicly_cataloged():
    skill_paths = sorted((REPO_ROOT / "skills").glob("*/SKILL.md"))
    skill_names = {path.parent.name for path in skill_paths}
    catalog_path = REPO_ROOT / "docs/cli/skills.mdx"
    catalog = catalog_path.read_text()
    cataloged_names = set(
        re.findall(
            r"https://github\.com/HyperCLI/hypercli/blob/main/skills/([^/]+)/SKILL\.md",
            catalog,
        )
    )
    docs_navigation = json.loads((REPO_ROOT / "docs/docs.json").read_text())

    assert skill_names == cataloged_names
    assert "cli/skills" in json.dumps(docs_navigation["navigation"])
    for path in skill_paths:
        contents = path.read_text()
        assert contents.startswith("---\n")
        assert f"name: {path.parent.name}\n" in contents
        source_url = (
            "https://github.com/HyperCLI/hypercli/blob/main/"
            f"skills/{path.parent.name}/SKILL.md"
        )
        source_link = f"[`skills/{path.parent.name}/SKILL.md`]({source_url})"
        assert f"| `{path.parent.name}` |" in catalog
        assert source_link in catalog


def test_every_cli_leaf_has_exactly_one_skill_owner_or_policy_exclusion():
    leaves = _registered_leaf_paths()
    classifications = {}

    for path in leaves:
        matches = []
        if path in SKILL_POLICY_EXCLUSIONS:
            matches.append("excluded")
        if path in EXACT_SKILL_OWNERS:
            matches.append(EXACT_SKILL_OWNERS[path])
        if path and path[0] in GROUP_SKILL_OWNERS:
            matches.append(GROUP_SKILL_OWNERS[path[0]])
        assert len(matches) == 1, f"hyper {' '.join(path)} classifications: {matches}"
        classifications[path] = matches[0]

    excluded = {path for path, owner in classifications.items() if owner == "excluded"}
    assert excluded == SKILL_POLICY_EXCLUSIONS

    owner_counts = {}
    for owner in classifications.values():
        if owner == "excluded":
            continue
        owner_counts[owner] = owner_counts.get(owner, 0) + 1
    assert owner_counts == EXPECTED_SKILL_LEAF_COUNTS
    assert len(leaves) == sum(EXPECTED_SKILL_LEAF_COUNTS.values()) + len(excluded) == 135

    skill_names = {
        path.parent.name for path in (REPO_ROOT / "skills").glob("*/SKILL.md")
    }
    assert set(owner_counts) == skill_names


def test_every_group_subcommand_is_named_in_its_reference():
    root = get_command(app)

    for group_name, relative_path in GROUP_DOCS.items():
        group = root.commands[group_name]
        reference = (REPO_ROOT / relative_path).read_text()
        for command_name in getattr(group, "commands", {}):
            documented_forms = (
                f"hyper {group_name} {command_name}",
                f"`{command_name}`",
                f"## {command_name}",
            )
            assert any(form in reference for form in documented_forms), (
                f"hyper {group_name} {command_name} is absent from {relative_path}"
            )
