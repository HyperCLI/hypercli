# Voice — TTS & Voice Cloning

You have `hyper claw voice` installed. It calls the HyperClaw Voice API (GPU-backed Qwen3-TTS) to generate speech audio. No extra setup needed — your API key handles auth automatically.

## Voice Cloning

Clone any voice from a short reference audio sample (~5-30s). The model extracts the speaker's voice characteristics and generates new speech in that voice.

```bash
# Clone a voice from reference audio
hyper claw voice clone "Your text here" --ref /path/to/reference.wav -o output.ogg

# Specify language (auto-detected by default)
hyper claw voice clone "Bonjour le monde" --ref ref.wav -l french -f ogg -o hello.ogg
```

**Reference audio tips:**
- Any format works: wav, mp3, ogg, m4a
- 5-30 seconds of clean speech is ideal
- Less background noise = better clone quality
- `--x-vector-only` is on by default (recommended — prevents reference text from bleeding into output)

## Standard TTS (Preset Voices)

Generate speech with built-in voices (no reference audio needed):

```bash
hyper claw voice tts "Hello world" -o output.ogg
hyper claw voice tts "Welcome" --voice Etienne -f opus -o welcome.opus
```

Available voices: Chelsie (default), Etienne, and others.

## Voice Design

Describe a voice in text and the model creates it:

```bash
hyper claw voice design "Hello" --desc "deep male voice, British accent, warm tone" -o designed.ogg
```

## Common Patterns

```bash
# Generate a voice note for chat (save as .ogg for Telegram/WhatsApp)
hyper claw voice clone "Status update: deployment complete." --ref ~/voice_ref.wav -f ogg -o /tmp/update.ogg

# Chain with STT: transcribe incoming audio, respond with cloned voice
hyper claw stt transcribe incoming.ogg > /tmp/transcript.txt
hyper claw voice clone "$(cat response.txt)" --ref ~/my_voice.wav -f ogg -o reply.ogg
```

## Output Formats

`wav` | `mp3` | `opus` | `ogg` | `flac`

Use `ogg` for voice messages in chat apps.

## Notes

- API key is read from `~/.hypercli/claw-key.json` (auto-configured on agent boot)
- Runs on HyperClaw GPU backend — typical response time 5-15s
- Long text is automatically chunked into ~2 sentence windows for quality
- For very long text, consider splitting into paragraphs and concatenating with ffmpeg
