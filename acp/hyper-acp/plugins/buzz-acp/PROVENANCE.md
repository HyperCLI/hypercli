# Buzz ACP compatibility binary provenance

This package is not the Buzz implementation.

The Buzz implementation lives in `../buzz` as the `hyper-acp-buzz` plugin crate.
This package retains only the `buzz-acp` executable name for existing Buzz
desktop/provider callers and delegates to `hyper_acp_buzz::run_compat_binary()`.

No relay, queue, owner-command, auth/membership, prompt gating, observer,
setup, usage, or session-pool logic should live in this package.
