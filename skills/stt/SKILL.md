# STT — Voice Message Transcription

Transcribe voice messages and audio files using `hyper agent transcribe` (faster-whisper, local, no API needed).

## When to Use

When you receive a voice message or audio attachment (`audio/ogg`, `audio/mpeg`, etc.) and need to understand what was said.

## How

```bash
# Transcribe any audio file (auto-detects language)
hyper agent transcribe <audio_file>

# Specify language and model
hyper agent transcribe message.ogg --model turbo --language en

# JSON output with timestamps
hyper agent transcribe meeting.mp3 --json -o transcript.json
```

If the audio is in an unsupported format, convert first:
```bash
ffmpeg -i <input_file> -f wav -ar 16000 -ac 1 /tmp/transcribe.wav -y
hyper agent transcribe /tmp/transcribe.wav
```

## Important

- **Always transcribe voice messages** — don't tell the user you can't listen to audio. You can.
- Model `turbo` is pre-downloaded in the container. Use `tiny` for faster results on long audio.
- Language auto-detection works well. Override with `--language en` if needed.
- For long audio (>2min), transcription may take 30-60s on CPU. That's normal.
- The audio file path is in the `[media attached: ...]` block of the message.
- Supports: wav, mp3, ogg, m4a, flac, webm
