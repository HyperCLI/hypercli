---
name: hypercli-voice
description: >
  Generate speech with HyperCLI text-to-speech through hyper voice tts,
  save the audio with --out, and handle voice API errors and identity checks.
  Use for CLI speech generation and voice-capability validation.
---

# HyperCLI Voice

Load the `hypercli-auth` skill before making a remote request. It defines
the canonical authentication and credential-safety rules. Read
`/opt/hypercli/docs/cli/commands/voice.mdx` when exact flags matter, and
run `hyper voice tts --help` against the installed CLI before relying on
remembered options.

## Text-to-speech

The voice surface is a single command:

```bash
hyper voice tts "Hello world"
hyper voice tts "The deployment is complete." --out deployment.mp3
```

Without `--out`, the CLI writes a default output file in the current
directory; always pass an explicit destination path in automated work. The
spoken text is sent to the remote service — do not submit private material
without the user's intent.

## Preflight

1. Confirm the text, destination path, and that the user expects a remote
   voice call.
2. Validate the identity and voice capability with `hyper me`; a valid
   account without the voice capability will fail.
3. Treat synthesis text as remote disclosure, matching the rules in
   `hypercli-auth`.

## Failure handling

- Missing credentials: run `hyper configure` or set `HYPER_API_KEY`; do not
  search for, print, or substitute another key.
- `401` or `403`: stop and report the status and server detail. Retries do
  not repair authorization — follow `hypercli-auth`.
- Failed remote call: report whether the destination is absent, complete,
  or partial before retrying; the server may have completed work after the
  client lost the response, so do not blindly resubmit.
- File write failure: choose a writable destination with enough space and
  an existing or creatable parent directory.
- Report the output path and whether the result is complete. Never claim
  success just because the request started.
