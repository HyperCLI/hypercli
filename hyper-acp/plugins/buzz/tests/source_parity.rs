use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const UPSTREAM_HASHES: &[(&str, &str)] = &[
    (
        "src/acp.rs",
        "e92935651483d2c9b51b0eae723705f1dac97e590a5843a645c91d42973dbc9f",
    ),
    (
        "src/base_prompt.md",
        "b710fa17703c126c651c37e089d9958785fce25d769e57c5b81d89694edd9a36",
    ),
    (
        "src/engram_fetch.rs",
        "7894398b28b818398e4e307c72042a9b342690446d969daf41a3747b76c47e0e",
    ),
    (
        "src/filter.rs",
        "f34aec7b31603b2fa285158a0927d7d0f08ceeea51bbd1abe30286f16563b4e0",
    ),
    (
        "src/observer.rs",
        "77396790298d5b9df12b33e0f2c5c052b769066569e35d82d1187e43edc0780b",
    ),
    (
        "src/pool.rs",
        "fe4e8dd23ac287f435e57f88a0017b4399a4f79d447ea7bfd0f7709ca146a3d4",
    ),
    (
        "src/pool_lifecycle.rs",
        "0a38702e86db5d5ce168313656d5139aa2a70f27d9c16b373919e0ade527eb55",
    ),
    (
        "src/prompt_framing.rs",
        "f50be31bf4c147aefc46317cd8af1f0ca6b76f2489fd97afe0e8336bb3ab1f8f",
    ),
    (
        "src/prompt_project.rs",
        "200eea011dc40b285644f19d34cc5e76a56df97b6dec4814beca84cb6793728e",
    ),
    (
        "src/queue.rs",
        "6fd72f7780185e3379bb5a5e792a672d8db413f2d52a19d5b23681238fbb7549",
    ),
    (
        "src/relay.rs",
        "96575f74db5cf39120242859c73f0d23eee8c4391a6377f98fe826d33dcbe783",
    ),
    (
        "src/scope.rs",
        "4b8362570340558f44f57cbd918586024e4017a17c4d18fc562b8a930588d1ba",
    ),
    (
        "src/session_model_channel.md",
        "654860da1e5f34b2bb0b6ad6fb6e9adbfca05fb434f896dafbd09a23a978ea9f",
    ),
    (
        "src/session_model_thread.md",
        "a5dc7527ac55cfeb94abd40c54c2b203c88c829e90b53c36ad83d67360b5916b",
    ),
    (
        "src/setup_mode.rs",
        "370b1b4ebbfffdf9f3bfc309b2566c8494d91ed8b2b05913ff6f425eca26e9a3",
    ),
    (
        "src/usage.rs",
        "b14fc2707f707a455c72857da206298bccd4f18389ff9318d30c61fd604bb228",
    ),
    (
        "tests/pool_lifecycle_state.rs",
        "e2cb53e7adbe2c05abe1089edfad413b9ea9071be47a44c2edc13adea341d43f",
    ),
];

fn collect_files(root: &Path, base: &Path, files: &mut BTreeSet<PathBuf>) {
    for entry in std::fs::read_dir(root).expect("read parity dir") {
        let entry = entry.expect("read parity dir entry");
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, base, files);
        } else {
            files.insert(
                path.strip_prefix(base)
                    .expect("strip parity root")
                    .to_owned(),
            );
        }
    }
}

fn sha256sum(path: &Path) -> String {
    let output = std::process::Command::new("sha256sum")
        .arg(path)
        .output()
        .unwrap_or_else(|error| panic!("run sha256sum for {}: {error}", path.display()));
    assert!(
        output.status.success(),
        "sha256sum failed for {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("sha256sum stdout is utf8")
        .split_whitespace()
        .next()
        .expect("sha256sum produced a digest")
        .to_owned()
}

#[test]
fn copied_buzz_sources_match_upstream_except_documented_entrypoint_diffs() {
    let plugin_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let allowed_diffs: BTreeSet<PathBuf> = [
        "Cargo.toml",
        "PROVENANCE.md",
        "README.md",
        "src/config.rs",
        "src/lib.rs",
        "src/main.rs",
        "tests/source_parity.rs",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();

    let mut plugin_files = BTreeSet::new();
    collect_files(&plugin_root, &plugin_root, &mut plugin_files);

    let hashed_files: BTreeSet<PathBuf> = UPSTREAM_HASHES
        .iter()
        .map(|(file, _hash)| PathBuf::from(file))
        .collect();
    let mut unexpected = Vec::new();
    for file in &plugin_files {
        if allowed_diffs.contains(file) || hashed_files.contains(file) {
            continue;
        }
        unexpected.push(file.clone());
    }
    assert!(
        unexpected.is_empty(),
        "unexpected Buzz plugin file outside copied upstream sources and documented entrypoint/config files: {unexpected:?}"
    );

    for (file, expected_hash) in UPSTREAM_HASHES {
        let path = plugin_root.join(file);
        assert!(
            path.exists(),
            "missing copied Buzz source {}",
            path.display()
        );
        assert_eq!(
            sha256sum(&path),
            *expected_hash,
            "copied Buzz source drifted: {file}"
        );
    }
}
