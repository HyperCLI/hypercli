---
name: hypercli-voice
description: >
  Generate speech by cloning a reference voice with hyper voice clone
  (--file or --url reference audio, saved with --out), transcribe audio
  with hyper voice transcribe, and preflight the voice capability with
  hyper me. Use for CLI speech generation, voice cloning, and
  speech-to-text; preset TTS and VoiceDesign commands are removed.
  Credential rules are owned by hypercli-auth.
---

# HyperCLI Voice

Load the `hypercli-auth` skill before making a remote request. It defines
the canonical authentication and credential-safety rules. Read
`/opt/hypercli/docs/cli/commands/voice.mdx` when exact flags matter, and
run `hyper voice clone --help` against the installed
CLI before relying on remembered options.

Synthesis requires real reference audio. Preset TTS and VoiceDesign commands
have been removed; do not fabricate a reference or substitute a named preset.

## Complete command map

| Area | Command |
| --- | --- |
| Reference voice cloning | `hyper voice clone` |
| Speech-to-text | `hyper voice transcribe` |

## Preflight

1. Confirm the inputs, destination path, and that the user expects a remote
   voice call.
2. Validate the identity and voice capability with `hyper me`; a valid
   account without the voice capability will fail.
3. Treat synthesis text, clone reference audio, and transcription audio as
   remote disclosure, matching the rules in `hypercli-auth`.

## Voice Clone

```bash
hyper voice clone "Hello world" --file reference.wav --out cloned.mp3
hyper voice clone "Hello world" --url https://example.com/reference.wav --out cloned.mp3
```

Provide exactly one reference source: `--file` for local audio or `--url` for
client-side HTTPS download before the SDK sends reference bytes. Use `--out` in
automated work and whenever `--json` is requested. Treat clone reference audio as
remote disclosure.

## Voice Transcribe

```bash
hyper voice transcribe speech.wav --language en --out transcript.txt
```

Transcription turns existing audio into text and needs no reference audio.
`--rest` posts to `/agents/voice/transcribe` instead of the agents WebSocket.

## Failure handling

- Missing credentials: stop; follow `hypercli-auth` for credential resolution.
  Do not search for, print, or substitute another key.
- `401` or `403`: stop and report the status and server detail. For `403`,
  re-check the voice capability with `hyper me`. Retries do not repair
  authorization — follow `hypercli-auth`.
- Failed remote call: report whether the destination is absent, complete,
  or partial before retrying; the server may have completed work after the
  client lost the response, so do not blindly resubmit.
- File write failure: choose a writable destination with enough space and
  an existing or creatable parent directory.
- Report the output path and whether the result is complete. Never claim
  success just because the request started.
