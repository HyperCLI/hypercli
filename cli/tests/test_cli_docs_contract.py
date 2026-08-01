import json
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
    skill = (REPO_ROOT / "skills/SKILL.md").read_text()

    for command in ROOT_COMMAND_DOCS:
        assert f"`hyper {command}`" in cli_index
        assert f"`{command}`" in skill


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
