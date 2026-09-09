//! LF-only house rule: every checked-in .rs source file must contain zero CR
//! bytes. Mirrors cli/tests/line-endings.test.ts so a CRLF checkout or a
//! Windows-side edit fails fast instead of poisoning the tree.

use std::fs;
use std::path::{Path, PathBuf};

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == "target" || name == ".git" {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn rust_sources_contain_zero_cr_bytes() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    collect_rs_files(&crate_root.join("src"), &mut files);
    collect_rs_files(&crate_root.join("tests"), &mut files);
    assert!(!files.is_empty(), "no .rs files found; test is mis-scoped");

    let offenders: Vec<String> = files
        .iter()
        .filter(|p| fs::read(p).is_ok_and(|bytes| bytes.contains(&b'\r')))
        .map(|p| {
            p.strip_prefix(crate_root)
                .unwrap_or(p)
                .display()
                .to_string()
        })
        .collect();
    assert!(
        offenders.is_empty(),
        "CR bytes found in {} file(s): {offenders:?}",
        offenders.len()
    );
}
