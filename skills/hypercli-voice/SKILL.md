---
name: hypercli-voice
description: >
  Generate speech with HyperCLI reference voice cloning,
  save audio with --out, and handle voice API errors and identity checks.
  Use for CLI speech generation, clone reference handling, and
  voice-capability validation.
---

# HyperCLI Voice

Load the `hypercli-auth` skill before making a remote request. It defines
the canonical authentication and credential-safety rules. Read
`/opt/hypercli/docs/cli/commands/voice.mdx` when exact flags matter, and
run `hyper voice clone --help` against the installed
CLI before relying on remembered options.

Synthesis requires real reference audio. Preset TTS and VoiceDesign commands
have been removed; do not fabricate a reference or substitute a named preset.

## Voice Clone

```bash
hyper voice clone "Hello world" --file reference.wav --out cloned.mp3
hyper voice clone "Hello world" --url https://example.com/reference.wav --out cloned.mp3
```

Provide exactly one reference source: `--file` for local audio or `--url` for
client-side HTTPS download before the SDK sends reference bytes. Use `--out` in
automated work and whenever `--json` is requested. Treat clone reference audio as
remote disclosure.

## Preflight

1. Confirm the text, destination path, and that the user expects a remote
   voice call.
2. Validate the identity and voice capability with `hyper me`; a valid
   account without the voice capability will fail.
3. Treat synthesis text and clone reference audio as remote disclosure,
   matching the rules in `hypercli-auth`.

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
