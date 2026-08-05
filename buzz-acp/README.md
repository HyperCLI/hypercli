# HyperCLI Buzz ACP

This package is HyperCLI's maintained hosted-runtime variant of Block's
Apache-2.0 `buzz-acp` crate. The Cargo package is named
`hypercli-buzz-acp`, while the installed executable deliberately remains
`buzz-acp`: Buzz Desktop and the managed runtime images launch that stable
binary name.

The source baseline and upstream tag are pinned in `Cargo.toml`. Update the
three Buzz git dependencies together, reapply only the hosted-runtime delta,
and run the crate tests before advancing that pin. This keeps upstream fixes
visible without requiring HyperCLI to maintain a full Buzz application fork.
