//! Buzz provider install surface.
//!
//! The desktop app bundles the `buzz-backend-hypercli` provider as a Tauri
//! sidecar (`externalBin`, see desktop/scripts/build-release-config.mjs). These
//! commands install it into `~/.local/bin` — the directory Buzz scans for
//! backend providers on every platform — as a user-owned copy that outlives
//! the app bundle, then report which runtime identities are present.
//!
//! Ported from the legacy desktop installer (commit 59a869bb). Key properties:
//! - The real binary is installed by streaming bytes (NOT `fs::copy`, which
//!   would clone `com.apple.quarantine` and get the provider killed by
//!   Gatekeeper when Buzz spawns it) into a temp file then atomically renamed.
//! - Every runtime identity is a *relative* symlink to the one real binary, so
//!   the install survives the home directory being moved or renamed. Windows
//!   copies instead (symlinks need admin or Developer Mode).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::home_dir;

/// Runtime identities Buzz discovers as separate `Run on` choices. Keep in
/// sync with `buzz-backend-provider/README.md`.
const RUNTIMES: [&str; 6] = ["buzz-agent", "opencode", "codex", "claude", "goose", "kimi"];
const PROVIDER_BIN: &str = "buzz-backend-hypercli";

#[derive(Serialize)]
pub struct ProviderStatus {
    installed: Vec<String>,
    missing: Vec<String>,
    /// Present but unusable — a leftover link whose target is gone. Reported
    /// separately so the UI can say "reinstall" instead of "never installed".
    broken: Vec<String>,
    /// macOS is running the app from a translocation mount; the install
    /// still works (we copy), but the user should move the app.
    translocated: bool,
    bin_dir: String,
    bin_dir_exists: bool,
}

/// Buzz scans this directory explicitly on every platform.
fn bin_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".local").join("bin"))
}

/// The single real binary installed in `~/.local/bin`; every Buzz runtime
/// identity links to it. Generic on purpose — the same executable serves the
/// provider protocol for every runtime identity.
fn canonical_bin_name() -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("{PROVIDER_BIN}{ext}")
}

fn provider_names() -> Vec<String> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    RUNTIMES
        .iter()
        .map(|rt| format!("{PROVIDER_BIN}-{rt}{ext}"))
        .collect()
}

/// True when macOS is running this app from an App Translocation mount — a
/// randomized read-only copy of a still-quarantined download, torn down when
/// the app quits. Installing by copy is safe from there; only links into the
/// bundle would break, which is exactly why we copy rather than link.
fn is_translocated() -> bool {
    std::env::current_exe()
        .map(|exe| exe.to_string_lossy().contains("/AppTranslocation/"))
        .unwrap_or(false)
}

/// The sidecar binary Tauri bundles next to the app executable.
fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "cannot resolve app directory".to_string())?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let path = dir.join(format!("{PROVIDER_BIN}{ext}"));
    if !path.exists() {
        return Err(format!("bundled provider not found at {}", path.display()));
    }
    Ok(path)
}

/// Install a binary by streaming its bytes to a temp file and renaming it
/// into place.
///
/// Deliberately NOT `fs::copy`: on macOS that clones extended attributes, so
/// copying out of a quarantined app bundle would produce a quarantined binary
/// and Gatekeeper would kill it the moment Buzz executed it. The rename is
/// atomic and safe even while a previous copy is running — the live process
/// keeps the old inode.
fn install_binary(source: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("tmp-install");
    let _ = fs::remove_file(&tmp);
    {
        let mut reader = fs::File::open(source)?;
        let mut writer = fs::File::create(&tmp)?;
        std::io::copy(&mut reader, &mut writer)?;
        writer.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(&tmp, dest)
}

/// Drop the quarantine flag a copied binary inherits from a downloaded app.
/// Buzz spawns these directly; a quarantined, not-yet-notarized binary would
/// be blocked by Gatekeeper. Best effort — the attribute is often absent.
#[cfg(target_os = "macos")]
fn clear_quarantine(path: &std::path::Path) {
    let _ = std::process::Command::new("/usr/bin/xattr")
        .args(["-d", "com.apple.quarantine"])
        .arg(path)
        .output();
}

#[cfg(not(target_os = "macos"))]
fn clear_quarantine(_path: &std::path::Path) {}

#[tauri::command]
pub fn provider_status() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    // `exists()` follows symlinks, so a link left dangling by an older
    // install correctly reads as missing and gets replaced on the next
    // install.
    let (installed, missing): (Vec<String>, Vec<String>) = provider_names()
        .into_iter()
        .partition(|name| dir.join(name).exists());
    // A name that exists as a link but resolves nowhere: installed by an
    // older build that pointed into the app bundle.
    let broken = missing
        .iter()
        .filter(|name| dir.join(name).symlink_metadata().is_ok())
        .cloned()
        .collect();
    Ok(ProviderStatus {
        installed,
        missing,
        broken,
        translocated: is_translocated(),
        bin_dir: dir.display().to_string(),
        bin_dir_exists: dir.is_dir(),
    })
}

/// Install the provider into `~/.local/bin`, owned by the user rather than
/// the app bundle: one real copy under the `buzz-backend-hypercli` name, with
/// every runtime identity a relative symlink beside it (copies on Windows,
/// where symlinks need admin or Developer Mode).
///
/// Copying — rather than linking into `HyperCLI.app` — is deliberate: a
/// downloaded app may run from an App Translocation mount that vanishes on
/// quit, and the app can be moved or deleted. The install must outlive it.
#[tauri::command]
pub fn install_providers() -> Result<ProviderStatus, String> {
    let source = sidecar_path()?;
    let dir = bin_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let primary = dir.join(canonical_bin_name());
    install_binary(&source, &primary)
        .map_err(|e| format!("installing {}: {e}", primary.display()))?;
    clear_quarantine(&primary);

    for name in provider_names() {
        let target = dir.join(&name);
        // symlink_metadata, not exists(): a link left dangling by an older
        // install still needs removing, and exists() follows the link.
        if target.symlink_metadata().is_ok() {
            fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
        // Relative target: resolves through the directory itself, so the
        // install survives the home directory being moved or renamed.
        #[cfg(unix)]
        std::os::unix::fs::symlink(canonical_bin_name(), &target).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            fs::copy(&primary, &target).map_err(|e| e.to_string())?;
            clear_quarantine(&target);
        }
    }
    provider_status()
}

/// Remove every runtime identity and the shared binary. Only touches our
/// names.
#[tauri::command]
pub fn uninstall_providers() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    for name in provider_names().into_iter().chain([canonical_bin_name()]) {
        let target = dir.join(&name);
        if target.symlink_metadata().is_ok() {
            fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
    }
    provider_status()
}
