---
name: hypercli-flows
description: >
  Discover and submit managed Qwen 2.1 and LTX 2.3 image/video flows using
  the server catalog, exact upstream inputs and owned media file IDs.
  Track progress and retain failed or cancelled terminal render records.
---

# HyperCLI Flows

Load `hypercli-auth` first for authentication and API-base checks. Read
`/opt/hypercli/docs/cli/commands/flow.mdx` and use `hyper flow --help`.

## Discover before submitting

Use `hyper flow catalog --json`, `hyper flow catalog --family ltx23 --json`
and `hyper flow describe FAMILY TEMPLATE --json`. Read exact input names,
types, defaults, writable flags, required media and outputs from that catalog.
Discovery reads `/agents/flow/catalog` directly without entitlement routing.
Do not create a local registry or infer entitlement from subscription metadata.

The standard catalog has exactly five templates:

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

Retain the returned render ID. `status` reports progress; `wait` retains the
terminal record and exits nonzero for failed/cancelled renders. Inspect its
result URL or error. Submission POSTs are attempted once: do not automatically
resubmit after an uncertain response. Discovery failure is not paid fallback.
Use `hyper flow list --json` for history and `hyper flow cancel RENDER_ID --yes`
only when cancellation is requested. Legacy `create` helpers remain compatibility
interfaces; prefer catalog submission for current templates.
