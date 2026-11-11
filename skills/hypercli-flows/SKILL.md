---
name: hypercli-flows
description: >
  Generate images and videos with managed media flows (Qwen 2.1 and LTX 2.3
  families today). Use for hyper flow catalog and describe discovery,
  hyper files upload for owned render-input media IDs, exact-input
  submit-once rendering, and tracking renders with status, wait, get,
  list, and gated cancel to completed, failed, or cancelled terminal
  states. Not for durable file storage or shared knowledge workspaces;
  that is the hypercli-knowledge surface.
commands:
  - hyper flow --help
  - hyper flow catalog --json
  - hyper flow describe FAMILY TEMPLATE --json
  - hyper flow submit qwen21 image_qwen_image_2_1_t2i --input 'prompt=42' --input seed=0 --json
  - hyper files upload ./frame.png
  - hyper flow submit ltx23 video_ltx2_3_ia2v --input 'value=a presenter speaking' --media input=OWNED_IMAGE_ID --media audio=OWNED_AUDIO_ID --json
  - hyper flow status RENDER_ID --json
  - hyper flow wait RENDER_ID --timeout 600 --json
  - hyper flow list --json
  - hyper flow cancel RENDER_ID --yes
---

# HyperCLI Flows

Load `hypercli-auth` first for authentication and API-base checks. Read
`/opt/hypercli/docs/cli/commands/flow.mdx` and use `hyper flow --help`.
Use `hyper files upload` here only to obtain an owned render-input file ID;
when a file outlives the render — durable storage, inspection, deletion, or
shared knowledge — load the `hypercli-knowledge` skill.

## Complete command map

| Area | Commands |
| --- | --- |
| Discover | `hyper flow catalog`, `hyper flow describe` |
| Submit | `hyper flow submit` |
| Track | `hyper flow status`, `hyper flow wait`, `hyper flow get`, `hyper flow list` |
| Control | `hyper flow cancel` |
| Render inputs | `hyper files upload` (owned media IDs for submission) |
| Compatibility | `hyper flow create` (typed flags, `--param`, `--dry-run`) |

## Discover before submitting

Use `hyper flow catalog --json`, `hyper flow catalog --family ltx23 --json`
and `hyper flow describe FAMILY TEMPLATE --json`. Read exact input names,
types, defaults, writable flags, required media and outputs from that catalog.
Discovery reads `/agents/flow/catalog` directly without entitlement routing.
Do not create a local registry or infer entitlement from subscription metadata.

The standard catalog currently publishes five templates:

| Family | Template |
| --- | --- |
| `qwen21` | `image_qwen_image_2_1_t2i` |
| `qwen21` | `image_qwen_image_2_1_image_edit` |
| `ltx23` | `video_ltx2_3_t2v` |
| `ltx23` | `video_ltx2_3_i2v` |
| `ltx23` | `video_ltx2_3_ia2v` |

These are standard Qwen templates, not separately named distilled variants.
The live deployment catalog determines availability.

## Submit and track

```bash
hyper flow submit qwen21 image_qwen_image_2_1_t2i \
  --input 'prompt=42' --input seed=0 --input switch=false --json
hyper files upload ./frame.png
hyper files upload ./speech.wav
hyper flow submit ltx23 video_ltx2_3_ia2v \
  --input 'value=a presenter speaking' \
  --media input=OWNED_IMAGE_ID --media audio=OWNED_AUDIO_ID \
  --input noise_seed=0 --input start_index=0 --input value_4=9 --json
hyper flow status RENDER_ID --json
hyper flow wait RENDER_ID --timeout 600 --json
```

Descriptor STRING inputs remain strings even for `42`; JSON scalar values
preserve `false` and `0`. Dotted input names remain literal keys. Submit only
writable inputs. Media must use owned file IDs from `hyper files upload`, not
URLs, paths or inline data. Labels are not aliases for upstream names.

IA2V uses `value` (prompt), `input` (first frame), `audio`, `noise_seed`,
`start_index` (audio start) and `value_4` (duration). Qwen edit's fifth image
is `images.image_5_1`, not `images.image_5`.

Retain the returned render ID. `status` reports progress; pending and running
are transitional — an accepted render is a successful submission, never a
reason to create another. Terminal states are `completed`, `failed` and
`cancelled`: `wait` retains the terminal record and exits nonzero for
failed/cancelled renders, and a failed or cancelled render produces no
result. Inspect its result URL or error. Submission POSTs are attempted once:
do not automatically resubmit after an uncertain response. Discovery failure
is not paid fallback. Use `hyper flow list --json` for history and
`hyper flow cancel RENDER_ID --yes` only when cancellation is requested;
after a cancel, confirm the terminal state with `status`. Legacy `create`
helpers remain compatibility interfaces; prefer catalog submission for current
templates.

## Failures

- Auth rejection (`401`): stop; do not retry or guess alternates. Route to
  `hypercli-auth`.
- Capability missing (`403`): restricted keys are not widened. Re-read
  capabilities with `hyper me`; never swap credentials unbidden.
- Transport ambiguity after submit: verify with `hyper flow list --json`
  under the same auth context before any retry — one duplicate submission
  can bill twice.
- State confusion: an accepted pending/running render is not a result;
  confirm with `status` or `wait` before acting on it.
- Version drift: when `hyper flow --help` or the managed reference
  contradicts this skill, follow the help, act, and report the drift.
