# Agent chat setup

```sh
hyper agents chat <agent> 'Use the MCP tools' --cwd /workspace/project --mcp-servers servers.json
hyper agents chat <agent> 'Continue' --session <session-id> --cwd /workspace/project --mcp-servers servers.json
cat servers.json | hyper agents chat <agent> 'Use the MCP tools' --mcp-servers -
```

`--cwd` is the working directory on the agent, passed unchanged to ACP session
setup. `--mcp-servers` reads a local UTF-8 JSON file (or `-` for stdin). Both
options apply to new sessions and `--session` resume. Omitted options use the
SDK defaults. Supply the desired MCP setup again when resuming.

The file is a vanilla ACP v1 MCP server array, for example:

```json
[
  {"name":"local-tools","command":"/opt/tools/mcp-server","args":[],"env":[]},
  {"type":"http","name":"http-tools","url":"https://tools.example/mcp","headers":[]},
  {"type":"sse","name":"sse-tools","url":"https://tools.example/sse","headers":[]}
]
```

Stdio entries have no `type` field. Environment entries and headers use
`{"name":"KEY","value":"VALUE"}` pairs. An empty array is valid. The CLI checks
JSON shape; the peer decides which transports and setup it supports.
