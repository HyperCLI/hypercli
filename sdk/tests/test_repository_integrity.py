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
