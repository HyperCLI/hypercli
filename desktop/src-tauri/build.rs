fn main() {
    // Env-gated updater (Buzz pattern): the updater + process plugins are
    // registered in lib.rs only when this cfg is present, and the cfg is
    // emitted only when both env vars are non-empty at build time. Local and
    // dev builds without them ship with the updater compiled out.
    println!("cargo:rerun-if-env-changed=HYPERCLI_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=HYPERCLI_UPDATER_ENDPOINT");
    println!("cargo:rustc-check-cfg=cfg(hypercli_updater_enabled)");

    let env_set = |name: &str| {
        std::env::var(name)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    };
    if env_set("HYPERCLI_UPDATER_PUBLIC_KEY") && env_set("HYPERCLI_UPDATER_ENDPOINT") {
        println!("cargo:rustc-cfg=hypercli_updater_enabled");
    }

    tauri_build::build()
}
