# hyper-acp

Thin host transport for canonical Agent Client Protocol JSON-RPC frames.

## Buzz Plugin

`hyper-acp plugin buzz` links the `hyper-acp-buzz` plugin crate and runs it
in-process. The separate `buzz-acp` executable is retained only as a
compatibility wrapper over the same plugin library, not as an external runtime
dependency for `hyper-acp`.

## Provenance

This crate is derived from the copied upstream Agent Client Protocol workspace
and depends on the local `agent-client-protocol-schema` crate for canonical ACP
types. It does not redefine ACP request, response, notification, batch, session,
or turn shapes.

## License

Apache-2.0, matching the copied ACP schema workspace.
