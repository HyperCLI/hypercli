# HyperClaw Integration Audit — Per-App Requirements

**Date**: 2026-04-09
**Purpose**: Document what each integration needs to work properly with good UX, what we currently have, and what's missing.

---

## How the System Works

- The Integrations page manages **86 integrations** across 4 categories
- Config is saved via WebSocket RPC (`configPatch`) to the agent's OpenClaw gateway
- Each integration has a `configPath` — either `channels.*`, `plugins.entries.*`, `models.providers.*`, or `integrations.*`
- Setup UX varies: bespoke wizards, token forms, QR flows, toggle-only, or dynamic schema-driven forms
- After saving, channel integrations verify via `channelsStatus(probe=true)` polling (8 attempts x 4s)

### Key Files

| File | Purpose |
|------|---------|
| `site/apps/claw/src/components/dashboard/integrations/IntegrationsPage.tsx` | Main page — accordion layout, SlideOver panels, state management |
| `site/apps/claw/src/components/dashboard/integrations/plugin-registry.ts` | 86 integration definitions (id, icon, configPath, setupFields, etc.) |
| `site/apps/claw/src/components/dashboard/integrations/PluginConfigPanel.tsx` | Dynamic config form for plugins + AI provider panel |
| `site/apps/claw/src/components/dashboard/integrations/TokenSetupWizard.tsx` | Generic credential input wizard |
| `site/apps/claw/src/components/dashboard/integrations/QrLoginWizard.tsx` | QR-based pairing wizard (WhatsApp, Zalo) |
| `site/apps/claw/src/components/dashboard/integrations/TelegramWizard.tsx` | Bespoke Telegram setup |
| `site/apps/claw/src/components/dashboard/integrations/DiscordWizard.tsx` | Bespoke Discord setup |
| `site/apps/claw/src/components/dashboard/integrations/SlackWizard.tsx` | Bespoke Slack setup |
| `site/apps/claw/src/hooks/usePluginVerification.ts` | Shared verification polling hook |

---

## Category 1: Chat & Messaging (22 integrations)

### 1. Telegram — DONE
- **Config path**: `channels.telegram`
- **What user needs**: Bot token from @BotFather, DM policy choice
- **Where to get it**: Telegram → talk to @BotFather → `/newbot` → copy token
- **Current UX**: Full bespoke wizard (TelegramWizard.tsx, 391 lines) — token input, API validation via `/getMe`, DM policy config, verification polling, success with bot link
- **Saves**: `{ channels: { telegram: { enabled: true, botToken: "...", dmPolicy: "pairing" } } }`

### 2. Discord — DONE
- **Config path**: `channels.discord`
- **What user needs**: Bot token, optional Server ID + User ID for guild allowlist
- **Where to get it**: Discord Developer Portal → create app → Bot tab → copy token
- **Current UX**: Full bespoke wizard (DiscordWizard.tsx, 373 lines) — token input, Base64 format validation, manifest JSON download with OAuth permissions, verification polling
- **Saves**: `{ channels: { discord: { enabled: true, token: "..." } } }`

### 3. Slack — DONE
- **Config path**: `channels.slack`
- **What user needs**: Bot User OAuth Token (`xoxb-*`) + App-Level Token (`xapp-*`)
- **Where to get it**: Slack API → create app → install to workspace → copy both tokens
- **Current UX**: Full bespoke wizard (SlackWizard.tsx, 396 lines) — dual token input, validation, manifest download (Socket Mode + event subscriptions), verification polling
- **Saves**: `{ channels: { slack: { enabled: true, botToken: "xoxb-...", appToken: "xapp-..." } } }`

### 4. WhatsApp — DONE (minor caveat)
- **Config path**: `channels.whatsapp`
- **What user needs**: Phone with WhatsApp installed, scan QR code
- **Current UX**: QrLoginWizard — user copies shell command, clicks "Enable & Open Shell", pastes command in Shell tab, QR appears, scan with phone
- **Caveat**: No automatic verification after QR scan — user has to trust it worked
- **Saves**: `{ channels: { whatsapp: { enabled: true } } }`

### 5. Microsoft Teams — DONE
- **Config path**: `channels.msteams`
- **What user needs**: App ID, App Password (Client Secret), Tenant ID
- **Where to get it**: Azure Portal → create Azure Bot registration
- **Current UX**: TokenSetupWizard with 3 fields + setupUrl to Azure Portal + verification polling
- **Has**: `setupUrl`, `setupHint`, `setupFields` (3 fields)
- **Saves**: `{ channels: { msteams: { enabled: true, appId: "...", appPassword: "...", tenantId: "..." } } }`

### 6. Google Chat — DONE
- **Config path**: `channels.googlechat`
- **What user needs**: Service Account JSON file path, Gateway URL for webhooks
- **Where to get it**: Google Cloud Console → create Service Account → download JSON key
- **Current UX**: TokenSetupWizard with 2 fields + setupUrl to GCP console + verification polling
- **Has**: `setupUrl`, `setupHint`, `setupFields` (2 fields)
- **Saves**: `{ channels: { googlechat: { enabled: true, serviceAccountFile: "...", audience: "..." } } }`

### 7. Zalo Bot — DONE
- **Config path**: `channels.zalo`
- **What user needs**: App ID, Secret Key
- **Where to get it**: Zalo Developers portal (developers.zalo.me)
- **Current UX**: TokenSetupWizard with 2 fields + setupUrl + verification polling
- **Has**: `setupUrl`, `setupHint`, `setupFields` (2 fields)
- **Saves**: `{ channels: { zalo: { enabled: true, appId: "...", secretKey: "..." } } }`

### 8. Zalo Personal — DONE (minor caveat)
- **Config path**: `channels.zalouser`
- **What user needs**: Phone with Zalo installed, scan QR code
- **Current UX**: QrLoginWizard — same flow as WhatsApp
- **Caveat**: Same as WhatsApp — no auto-verification after scan
- **Saves**: `{ channels: { zalouser: { enabled: true } } }`

### 9. LINE — DONE
- **Config path**: `plugins.entries.line`
- **What user needs**: Channel Access Token, Channel Secret
- **Where to get it**: LINE Developers Console (developers.line.biz/console)
- **Current UX**: TokenSetupWizard with 2 fields + setupUrl + verification polling
- **Has**: `setupUrl`, `setupHint`, `setupFields` (2 fields, both sensitive)
- **Saves**: `{ plugins: { entries: { line: { enabled: true, config: { channelAccessToken: "...", channelSecret: "..." } } } } }`

### 10. Twitch — DONE
- **Config path**: `plugins.entries.twitch`
- **What user needs**: OAuth Token, Channel Name
- **Where to get it**: Twitch Developer Console (dev.twitch.tv/console)
- **Current UX**: TokenSetupWizard with 2 fields + setupUrl + verification polling
- **Has**: `setupUrl`, `setupHint`, `setupFields` (2 fields)
- **Saves**: `{ plugins: { entries: { twitch: { enabled: true, config: { oauthToken: "...", channelName: "..." } } } } }`

### 11. IRC — DONE
- **Config path**: `plugins.entries.irc`
- **What user needs**: Server address, Channel, Nickname, optional Password
- **Current UX**: TokenSetupWizard with 4 fields + `skipVerification: true` (IRC has no HTTP probe)
- **Has**: `setupHint`, `setupFields` (4 fields)
- **Saves**: `{ plugins: { entries: { irc: { enabled: true, config: { server: "...", channel: "...", nickname: "...", password: "..." } } } } }`

### 12. Mattermost — DONE
- **Config path**: `plugins.entries.mattermost`
- **What user needs**: Server URL, Bot Token
- **Where to get it**: Mattermost server admin → create bot account
- **Current UX**: TokenSetupWizard with 2 fields + verification polling
- **Has**: `setupHint`, `setupFields` (2 fields)
- **Saves**: `{ plugins: { entries: { mattermost: { enabled: true, config: { serverUrl: "...", botToken: "..." } } } } }`

### 13. Signal — MISSING SETUP
- **Config path**: `plugins.entries.signal`
- **What user likely needs**: Phone number, signal-cli registration, possibly captcha token
- **Where to get it**: User needs to run signal-cli and register a phone number — complex multi-step process
- **Current UX**: Toggle only — shows generic "Enable, then go to Shell" guidance
- **What's missing**:
  - Needs investigation: does the backend handle signal-cli setup, or does the user need to provide pre-configured credentials?
  - Option A: If backend handles it → QR/shell-based flow like WhatsApp
  - Option B: If user provides credentials → needs `setupFields` (phoneNumber, captchaToken?)
  - Needs `setupHint` explaining the complexity

### 14. iMessage — LIKELY TOGGLE-ONLY
- **Config path**: `plugins.entries.imessage`
- **What user needs**: Agent must be running on macOS with AppleScript access
- **Current UX**: Toggle only — no guidance
- **What's missing**: Needs a `setupHint` explaining that this only works on macOS agents with iMessage configured. Probably no config fields needed — the AppleScript bridge uses the system's iMessage account.

### 15. iMessage (BlueBubbles) — MISSING SETUP
- **Config path**: `plugins.entries.bluebubbles`
- **What user likely needs**: BlueBubbles server URL, password/API key
- **Where to get it**: User sets up BlueBubbles server on a Mac, gets connection details from BlueBubbles settings
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "serverUrl", label: "Server URL", required: true }, { key: "password", label: "Password", sensitive: true, required: true }]`
  - `setupHint`: "Set up BlueBubbles on a Mac and enter the server connection details"
  - `setupUrl`: "https://bluebubbles.app"
  - Needs backend confirmation on exact field names

### 16. Matrix — MISSING SETUP
- **Config path**: `plugins.entries.matrix`
- **What user likely needs**: Homeserver URL, access token (or username + password)
- **Where to get it**: Matrix homeserver settings (e.g., Element → Settings → Help & About → Access Token)
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "homeserverUrl", label: "Homeserver URL", placeholder: "https://matrix.org", required: true }, { key: "accessToken", label: "Access Token", sensitive: true, required: true }]`
  - `setupHint`: "Get your access token from your Matrix client (Element: Settings → Help & About)"
  - Needs backend confirmation on exact field names

### 17. Nostr — MISSING SETUP
- **Config path**: `plugins.entries.nostr`
- **What user likely needs**: Private key (nsec format), relay URLs
- **Where to get it**: Nostr key generation tool or existing Nostr client
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "privateKey", label: "Private Key (nsec)", sensitive: true, required: true }, { key: "relays", label: "Relay URLs", placeholder: "wss://relay.damus.io" }]`
  - `setupHint`: "Enter your Nostr private key (nsec format) and preferred relays"
  - Needs backend confirmation on exact field names

### 18. Tlon Messenger — NEEDS INVESTIGATION
- **Config path**: `plugins.entries.tlon`
- **What user needs**: Unknown — P2P ownership-first chat
- **Current UX**: Toggle only — no guidance
- **Action needed**: Ask backend team what credentials/config this requires

### 19. Feishu (Lark) — MISSING SETUP
- **Config path**: `plugins.entries.feishu`
- **What user likely needs**: App ID, App Secret
- **Where to get it**: Feishu Open Platform developer console
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "appId", label: "App ID", required: true }, { key: "appSecret", label: "App Secret", sensitive: true, required: true }]`
  - `setupUrl`: "https://open.feishu.cn/app"
  - `setupHint`: "Create an app on the Feishu Open Platform and copy the App ID and Secret"
  - Needs backend confirmation on exact field names

### 20. Nextcloud Talk — MISSING SETUP
- **Config path**: `plugins.entries.nextcloud-talk`
- **What user likely needs**: Nextcloud server URL, app password or API token
- **Where to get it**: Nextcloud → Settings → Security → App passwords
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "serverUrl", label: "Nextcloud URL", placeholder: "https://cloud.example.com", required: true }, { key: "token", label: "App Password", sensitive: true, required: true }, { key: "username", label: "Username", required: true }]`
  - `setupHint`: "Create an App Password in your Nextcloud security settings"
  - Needs backend confirmation on exact field names

### 21. Synology Chat — MISSING SETUP
- **Config path**: `plugins.entries.synology-chat`
- **What user likely needs**: Synology NAS URL, incoming/outgoing webhook tokens
- **Where to get it**: Synology Chat → Integration settings
- **Current UX**: Toggle only — no guidance
- **What's missing**:
  - `setupFields`: `[{ key: "serverUrl", label: "NAS URL", required: true }, { key: "incomingWebhookUrl", label: "Incoming Webhook URL", required: true }, { key: "outgoingToken", label: "Outgoing Token", sensitive: true }]`
  - `setupHint`: "Set up webhooks in Synology Chat integration settings"
  - Needs backend confirmation on exact field names

### 22. Xiaomi — NEEDS INVESTIGATION
- **Config path**: `plugins.entries.xiaomi`
- **What user needs**: Unknown — Xiaomi smart assistant integration
- **Current UX**: Toggle only — no guidance
- **Action needed**: Ask backend team what credentials/config this requires

---

## Category 2: AI Model Providers (32 integrations)

All AI providers currently use the same `AiProviderPanel` which shows API Key + Base URL fields. Credentials save to `models.providers.<id>`, enabled flag saves to `plugins.entries.<id>`.

### Standard API Key Providers — DONE (25)

These work correctly with the current API Key + Base URL form:

| # | Provider | setupUrl | setupHint | Status |
|---|----------|----------|-----------|--------|
| 23 | Anthropic | console.anthropic.com | Yes | **DONE** |
| 24 | OpenAI | platform.openai.com | Yes | **DONE** |
| 25 | Google | aistudio.google.com | Yes | **DONE** |
| 26 | DeepSeek | platform.deepseek.com | Yes | **DONE** |
| 27 | Groq | console.groq.com | Yes | **DONE** |
| 28 | Mistral | console.mistral.ai | Yes | **DONE** |
| 29 | OpenRouter | openrouter.ai | Yes | **DONE** |
| 30 | Perplexity | perplexity.ai/settings | Yes | **DONE** |
| 31 | Together | api.together.xyz | Yes | **DONE** |
| 32 | xAI | console.x.ai | Yes | **DONE** |
| 33 | Hugging Face | huggingface.co/settings | Yes | **DONE** |
| 34 | Kimi | platform.moonshot.cn | Yes | **DONE** |
| 35 | MiniMax | minimaxi.com | Yes | **DONE** |
| 36 | Moonshot | platform.moonshot.cn | Yes | **DONE** |
| 37 | NVIDIA | build.nvidia.com | Yes | **DONE** |
| 38 | Venice | venice.ai/settings | Yes | **DONE** |
| 39 | BytePlus | console.byteplus.com | Yes | **DONE** |
| 40 | Chutes | chutes.ai | Yes | **DONE** |
| 41 | Lobster | — | Yes (hint only) | **DONE** |
| 42 | Vercel AI Gateway | vercel.com/dashboard | Yes | **DONE** |
| 43 | Qianfan | console.bce.baidu.com | Yes | **DONE** |
| 44 | Volcengine | console.volcengine.com | Yes | **DONE** |
| 45 | Model Studio | modelstudio.aliyun.com | Yes | **DONE** |

### Non-Standard Providers — NEEDS FIX (7)

These need different form fields than the generic API Key + Base URL:

#### 46. Ollama — NEEDS FIX
- **Config path**: `plugins.entries.ollama`
- **What user actually needs**: Base URL only (e.g., `http://localhost:11434`) — no API key
- **Problem**: Current form shows API Key field which is misleading for a local service
- **Fix**: Show only Base URL field. Change `setupHint` to "Make sure Ollama is running locally. Default URL is http://localhost:11434"

#### 47. vLLM — NEEDS FIX
- **Config path**: `plugins.entries.vllm`
- **What user actually needs**: Server URL only — self-hosted, usually no auth
- **Problem**: Same as Ollama — API Key field is misleading
- **Fix**: Show only Base URL field

#### 48. SGLang — NEEDS FIX
- **Config path**: `plugins.entries.sglang`
- **What user actually needs**: Server URL only — self-hosted
- **Problem**: Same as Ollama/vLLM
- **Fix**: Show only Base URL field

#### 49. Amazon Bedrock — NEEDS FIX
- **Config path**: `plugins.entries.amazon-bedrock`
- **What user actually needs**: AWS Access Key ID, AWS Secret Access Key, AWS Region
- **Problem**: Current form shows generic "API Key + Base URL" which doesn't match AWS credential model at all
- **Fix**: Needs custom `setupFields` with 3 AWS-specific fields. Needs backend confirmation on exact field names (could be `accessKeyId`, `secretAccessKey`, `region` or AWS SDK standard names)

#### 50. Microsoft Speech — NEEDS FIX
- **Config path**: `plugins.entries.microsoft`
- **What user actually needs**: Azure Speech key + region (e.g., `eastus`)
- **Problem**: "Base URL" doesn't make sense for Azure Speech — it needs a region
- **Fix**: Show API Key + Region dropdown/field instead of Base URL

#### 51. Cloudflare AI Gateway — NEEDS FIX
- **Config path**: `plugins.entries.cloudflare-ai-gateway`
- **What user actually needs**: Account ID, Gateway ID/name, API Token
- **Problem**: Generic form doesn't capture the 3 required Cloudflare identifiers
- **Fix**: Needs custom `setupFields` with Cloudflare-specific fields. Needs backend confirmation.

#### 52-53. Copilot Proxy + GitHub Copilot — NEEDS INVESTIGATION
- **Config paths**: `plugins.entries.copilot-proxy`, `plugins.entries.github-copilot`
- **What user needs**: Active GitHub Copilot subscription + likely a personal access token
- **Problem**: Generic API Key form might work if it accepts a GitHub PAT, but unclear
- **Action**: Ask backend what credential format these expect

#### 54. Qwen OAuth — NEEDS INVESTIGATION
- **Config path**: `plugins.entries.qwen-portal-auth`
- **What user needs**: "Sign in with your Qwen portal account" — suggests OAuth, not API key
- **Problem**: API Key form may be wrong if this is an OAuth flow
- **Action**: Ask backend if this is token-based or requires an actual OAuth redirect

---

## Category 3: Tools & Services (26 integrations)

### Need API Key — EASY FIX (7)

These just need `setupFields` added to the plugin registry. Currently show generic "How to set up" guidance.

#### 55. Brave Search
- **Config path**: `plugins.entries.brave`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://brave.com/search/api/"`, `setupHint: "Get your API key from the Brave Search API dashboard"`

#### 56. Exa
- **Config path**: `plugins.entries.exa`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://dashboard.exa.ai/api-keys"`, `setupHint: "Get your API key from the Exa dashboard"`

#### 57. Tavily
- **Config path**: `plugins.entries.tavily`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://app.tavily.com/home"`, `setupHint: "Get your API key from the Tavily dashboard"`

#### 58. Firecrawl
- **Config path**: `plugins.entries.firecrawl`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://firecrawl.dev"`, `setupHint: "Get your API key from the Firecrawl dashboard"`

#### 59. ElevenLabs
- **Config path**: `plugins.entries.elevenlabs`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://elevenlabs.io/app/settings/api-keys"`, `setupHint: "Get your API key from ElevenLabs Settings"`

#### 60. Deepgram
- **Config path**: `plugins.entries.deepgram`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://console.deepgram.com"`, `setupHint: "Get your API key from the Deepgram Console"`

#### 61. fal.ai
- **Config path**: `plugins.entries.fal`
- **Needs**: API key
- **Fix**: Add `setupFields: [{ key: "apiKey", label: "API Key", sensitive: true, required: true }]`, `setupUrl: "https://fal.ai/dashboard/keys"`, `setupHint: "Get your API key from the fal.ai dashboard"`

### Toggle-Only — PROBABLY CORRECT (5)

These likely don't need configuration — they're built-in tools or free services.

| # | Tool | Why Toggle Is Sufficient |
|---|------|------------------------|
| 62 | DuckDuckGo | Free search, no API key needed |
| 63 | Memory (Core) | Built-in memory backend, no external credentials |
| 64 | OpenShell | Built-in remote shell, no config |
| 65 | Diffs | Built-in code diff tool, no config |
| 66 | Diagnostics (OTel) | May need an endpoint URL — **needs investigation** to confirm toggle-only is correct |

### Need Custom Config — NEEDS INVESTIGATION (6)

| # | Tool | Likely Needs | Action |
|---|------|-------------|--------|
| 67 | Voice Call | Twilio/SIP credentials (account SID, auth token, phone number?) | Ask backend |
| 68 | Talk Voice | Microphone/wake word config, or just a mode toggle? | Ask backend |
| 69 | Phone Control | Device pairing details, ADB connection? | Ask backend |
| 70 | Device Pair | Pairing code/flow? | Ask backend |
| 71 | Memory (LanceDB) | Database path, collection name? Or auto-configured? | Ask backend |
| 72 | LLM Task | Likely just needs an AI provider enabled — guidance only? | Ask backend |

### Unknown — NEEDS INVESTIGATION (8)

These tools have no setup info and it's unclear what they require:

| # | Tool | Config Path | Action |
|---|------|------------|--------|
| 73 | ACPX Runtime | `plugins.entries.acpx` | Ask backend what config is needed |
| 74 | Kilo Gateway | `plugins.entries.kilocode` | Ask backend |
| 75 | OpenProse | `plugins.entries.open-prose` | Ask backend |
| 76 | OpenCode Zen | `plugins.entries.opencode` | Ask backend |
| 77 | OpenCode Go | `plugins.entries.opencode-go` | Ask backend |
| 78 | Synthetic | `plugins.entries.synthetic` | Ask backend |
| 79 | Thread Ownership | `plugins.entries.thread-ownership` | Ask backend |
| 80 | Z.AI | `plugins.entries.zai` | Ask backend |

---

## Category 4: Built-in Capabilities (6 integrations)

These are always active. The question is whether they have configurable settings.

### 81. Voice (TTS) — PARTIALLY DONE
- **Config path**: `integrations.voice`
- **Current UX**: TtsPanel has a config form with speaker selection + format
- **What's missing**: Options are hardcoded, not driven by the config schema. If the backend adds new voices or formats, the UI won't show them.

### 82-86. Speech, Vision, Images, Video, 3D — NEEDS SCHEMA INSPECTION
- **Config paths**: `integrations.stt`, `integrations.vision`, `integrations.images`, `integrations.video`, `integrations.3d`
- **Current UX**: Read-only info panels showing hardcoded model names + "Got it" button
- **What's missing**: These panels don't check `configSchema()` for configurable fields. If the backend allows choosing STT engine, vision model, image model, etc., the UI doesn't surface those options.
- **Action**: Inspect `configSchema()` response from a running agent to see if these paths have configurable properties

---

## Summary Table

| Status | Count | Items |
|--------|-------|-------|
| **DONE — works properly** | 37 | Telegram, Discord, Slack, WhatsApp, Teams, Google Chat, Zalo Bot, Zalo Personal, LINE, Twitch, IRC, Mattermost + 25 standard AI providers |
| **Needs minor form fix** | 3 | Ollama, vLLM, SGLang (hide API key, show only Base URL) |
| **Needs custom form fields** | 4 | Amazon Bedrock, Microsoft Speech, Cloudflare AI Gateway, Qwen OAuth |
| **Easy fix — add setupFields to registry** | 7 | Brave, Exa, Tavily, Firecrawl, ElevenLabs, Deepgram, fal.ai |
| **Needs setupFields + backend confirmation** | 7 | Signal, BlueBubbles, Matrix, Nostr, Feishu, Nextcloud Talk, Synology Chat |
| **Toggle probably sufficient** | 5 | DuckDuckGo, Memory Core, OpenShell, Diffs, iMessage |
| **Needs backend investigation** | 17 | Tlon, Xiaomi, Copilot Proxy, GitHub Copilot, Voice Call, Talk Voice, Phone Control, Device Pair, Memory LanceDB, LLM Task, ACPX, Kilo Gateway, OpenProse, OpenCode Zen, OpenCode Go, Synthetic, Thread Ownership, Z.AI |
| **Needs schema inspection** | 6 | Voice (partially done), Speech, Vision, Images, Video, 3D |

### Quick Wins (can do now without backend input)
1. Add `setupFields` to 7 tools (Brave, Exa, Tavily, Firecrawl, ElevenLabs, Deepgram, fal.ai)
2. Fix Ollama/vLLM/SGLang to hide API Key and show only Base URL
3. Add search bar to find integrations quickly (pure frontend)
4. Improve AI provider toggle behavior (smart enable/disable)

### Needs Backend Team Input (17+ integrations)
The field names, credential formats, and setup flows for these integrations must come from the backend team — the frontend cannot determine them from the config schema alone.

---

## UX Improvement Plan (Frontend-Only)

Beyond per-integration fixes, these cross-cutting improvements are planned:

1. **Search bar** — filter 86 integrations by name/description
2. **Wildcard uiHint resolution** — use SDK's `resolveOpenClawConfigUiHint()` for better field labels/sensitivity
3. **Unified ManagePanel** — replace 5+ inline manage panels with one reusable component
4. **AI provider card status** — show "Connected" / "Needs API key" on cards
5. **Schema-driven built-in panels** — discover configurable fields from schema for Voice/STT/Vision/etc.
6. **Panel routing refactor** — reduce ~400 lines of repetitive SlideOver wiring
