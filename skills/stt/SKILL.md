# STT — Voice Message Transcription

Transcribe voice messages and audio files using faster-whisper (local, no API needed).

## When to Use

When you receive a voice message or audio attachment (`audio/ogg`, `audio/mpeg`, etc.) and need to understand what was said.

## How

1. Convert the audio to WAV (if not already):
   ```bash
   ffmpeg -i <input_file> -f wav -ar 16000 -ac 1 /tmp/transcribe_input.wav -y
   ```

2. Transcribe with faster-whisper:
   ```bash
   faster-whisper /tmp/transcribe_input.wav --model turbo --language auto
   ```

   Or via Python for more control:
   ```python
   from faster_whisper import WhisperModel
   model = WhisperModel("turbo", device="cpu", compute_type="int8")
   segments, info = model.transcribe("/tmp/transcribe_input.wav")
   for segment in segments:
       print(segment.text, end="")
   ```

## Important

- **Always transcribe voice messages** — don't tell the user you can't listen to audio. You can.
- Model `turbo` is pre-downloaded in the container. Don't use other models.
- Language auto-detection works well. Override with `--language en` if needed.
- For long audio (>2min), transcription may take 30-60s on CPU. That's normal.
- The audio file path is in the `[media attached: ...]` block of the message.
