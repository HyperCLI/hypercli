import json
from pathlib import Path


def test_sdk_sources_have_no_merge_conflict_markers():
    repo_root = Path(__file__).resolve().parents[2]
    source_roots = (repo_root / "sdk" / "hypercli", repo_root / "ts-sdk" / "src")
    markers = ("<<<<<<< ", "=======", ">>>>>>> ")
    conflicts: list[str] = []

    for source_root in source_roots:
        for path in source_root.rglob("*"):
            if not path.is_file() or path.suffix not in {".py", ".ts", ".tsx"}:
                continue
            for line_number, line in enumerate(path.read_text().splitlines(), start=1):
                if line.startswith(markers):
                    conflicts.append(f"{path.relative_to(repo_root)}:{line_number}")

    assert conflicts == [], f"Unresolved merge conflicts: {', '.join(conflicts)}"


def test_agents_openapi_uses_bodyless_restore():
    repo_root = Path(__file__).resolve().parents[2]
    schema = json.loads((repo_root / "docs" / "agents-openapi.json").read_text())
    restore = schema["paths"]["/agents/deployments/{agent_id}/restore"]["post"]

    assert "requestBody" not in restore


def test_agents_openapi_voice_surface_is_clone_and_transcribe():
    repo_root = Path(__file__).resolve().parents[2]
    schema = json.loads((repo_root / "docs/agents-openapi.json").read_text())
    assert {path for path in schema["paths"] if path.startswith("/agents/voice/")} == {
        "/agents/voice/clone", "/agents/voice/transcribe",
    }
    assert "post" in schema["paths"]["/agents/voice/clone"]
    assert "post" in schema["paths"]["/agents/voice/transcribe"]
