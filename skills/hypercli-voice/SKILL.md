---
name: hypercli-voice
description: >
  Generate speech with preset, cloned, or designed voices; stream voice audio;
  and transcribe local audio with HyperCLI. Use for hyper voice CLI work,
  Python or TypeScript voice SDK integration, voice-reference handling,
  output-format selection, local faster-whisper STT, and voice API errors.
---

# HyperCLI Voice

Load the `hypercli-auth` skill before making a remote request. It defines the
canonical authentication and credential-safety rules. Read
`/opt/hypercli/docs/cli/commands/voice.mdx` when exact flags or routes matter,
and run `hyper voice <command> --help` against the installed CLI before relying
on remembered options.

## Use the canonical surface

Use `hyper voice ...` in every new command, script, and answer:

```bash
hyper voice tts "Hello world" --output hello.mp3
hyper voice clone "Hello" --ref voice.wav --output cloned.mp3
hyper voice design "Hello" --desc "deep, warm British narrator" --output designed.mp3
hyper voice transcribe message.ogg --output transcript.txt
```

`hyper agent voice ...` is currently registered as a compatibility alias, but
do not teach or emit it. `hyper agent transcribe ...` has been removed. This
distinction corrects older HyperCLI material that put generation under
`hyper agent voice` while putting transcription elsewhere.

Choose the operation by intent:

| Intent | Surface | Execution and authentication |
| --- | --- | --- |
| Preset text-to-speech | `hyper voice tts` | Remote `/agents/voice/tts`; requires `voice:*` |
| Clone from reference audio | `hyper voice clone` | Remote `/agents/voice/clone`; requires `voice:*` |
| Design from a description | `hyper voice design` | Remote `/agents/voice/design`; requires `voice:*` |
| Transcribe an audio file | `hyper voice transcribe` | Local faster-whisper; no HyperCLI API key |

The CLI offers streaming only for preset TTS. Use the Python or TypeScript SDK
when clone or design streaming is required.

## Remote preflight

Before TTS, clone, or design:

1. Confirm the requested text, voice mode, language, format, and destination.
2. Follow `hypercli-auth` to validate the current product identity and API base.
   The key must have the public `voice:*` capability.
3. Prefer `hyper configure` or `HYPER_API_KEY` over `--key`; a command-line key
   can leak through shell history and process inspection.
4. Treat both synthesis text and clone reference audio as data sent to the
   remote subscription service. Do not send private material without the
   user's intent.
5. For cloning, verify that the user owns or has permission to reproduce the
   voice. Do not facilitate impersonation, deception, or bypassing consent.

CLI key resolution is explicit `--key`, then configured product credentials,
then `HYPER_AGENTS_API_KEY`/legacy agent-key compatibility fallbacks. Base
resolution is `--base-url`, `HYPER_API_BASE`, `HYPERCLI_API_URL`, then
`https://api.hypercli.com`; the CLI derives the agents HTTP and WebSocket
endpoints from that product base. For this CLI group, do not assume
`AGENTS_API_BASE_URL` or `AGENTS_WS_URL` overrides the product-base derivation.
Do not paste credentials into logs while diagnosing a failure.

## Preset TTS

```bash
# Defaults: voice=serena, language=auto, format=mp3
hyper voice tts "The deployment is complete." --output deployment.mp3

# Select a server-side CustomVoice preset and language
hyper voice tts "Bonjour tout le monde" \
  --voice eric --language french --format opus --output bonjour.opus

# Receive server-rendered chunks as they arrive
hyper voice tts "A longer spoken update." \
  --stream --timeout 600 --format mp3 --output update.mp3
```

`--voice` is a server-side CustomVoice name. `serena` is the CLI default, but
there is no CLI command that lists every accepted preset. Do not copy obsolete
voice names from older skills or invent one; use a user-specified name or the
default, and report a server rejection accurately.

Non-streaming TTS waits for the complete response in memory and then writes the
file. `--stream` connects to the derived agents `/ws/voice` endpoint and writes
each ordered audio chunk directly to the destination. Streaming improves
time-to-first-audio and progress visibility; it does not play audio and it can
leave a partial file after an error.

## Voice cloning

```bash
hyper voice clone "This is the synthesized line." \
  --ref ./reference.wav \
  --language english \
  --format mp3 \
  --output ./generated/cloned.mp3
```

The CLI advertises WAV, MP3, and OGG reference files. It checks that `--ref`
exists, then the Python SDK reads the entire file, base64-encodes it as
`ref_audio_base64`, and sends it in JSON. Ensure the file is readable and avoid
needlessly large references because both the raw bytes and base64 form occupy
memory. Prefer clean, single-speaker reference speech with little noise.

`--x-vector-only` is enabled by default and is the recommended mode. Keep it
unless the user explicitly requests `--full-clone` and understands that the
full mode can condition more strongly on the reference content. The default
reduces the risk that words spoken in the reference bleed into the result.

The CLI has no `--stream` flag for cloning. For streaming clone output, use
`client.voice.clone_stream(...)` in Python or `client.voice.cloneStream(...)`
in TypeScript.

## Voice design

```bash
hyper voice design "Welcome to the evening briefing." \
  --desc "calm middle-aged radio presenter, clear diction, neutral accent" \
  --language english \
  --format flac \
  --output presenter.flac
```

`--desc` is required. Describe stable audible traits such as age range, vocal
weight, pace, energy, accent, and delivery; keep the text to be spoken in the
positional `TEXT` argument. The SDK maps `description` to the API's `instruct`
field. The CLI does not stream design requests; use `design_stream` or
`designStream` when needed.

## Output and file handling

Remote generation advertises `wav`, `mp3`, `opus`, `ogg`, and `flac`. The
default is `mp3`; when `--output` is absent, all three CLI generation commands
write `output.<format>` in the current directory.

Always use an explicit, format-matching output path in automated work:

```bash
hyper voice tts "Ready." --format ogg --output artifacts/ready.ogg
```

The CLI creates missing parent directories but silently overwrites an existing
destination. It does not infer format from the filename and does not validate
the response's media type, so `--format wav --output result.mp3` still requests
WAV bytes with a misleading name. Request the desired format; use a media tool
for real conversion instead of renaming an extension.

For streamed output, write to a unique temporary path and promote it only after
a zero exit status if a partial artifact would be harmful:

```bash
tmpdir="$(mktemp -d)"
hyper voice tts "Long update" --stream --format mp3 \
  --output "$tmpdir/update.mp3" && mv "$tmpdir/update.mp3" update.mp3
rm -rf "$tmpdir"
```

## Local transcription

```bash
# Auto-detect language; plain transcript goes to the file
hyper voice transcribe message.ogg --output transcript.txt

# Higher-quality model and an explicit language code
hyper voice transcribe meeting.m4a \
  --model large-v3 --language en --output meeting.txt

# Machine-readable timestamps
hyper voice transcribe interview.wav \
  --json --device cpu --compute int8 --output interview.json
```

The input must be a readable local file. Common decoder-supported inputs
include WAV, MP3, OGG, M4A, FLAC, and WebM, although actual decoding depends on
the installed faster-whisper/FFmpeg stack. Convert an unreadable input first:

```bash
ffmpeg -i input.audio -ar 16000 -ac 1 /tmp/transcribe.wav -y
hyper voice transcribe /tmp/transcribe.wav --output transcript.txt
```

Defaults are model `turbo`, device `auto`, compute type `auto`, and language
auto-detection. Accepted model names in current help are `tiny`, `base`,
`small`, `medium`, `large-v3`, and `turbo`; device choices are `auto`, `cpu`,
and `cuda`. Auto compute resolves to `int8` on CPU and `float16` on CUDA. An
uncached model may require an initial model download even though transcription
itself does not call the HyperCLI voice API.

Without `--json`, output is one joined plain-text transcript. With `--json`,
the result contains `language`, `language_probability`, `duration`, `segments`
with `start`, `end`, and `text`, plus the joined `text`. Use `--output` for
automation: progress and language-detection messages also go to the console,
so raw stdout redirection or command substitution is not a clean transcript
transport.

If faster-whisper is missing, install the supported extra shown by the CLI:

```bash
pip install 'hypercli-cli[stt]'
# or install all optional CLI features
pip install 'hypercli-cli[all]'
```

## SDK behavior

Use the SDK when audio must stay in memory, cancellation is important, or
clone/design streaming is required.

Python synchronous methods return `bytes`; clone references may be `bytes`, a
string path, or `Path`. The default voice timeout is 300 seconds, overrideable
per call or with `HYPER_VOICE_TIMEOUT_SECONDS`; the CLI's `--timeout` forwards
the same seconds-based override:

```python
from pathlib import Path
from hypercli import HyperCLI

client = HyperCLI()
audio = client.voice.clone(
    "Release complete.",
    ref_audio=Path("reference.wav"),
    language="english",
    response_format="mp3",
    timeout=600,
)
Path("release.mp3").write_bytes(audio)
```

Python provides `tts_stream`, `clone_stream`, and `design_stream` one-shot
async iterators. For multiple sequential requests, reuse `client.voice.connect()`
and call `session.speak`, `speak_clone`, or `speak_design`. A session handles
one request at a time. Each `VoiceChunk` has `request_id`, `index`, `total`,
`audio`, and `final`; breaking early sends a cancel frame.

TypeScript REST methods return `Uint8Array`. `clone` accepts `Uint8Array` or
`ArrayBuffer`, while streaming methods are `ttsStream`, `cloneStream`, and
`designStream`. Streaming sessions default to 300,000 ms. Node authenticates
the WebSocket with an Authorization header; browsers put the credential in the
encoded `?jwt=` query because browser WebSockets cannot set headers. Use only a
trusted endpoint and avoid URL logging when streaming from a browser.

Both SDKs expose direct sessions with `chunks=false` to request one assembled
audio payload. The one-shot streaming conveniences request ordered server-side
chunks. Server `error` frames become `VoiceStreamError`; an early break or
timeout attempts server-side cancellation.

## Failure handling

- Missing remote credentials: configure a product key; do not search for,
  print, or substitute another user's key.
- `401` or `403`: stop and report the status and server detail. Check the
  selected identity and `voice:*`; retries do not repair authorization.
- Other `4xx`: correct the rejected voice, language, format, text, or clone
  reference. The CLI performs little client-side validation and reports at
  most the first 500 characters of an API error detail.
- Timeout or connection loss: report whether the destination is absent,
  complete, or partial. Do not blindly resubmit a subscription request because
  the server may have completed work after the client lost the response. The
  Python HTTP transport already retries proxy, connection, and read-timeout
  failures up to three total attempts.
- Streaming error: preserve the reported `code` and detail. Remove or clearly
  label a partial output before retrying.
- Missing transcription file: fix the local path. Missing faster-whisper: use
  the supported install extra. Decoder/model/device failures are local and are
  not fixed by changing API credentials.
- File write failure: choose a writable destination with enough space; the CLI
  creates parent directories but cannot repair permissions.

Report the command mode, requested format, output path, and whether the result
is complete. Never claim success based only on a request starting or a stream
producing its first chunk.
