# Deployment file transports

Use the ordinary SDK file methods for every deployment. The authenticated
`POST /deployments/{id}/files/token` response selects the transport; callers
must not branch on placement, guess a hostname, or open a runner HTTP port.

| SDK | Bytes | UTF-8 text |
| --- | --- | --- |
| Python | `agent.files.read_bytes/write_bytes` or `deployments.file_read_bytes/file_write_bytes` | `agent.files.read/write` or `deployments.file_read/file_write` |
| TypeScript | `agent.files.readBytes/writeBytes` or `deployments.fileReadBytes/fileWriteBytes` | `agent.files.read/write` or `deployments.fileRead/fileWrite` |
| Rust | `read_deployment_file_bytes/put_deployment_file` | `read_deployment_file/put_deployment_file_text` |

Paths are relative to retained storage: the configured sync root for hosted
Reef, and the registered default assignment workspace for native runners.
All SDKs normalize backslashes as separators (existing hosted compatibility),
remove `.` components and duplicate/trailing separators, and reject leading
slashes, Windows drive paths, NUL and any `..` component. Percent escapes are
literal filename text: `a%2Fb` is not `a/b`. Native paths additionally follow
the backend's portable-name rules (no colon or trailing dot/space, maximum
4096 UTF-8 bytes). No SDK exposes arbitrary host-absolute paths.

Hosted bytes use HTTPS GET/PUT directly to the discovered Reef locator using
its short-lived token. Reads are bounded at 250 MiB; writes at the SDK's
100 MiB edge limit. Native bytes use authenticated backend REST with base64;
the backend forwards them over the runner's existing outbound control WS.
Native reads and writes are bounded at 256 KiB decoded, regardless of the
hosted limits. UTF-8 readers preserve a leading BOM as U+FEFF and replace
malformed UTF-8 subsequences with U+FFFD (replacement characters); byte readers are exact
and never reinterpret JSON content as a directory listing.

Python and TypeScript list/delete methods discover transport too. Native
listing/deletion returns HTTP-style 501 unsupported, since that runner
protocol only implements read/write. Existing Python/TypeScript copy helpers
delegate to these same byte methods. Rust's deployment-file surface exposes
listing and read/write; it has no deployment delete/copy helper.

Docker assignments, unknown assignment executors, and custom native
workspaces remain unsupported. A Docker runtime is not mapped to host files
or silently redirected to Reef. Backend HTTP statuses remain observable via
the SDK's existing error type. Local validation/malformed responses use each
language's existing validation error conventions.
Runner registration has no file-capability advertisement or version negotiation.
For an eligible peer that cannot execute a file command, the existing explicit
unsupported response, disconnection or receipt timeout is surfaced to the caller;
discovery does not fabricate successful file support.

## Desktop caller contract (TypeScript)

Use `filesList`, `fileReadBytesWithMetadata`, `fileRead`, `fileWriteBytes`,
`fileWrite` and `fileDelete` (or the bound `Agent.files` equivalents) without
placement checks. `cpTo/cpFrom` are Node/local-filesystem conveniences.

| Method | Hosted | Native Process |
| --- | --- | --- |
| list | `AgentFileEntry[]` | `APIError(501, "Runner file listing and deletion are not supported")` |
| read bytes | `Uint8Array` | `Uint8Array` |
| read metadata | `{content, mimeType?}` | `{content}`; MIME is unavailable, not fabricated |
| read text | UTF-8 string | UTF-8 string |
| write | Existing Reef acknowledgement `{status, path, size}` | Existing runner acknowledgement `{ok: true}` |
| delete | Existing Reef acknowledgement | Same explicit 501 as list |

There is no separate stat/metadata request for native files. A sidebar that
needs enumeration must present the unsupported-list capability; it cannot
invent an empty directory or infer that the known-path read/write methods
are unavailable too. Docker has no supported file operations. When discovery
reaches the executor check, it returns 501 with detail
`Docker runner files have no host workspace mapping`. Earlier authorization,
assignment/state and liveness checks take precedence: a Docker request can
instead return 404, 409 or 503. A 503 is not a capability verdict.

For HTTP failures, TS callers inspect `APIError.statusCode` and `detail`:
404 means missing/inaccessible (native missing file detail is exactly
`Runner file not_found`); 409 unavailable state/assignment; 413 file too large;
429 busy; 501 unsupported; 502 runner I/O failure; 503 offline/disconnected;
504 timeout with potentially unknown write outcome. Local path/size and
malformed-response failures remain ordinary `Error`, as in the existing SDK.
Malformed discovery never triggers another transport. Readiness helpers also
discover transport, probing a known path when native listing is unsupported.
Both probes use the requested consecutive-success count, reset on transient
failures, and wait between attempts until their deadline. An exact native
`Runner file not_found` response counts as a successful filesystem probe.

Discovery responses are strict alternatives: exactly `url/token/expires_at`
for Reef or `transport/executor/max_bytes` for native. Unknown or mixed fields
are rejected consistently across SDKs, rather than guessed or ignored.
File discovery and native read/write HTTP requests reject redirects, including
307/308: neither credentials nor file bodies are sent to redirect receivers.
This opt-in redirect policy does not change unrelated HTTPClient requests.

Native writes make one HTTP attempt. A disconnect or timeout can happen after
replacement committed: the outcome is unknown, and the SDK does not replay
the write over a possible intervening edit. Read back and reconcile explicitly.
There is no compare-and-swap or multi-file transaction.

The shared test vectors have one canonical source at
`rs-sdk/tests/fixtures/agent-file-contract.json`. Keeping it inside the Rust
crate includes it in Cargo packages; Python and TypeScript read that same
fixture directly. The Rust hosted HTTPS test also packages its loopback fixture
at `rs-sdk/tests/fixtures/reef_https.py` (requires Python 3 and OpenSSL).
