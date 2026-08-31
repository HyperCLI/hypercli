# buzz-acp

Compatibility binary for the Hyper ACP Buzz plugin.

The implementation lives in `../buzz`. This package exists only for callers
that still invoke an executable named `buzz-acp`; `src/main.rs` delegates to the
shared plugin entrypoint.
