---
name: hypercli-flows
description: >
  Create, monitor, wait on, and cancel HyperCLI image and video flows, and
  upload reusable pipeline inputs with hyper files upload. Use for hyper
  flow create across the current flow types, flow list/status/wait
  tracking, and cancelled or failed render handling.
---

# HyperCLI Flows

Load the `hypercli-auth` skill first for authentication, API-base checks,
and credential safety. Load `hypercli-voice` instead for speech generation.

The checked-in references are:

- `/opt/hypercli/docs/cli/commands/flow.mdx`
- `/opt/hypercli/docs/cli/commands/files.mdx`

Run `hyper flow --help` and `hyper flow create <type> --help` when installed
help differs from these instructions. Do not guess flags or hard-code
prices.

## Use The Right Flow Type

```bash
hyper flow create <type> --help
```

| Need | Type |
| --- | --- |
| General image generation, including text in images | `text-to-image` |
| HiDream image generation | `text-to-image-hidream` |
| Video generated from a prompt | `text-to-video` |
| Animate one image | `image-to-video` |
| Edit or combine images | `image-to-image` |
| Generate a transition between exact endpoint frames | `first-last-frame-video` |

Legacy types `speaking-video`, `audio-to-text`, and `text-to-speech` remain
accepted for existing workflows. For speech generation prefer
`hyper voice tts` from the `hypercli-voice` skill over the legacy
`text-to-speech` flow type.

## Submit with parameters

Creation accepts per-type flags or generic key/value parameters:

```bash
hyper flow create text-to-image --param prompt="a neon sign reading HYPER"
hyper flow create text-to-video --param prompt="slow aerial move over a frozen lake" --json
```

Confirm the exact per-type flags and parameter names from
`hyper flow create <type> --help`; do not invent a resolution or sizing
contract. Where a type takes an input image, pass a readable local path or
a previously uploaded file ID exactly as the help describes.

## Reusable file inputs

Each submission that references a local path uploads it again. Upload once
when an input will be reused:

```bash
hyper files upload ./source.png
hyper files get <file-id>
hyper files delete <file-id>
```

Keep the returned file ID from `upload`; poll `get` until processing is
done before referencing the ID in a flow, and read failure detail from the
same `get` output. `delete` needs approval: removing a file can break
pending or reproducible renders.

## Submit once, then track the ID

Creation returns before rendering finishes. A queued or running state is a
successful submission, not a reason to create another render. Record the
returned render ID immediately and use the same ID for the complete
lifecycle:

```bash
hyper flow list
hyper flow list --json
hyper flow status <render-id>
hyper flow wait <render-id>
```

- `status` reports the current state; after completion it carries the
  result location from the render detail.
- `wait` blocks until a terminal state and is the right call when the next
  step depends on completion. Check whether it ended completed, failed, or
  cancelled.
- `list` queries remote renders under the active auth context. If
  submission output was lost or a transport failure makes creation
  ambiguous, inspect `hyper flow list --json` before any retry: there is no
  idempotency flag, and an unverified retry can double a charge.

## Cancel and terminal states

```bash
hyper flow cancel <render-id>
```

`cancel` is immediate with no confirmation prompt. Cancel only when the
user requested it or the established workflow requires it.

On `failed`, read the error from the render detail before resubmitting, and
get approval before another paid attempt. On `cancelled`, no result will be
produced — do not poll indefinitely or resubmit implicitly.

## Identity and billing

Before a paid operation, validate the intended product identity without
printing its credential:

```bash
hyper me --json
```

A `401` is an authentication failure, not a prompt or render failure.
Follow the `hypercli-auth` skill; do not retry, reveal the key, or switch
identity automatically.
