import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Write src-tauri/tauri.release.conf.json with release-only overrides.
// Plain node, no dependencies. Ported from Buzz's
// desktop/scripts/build-release-config.mjs.
//
// Tauri's --config flag merges the provided JSON on top of the base
// tauri.conf.json, so this file must contain ONLY the delta fields —
// not a copy of the base config.
//
// For release builds this script emits:
// 1. bundle.macOS.minimumSystemVersion = "10.15" for broad compatibility.
// 2. bundle.createUpdaterArtifacts = true so Tauri produces the updater
//    archive (.app.tar.gz on macOS) and .sig signature during the build.
// 3. plugins.updater with the public key and endpoint.
//    HYPERCLI_UPDATER_PUBLIC_KEY is required (release builds always ship the
//    updater); HYPERCLI_UPDATER_ENDPOINT defaults to the latest.json on the
//    rolling `desktop-latest` GitHub release.
//
// Apple code signing and notarization happen post-build on the self-hosted
// signing job (rcodesign, creds from the Pulumi stack), so no signingIdentity
// is emitted here and macOS Tauri builds are invoked with --no-sign.

const outputConfigPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tauri.release.conf.json",
);

const DEFAULT_UPDATER_ENDPOINT =
  "https://github.com/HyperCLI/hypercli/releases/download/desktop-latest/latest.json";

const updaterPubkey = process.env.HYPERCLI_UPDATER_PUBLIC_KEY;
const updaterEndpoint =
  process.env.HYPERCLI_UPDATER_ENDPOINT || DEFAULT_UPDATER_ENDPOINT;

if (!updaterPubkey) {
  console.error(
    "Error: required environment variable missing: HYPERCLI_UPDATER_PUBLIC_KEY",
  );
  process.exit(1);
}

const releaseConfig = {
  bundle: {
    macOS: {
      minimumSystemVersion: "10.15",
    },
    createUpdaterArtifacts: true,
    // Bundle the Buzz backend provider as a sidecar so the app can install it
    // into ~/.local/bin at runtime. Tauri resolves each platform build to the
    // matching binaries/buzz-backend-hypercli-<target-triple> staged by the
    // release workflow's "Build provider sidecar" step.
    externalBin: ["binaries/buzz-backend-hypercli"],
  },
  plugins: {
    updater: {
      pubkey: updaterPubkey,
      endpoints: [updaterEndpoint],
    },
  },
};

console.log(`Updater enabled -> ${updaterEndpoint}`);

writeFileSync(outputConfigPath, `${JSON.stringify(releaseConfig, null, 2)}\n`);
console.log(`Wrote ${outputConfigPath}`);
