---
name: hypercli-flows
description: >
  Create, monitor, cancel, and download HyperCLI image and video flows. Use for
  text-to-image, image editing, text-to-video, image-to-video, first/last-frame
  video, local media uploads, reusable file IDs, flow history, or x402 flow
  checkout. Route speech generation and transcription to hypercli-voice.
---

# HyperCLI Flows

Load the `hypercli-auth` skill first for authentication, API-base checks, and
credential safety. Load `hypercli-voice` instead for current speech generation,
voice cloning/design, or local transcription.

The checked-in references are:

- `/opt/hypercli/docs/cli/commands/flow.mdx`
- `/opt/hypercli/docs/cli/commands/files.mdx`

Run `hyper flow --help` and `hyper flow <command> --help` when installed help
differs from these instructions. Do not guess flags or hard-code prices.

## Use The Right Flow

Current CLI commands:

| Need | Command | Required input |
| --- | --- | --- |
| General image generation, including text in images | `text-to-image` | prompt |
| HiDream image generation | `text-to-image-hidream` | prompt |
| Video generated from a prompt | `text-to-video` | prompt |
| Animate one image | `image-to-video` | prompt plus `--image` or `--file-id` |
| Edit or combine one to three images | `image-to-image` | prompt plus repeated `--image` or `--file-id` |
| Generate a transition between exact endpoints | `first-last-frame-video` | prompt plus start and end images/IDs |

Typical submissions:

```bash
hyper flow text-to-image "legible neon sign reading HYPER" --output json
hyper flow text-to-image-hidream "an intricate botanical observatory" --output json
hyper flow text-to-video "a slow aerial move over a frozen lake" --output json
hyper flow image-to-video "subtle head turn, locked camera" \
  --image ./portrait.png --output json
hyper flow image-to-image "put the subject in the reference style" \
  --image ./subject.png --image ./style.png --output json
hyper flow first-last-frame-video "smooth daylight-to-night transition" \
  --start ./day.png --end ./night.png --output json
```

Creation commands share `--negative/-n`, `--width/-W`, `--height/-H`,
`--notify`, `--x402`, `--amount`, and `--output/-o table|json`. Omitted optional
values are not sent. Use supported dimensions from command/backend guidance;
do not invent a resolution contract.

The CLI retains three hidden compatibility commands. They still submit flow
types, but do not appear in `hyper flow --help`:

| Compatibility flow | Inputs and result | Current guidance |
| --- | --- | --- |
| `speaking-video` | prompt, portrait image, and audio; produces lip-sync video | Use only for an existing flow workflow. Local audio duration is converted to HuMo frames at 25 fps. |
| `audio-to-text` | local/remote audio or `--file-id`; completed `result_url` points to transcription JSON | Prefer `hyper voice transcribe` from the `hypercli-voice` skill for local transcription. |
| `text-to-speech` | text plus `custom`, `design`, or `clone` mode; clone can take reference audio | Prefer `hyper voice tts`, `clone`, or `design` from the `hypercli-voice` skill. |

The Python SDK also exposes `speaking_video_wan`; there is no matching current
CLI command, so confirm it exists in the runtime flow catalog before using the
generic SDK flow call.

## Resolve Media Inputs

For a path supplied to a flow input, the CLI:

1. Expands `~` and resolves relative paths from the current directory.
2. Uploads an existing regular file with the product API.
3. Sends the returned file ID in the render request.
4. Accepts only a valid `http://` or `https://` value as a remote URL.
5. Rejects a missing path or a directory before render submission.

Prefer a readable local path over a private, expiring, signed, or
session-authenticated URL. Do not use the upload's internal storage `URL` as a
public or shareable asset.

Automatic upload is convenient for one run, but each invocation uploads again
and only prints a shortened ID. Upload once when an input will be reused:

```bash
hyper files upload ./source.png
hyper flow image-to-video "slow camera push" \
  --file-id <full-file-id> --output json
```

`hyper files upload` performs multipart upload and waits if the backend returns
`processing`; `--no-wait` returns immediately. Poll an asynchronous upload with
`hyper files get <file-id>` and do not submit it until its state is ready/done.
Upload failure detail also appears in `files get`.

Input-specific rules:

- `image-to-video`: provide exactly one of `--image` and `--file-id`. If both
  are passed, the file ID wins and the image argument is ignored.
- `image-to-image`: repeat one input option for one to three ordered images;
  the first is the main image and later inputs are references. The help says
  maximum three, but the CLI does not enforce it, so enforce the limit before
  submission. Do not mix `--file-id` with `--image`: when any `--file-id` is
  supplied, the current CLI ignores all `--image` values.
- `first-last-frame-video`: supply both endpoints with `--start/--end` or
  `--start-id/--end-id`. An ID takes precedence over the corresponding path or
  URL. Prefer one input style for both endpoints to keep ordering explicit.

## Authentication And Billing

Before a paid operation, validate the intended product identity without
printing its credential:

```bash
hyper me --output json
```

Normal creation automatically prefers entitled subscription flow access and
falls back to account-balance billing when appropriate. Do not manually retry
the request to force a different route.

Use x402 only when the user explicitly requests wallet pay-per-use:

```bash
hyper flow text-to-image "studio product photograph" --x402 --output json
```

The CLI loads the fixed price from the public flow catalog. Omit `--amount`
unless the user requires an explicit amount; a supplied amount must equal the
catalog price exactly. Do not use a remembered price.

x402 boundaries:

- x402 submission uses the embedded wallet and returns a render-scoped
  `access_key`, `status_url`, and `cancel_url`. Treat the access key as a secret;
  never paste the full table or JSON result into chat or logs.
- `--x402` on `list`, `history`, `get`, `status`, and `cancel` authenticates the
  local wallet against the backend and uses its wallet-backed user history. It
  does not read an access key from a prior command's stdout.
- Direct HTTP lifecycle calls may use the returned render-scoped access key as
  Bearer auth.
- Local uploads always use normal product authentication, even when the final
  submission uses `--x402`. In the current CLI, conditioned-flow commands
  construct that product client before resolving URLs or file IDs too. Keep a
  valid product credential configured for `image-to-video`, `image-to-image`,
  and `first-last-frame-video` with x402.
- A product `401` is an authentication failure, not a prompt or render failure.
Follow the `hypercli-auth` skill; do not retry, reveal the key, switch
identity, or switch to x402 automatically.

## Submit Once, Then Track The ID

Creation returns before rendering finishes. `pending` and `running` are
successful submissions, not reasons to create another render. Preserve the
returned `render_id` immediately.

For account-billed JSON, `render_id` is top-level. For x402 JSON, it is nested
under `render.render_id`, alongside sensitive access data. Never assume both
shapes are identical.

Use the same ID for the complete lifecycle:

```bash
hyper flow status <render-id> --output json
hyper flow status <render-id> --watch
hyper flow get <render-id> --format json
hyper flow get <render-id> --output ./result.mp4
```

Polling rules:

- For humans, `status --watch` polls about every two seconds, stops at
  `completed`, `failed`, or `cancelled`, then fetches full render detail.
- The watcher is an interactive live table. It does not emit structured JSON;
  `--watch --output json` still uses the live watcher.
- For automation, call `status --output json` repeatedly with a bounded wait
  and the same ID. After a terminal state, call `get --format json` because the
  lightweight status object has only ID, state, and progress.
- `list` and `history` query remote renders, not local state. Both accept
  `--state`, `--template`, `--type`, `--x402`, and JSON output. `history` adds a
  client-side `--limit` (default 20); prefer `list` for new automation.

If submission output is lost or a transport failure makes creation ambiguous,
inspect `flow list --output json` or `flow history --output json` under the same
auth context before retrying. There is no CLI idempotency flag. If the recent
render cannot be identified confidently, report the ambiguity and get approval
before risking a duplicate charge.

## Handle Terminal States

- `completed`: use `result_url` from `get --format json`, or download it with
  `get --output`.
- `failed`: fetch `get --format json` and report its `error`. Do not resubmit
  until the error has been understood and the user has approved another paid
  attempt.
- `cancelled`: no result will be produced. Do not poll indefinitely or
  resubmit implicitly.

`hyper flow cancel <render-id>` is immediate and has no confirmation prompt.
Only cancel when the user requested it or the established workflow requires it.

For downloads, `get --output/-o` is a destination, while `get --format/-f` is
`table|json` metadata output. Legacy `get -o json` and `get -o table` are
treated as formats. A real path named `json` or `table` therefore cannot be
used through `-o` with the default format.

If the destination already exists as a directory, the CLI derives a filename
from the result URL. Otherwise it treats the destination as the exact file path
and creates missing parent directories. Create a desired output directory
before passing it. Download before completion fails because no result URL is
available; an HTTP download failure is not evidence that the render should be
submitted again.

## SDK Automation

Use the SDK waiter when a program owns the lifecycle:

```python
from hypercli import HyperCLI

client = HyperCLI()
render = client.renders.text_to_image("a precise technical cutaway")
final = client.renders.wait(render.render_id, timeout=1800, poll_interval=2)

if final.state != "completed":
    raise RuntimeError(f"render {final.render_id} {final.state}: {final.error}")
print(final.result_url)
```

The waiter returns terminal `failed` and `cancelled` renders rather than raising
for those states, so always inspect `state` and `error`. A timeout raises
`TimeoutError`; it does not imply the remote render was cancelled or absent.
The SDK may extend a timeout with bounded queue and recently-started grace, and
it uses the same subscription-first/account-billed routing as the CLI.
