# Voice — TTS & Voice Cloning

Text-to-speech and voice cloning via HyperClaw API (`hyper claw voice`).

## When to Use

When you need to generate speech audio — narration, voice messages, voice cloning from a reference sample.

## Voice Cloning

Clone a voice from a reference audio file:

```bash
# Clone voice (recommended: x-vector-only mode, no ref text bleed)
hyper claw voice clone "Text to speak" --ref reference.wav -o output.mp3

# Specify language and format
hyper claw voice clone "Bonjour le monde" --ref ref.wav -l french -f ogg -o hello.ogg

# Full clone (uses reference text — may bleed into output)
hyper claw voice clone "Hello" --ref ref.wav --full-clone
```

## Standard TTS (Preset Voices)

Use a built-in voice (no reference audio needed):

```bash
# Default voice (Chelsie)
hyper claw voice tts "Hello world" -o hello.mp3

# Choose a voice
hyper claw voice tts "Welcome" --voice Etienne -f opus -o welcome.opus
```

## Voice Design

Generate speech with a text-described voice (GPU only):

```bash
hyper claw voice design "Hello" --desc "deep male voice, British accent" -o designed.mp3
```

## Output Formats

Supported: `wav`, `mp3`, `opus`, `ogg`, `flac`

## Important

- Voice cloning requires a reference audio file (any format: wav, mp3, ogg)
- Use `--x-vector-only` (default) to prevent reference text from bleeding into output
- API key is read from `~/.hypercli/claw-key.json` (set via `hyper claw subscribe` or `hyper claw login`)
- TTS runs on HyperClaw GPU backend — responses typically take 5-15s
- For sending voice messages in chat, save as `.ogg` format
