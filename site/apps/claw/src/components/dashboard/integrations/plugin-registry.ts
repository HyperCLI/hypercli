import type { LucideIcon } from "lucide-react";
import {
  Send, MessageCircle, Hash, Phone, MessageSquareMore,
  Shield, Smartphone, Monitor, Radio, Globe, Tv,
  MessageSquare, MessagesSquare, Building2, Server,
  Brain, Cloud, Cpu, Zap, Bot, Sparkles, CircuitBoard,
  Search, Mic2, Volume2, PhoneCall, Terminal,
  Wrench, Database, Code, FileCode, Puzzle, Layers,
  Eye, Image, Video, Box, Mic, Volume1,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginCategory = "chat" | "ai-providers" | "tools" | "built-in";

export interface PluginMeta {
  id: string;
  displayName: string;
  icon: LucideIcon;
  category: PluginCategory;
  description: string;
  /** Config path: "channels.<name>" for legacy wizards, "plugins.entries.<name>" for everything else */
  configPath: string;
  /** True for telegram, discord, slack — keep existing wizard UI */
  hasWizard?: boolean;
  /** True for tts, stt, vision, images, video, 3d — keep existing panel UI */
  hasBuiltinPanel?: boolean;
  /** URL where users can get an API key or sign up (AI providers) */
  setupUrl?: string;
  /** One-line guidance shown in the config panel (e.g., "Get your API key from…") */
  setupHint?: string;
}

export interface CategoryDefinition {
  id: PluginCategory;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORIES: CategoryDefinition[] = [
  { id: "chat", label: "Chat & Messaging", description: "Give your agent a presence on messaging platforms" },
  { id: "ai-providers", label: "AI Model Providers", description: "Connect external AI model providers" },
  { id: "tools", label: "Tools & Services", description: "Search, speech, media, memory, and automation" },
  { id: "built-in", label: "Built-in Capabilities", description: "Your agent already has these superpowers" },
];

// ---------------------------------------------------------------------------
// Plugin Registry (80 plugins + 6 built-in)
// ---------------------------------------------------------------------------

export const PLUGIN_REGISTRY: PluginMeta[] = [
  // ── Chat & Messaging (22) ──────────────────────────────────────────────
  { id: "telegram", displayName: "Telegram", icon: Send, category: "chat", description: "DMs and group chat on Telegram", configPath: "channels.telegram", hasWizard: true },
  { id: "discord", displayName: "Discord", icon: MessageCircle, category: "chat", description: "Chat in Discord servers and DMs", configPath: "channels.discord", hasWizard: true },
  { id: "slack", displayName: "Slack", icon: Hash, category: "chat", description: "Respond in Slack channels and threads", configPath: "channels.slack", hasWizard: true },
  { id: "whatsapp", displayName: "WhatsApp", icon: Phone, category: "chat", description: "Chat on WhatsApp via QR pairing", configPath: "plugins.entries.whatsapp" },
  { id: "signal", displayName: "Signal", icon: Shield, category: "chat", description: "End-to-end encrypted messaging", configPath: "plugins.entries.signal" },
  { id: "imessage", displayName: "iMessage", icon: Smartphone, category: "chat", description: "Chat via iMessage on macOS", configPath: "plugins.entries.imessage" },
  { id: "bluebubbles", displayName: "iMessage (BlueBubbles)", icon: Smartphone, category: "chat", description: "Chat via iMessage using BlueBubbles", configPath: "plugins.entries.bluebubbles" },
  { id: "msteams", displayName: "Microsoft Teams", icon: Building2, category: "chat", description: "Enterprise team chat", configPath: "plugins.entries.msteams" },
  { id: "matrix", displayName: "Matrix", icon: Globe, category: "chat", description: "Chat on any Matrix server", configPath: "plugins.entries.matrix" },
  { id: "nostr", displayName: "Nostr", icon: Radio, category: "chat", description: "Decentralized encrypted DMs", configPath: "plugins.entries.nostr" },
  { id: "tlon", displayName: "Tlon Messenger", icon: MessagesSquare, category: "chat", description: "P2P ownership-first chat", configPath: "plugins.entries.tlon" },
  { id: "zalo", displayName: "Zalo", icon: MessageSquare, category: "chat", description: "Chat on Zalo messenger", configPath: "plugins.entries.zalo" },
  { id: "zalouser", displayName: "Zalo Personal", icon: MessageSquare, category: "chat", description: "Chat as a Zalo personal account", configPath: "plugins.entries.zalouser" },
  { id: "mattermost", displayName: "Mattermost", icon: MessageSquareMore, category: "chat", description: "Self-hosted team chat", configPath: "plugins.entries.mattermost" },
  { id: "line", displayName: "LINE", icon: MessageCircle, category: "chat", description: "Chat on LINE messenger", configPath: "plugins.entries.line" },
  { id: "feishu", displayName: "Feishu (Lark)", icon: Building2, category: "chat", description: "Chat in Feishu/Lark workspaces", configPath: "plugins.entries.feishu" },
  { id: "googlechat", displayName: "Google Chat", icon: MessageSquare, category: "chat", description: "Google Workspace chat", configPath: "plugins.entries.googlechat" },
  { id: "nextcloud-talk", displayName: "Nextcloud Talk", icon: Server, category: "chat", description: "Self-hosted Nextcloud chat", configPath: "plugins.entries.nextcloud-talk" },
  { id: "synology-chat", displayName: "Synology Chat", icon: Server, category: "chat", description: "Synology NAS chat", configPath: "plugins.entries.synology-chat" },
  { id: "irc", displayName: "IRC", icon: Monitor, category: "chat", description: "Internet Relay Chat", configPath: "plugins.entries.irc" },
  { id: "twitch", displayName: "Twitch", icon: Tv, category: "chat", description: "Respond in Twitch live chat", configPath: "plugins.entries.twitch" },
  { id: "xiaomi", displayName: "Xiaomi", icon: Smartphone, category: "chat", description: "Xiaomi smart assistant", configPath: "plugins.entries.xiaomi" },

  // ── AI Model Providers (32) ────────────────────────────────────────────
  { id: "anthropic", displayName: "Anthropic", icon: Brain, category: "ai-providers", description: "Claude 4 Opus, Sonnet & Haiku", configPath: "plugins.entries.anthropic", setupUrl: "https://console.anthropic.com/settings/keys", setupHint: "Get your API key from the Anthropic Console" },
  { id: "openai", displayName: "OpenAI", icon: Sparkles, category: "ai-providers", description: "GPT-4o, GPT-5 & o-series reasoning", configPath: "plugins.entries.openai", setupUrl: "https://platform.openai.com/api-keys", setupHint: "Get your API key from the OpenAI Platform" },
  { id: "google", displayName: "Google", icon: Brain, category: "ai-providers", description: "Gemini 2.5 Pro & Flash", configPath: "plugins.entries.google", setupUrl: "https://aistudio.google.com/apikey", setupHint: "Get your API key from Google AI Studio" },
  { id: "deepseek", displayName: "DeepSeek", icon: Zap, category: "ai-providers", description: "DeepSeek V3 & R1 reasoning", configPath: "plugins.entries.deepseek", setupUrl: "https://platform.deepseek.com/api_keys", setupHint: "Get your API key from the DeepSeek Platform" },
  { id: "groq", displayName: "Groq", icon: Cpu, category: "ai-providers", description: "Ultra-fast LPU inference", configPath: "plugins.entries.groq", setupUrl: "https://console.groq.com/keys", setupHint: "Get your API key from the Groq Console" },
  { id: "mistral", displayName: "Mistral", icon: Brain, category: "ai-providers", description: "Mistral Large & Codestral", configPath: "plugins.entries.mistral", setupUrl: "https://console.mistral.ai/api-keys", setupHint: "Get your API key from the Mistral Console" },
  { id: "ollama", displayName: "Ollama", icon: Terminal, category: "ai-providers", description: "Run open-source models locally", configPath: "plugins.entries.ollama", setupUrl: "https://ollama.com/download", setupHint: "Runs locally \u2014 make sure Ollama is running on your machine" },
  { id: "openrouter", displayName: "OpenRouter", icon: Globe, category: "ai-providers", description: "Access hundreds of models via one API", configPath: "plugins.entries.openrouter", setupUrl: "https://openrouter.ai/keys", setupHint: "Get your API key from OpenRouter" },
  { id: "perplexity", displayName: "Perplexity", icon: Search, category: "ai-providers", description: "Search-augmented AI responses", configPath: "plugins.entries.perplexity", setupUrl: "https://www.perplexity.ai/settings/api", setupHint: "Get your API key from Perplexity Settings" },
  { id: "together", displayName: "Together", icon: Cloud, category: "ai-providers", description: "Run open-source models in the cloud", configPath: "plugins.entries.together", setupUrl: "https://api.together.xyz/settings/api-keys", setupHint: "Get your API key from Together AI" },
  { id: "xai", displayName: "xAI", icon: Sparkles, category: "ai-providers", description: "Grok 3 & Grok 4 models", configPath: "plugins.entries.xai", setupUrl: "https://console.x.ai", setupHint: "Get your API key from the xAI Console" },
  { id: "huggingface", displayName: "Hugging Face", icon: Bot, category: "ai-providers", description: "Inference API for open models", configPath: "plugins.entries.huggingface", setupUrl: "https://huggingface.co/settings/tokens", setupHint: "Get your access token from Hugging Face Settings" },
  { id: "kimi", displayName: "Kimi", icon: Brain, category: "ai-providers", description: "Moonshot Kimi long-context models", configPath: "plugins.entries.kimi", setupUrl: "https://platform.moonshot.cn/console/api-keys", setupHint: "Get your API key from the Moonshot Platform" },
  { id: "minimax", displayName: "MiniMax", icon: Zap, category: "ai-providers", description: "MiniMax M2.5 multimodal models", configPath: "plugins.entries.minimax", setupUrl: "https://www.minimaxi.com/platform", setupHint: "Get your API key from the MiniMax Platform" },
  { id: "moonshot", displayName: "Moonshot", icon: Brain, category: "ai-providers", description: "Moonshot AI models", configPath: "plugins.entries.moonshot", setupUrl: "https://platform.moonshot.cn/console/api-keys", setupHint: "Get your API key from the Moonshot Platform" },
  { id: "nvidia", displayName: "NVIDIA", icon: Cpu, category: "ai-providers", description: "NVIDIA NIM optimized inference", configPath: "plugins.entries.nvidia", setupUrl: "https://build.nvidia.com", setupHint: "Get your API key from NVIDIA Build" },
  { id: "vllm", displayName: "vLLM", icon: Server, category: "ai-providers", description: "Self-hosted vLLM inference server", configPath: "plugins.entries.vllm", setupHint: "Enter your self-hosted vLLM server URL" },
  { id: "sglang", displayName: "SGLang", icon: Server, category: "ai-providers", description: "Self-hosted SGLang serving engine", configPath: "plugins.entries.sglang", setupHint: "Enter your self-hosted SGLang server URL" },
  { id: "amazon-bedrock", displayName: "Amazon Bedrock", icon: Cloud, category: "ai-providers", description: "AWS managed AI model service", configPath: "plugins.entries.amazon-bedrock", setupUrl: "https://console.aws.amazon.com/bedrock", setupHint: "Configure AWS credentials with Bedrock access" },
  { id: "microsoft", displayName: "Microsoft Speech", icon: Volume2, category: "ai-providers", description: "Azure AI speech services", configPath: "plugins.entries.microsoft", setupUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub", setupHint: "Get your key from Azure AI Services" },
  { id: "venice", displayName: "Venice", icon: Brain, category: "ai-providers", description: "Privacy-focused AI inference", configPath: "plugins.entries.venice", setupUrl: "https://venice.ai/settings/api", setupHint: "Get your API key from Venice Settings" },
  { id: "byteplus", displayName: "BytePlus", icon: Cloud, category: "ai-providers", description: "BytePlus AI model services", configPath: "plugins.entries.byteplus", setupUrl: "https://console.byteplus.com", setupHint: "Get your API key from the BytePlus Console" },
  { id: "chutes", displayName: "Chutes", icon: Cloud, category: "ai-providers", description: "Chutes AI model inference", configPath: "plugins.entries.chutes", setupUrl: "https://chutes.ai", setupHint: "Get your API key from Chutes" },
  { id: "cloudflare-ai-gateway", displayName: "Cloudflare AI Gateway", icon: Cloud, category: "ai-providers", description: "Route AI traffic through Cloudflare", configPath: "plugins.entries.cloudflare-ai-gateway", setupUrl: "https://dash.cloudflare.com", setupHint: "Set up an AI Gateway in your Cloudflare dashboard" },
  { id: "copilot-proxy", displayName: "Copilot Proxy", icon: Code, category: "ai-providers", description: "Route through GitHub Copilot", configPath: "plugins.entries.copilot-proxy", setupHint: "Requires an active GitHub Copilot subscription" },
  { id: "github-copilot", displayName: "GitHub Copilot", icon: Code, category: "ai-providers", description: "GitHub Copilot model access", configPath: "plugins.entries.github-copilot", setupUrl: "https://github.com/settings/copilot", setupHint: "Requires an active GitHub Copilot subscription" },
  { id: "lobster", displayName: "Lobster", icon: Brain, category: "ai-providers", description: "Lobster AI model inference", configPath: "plugins.entries.lobster", setupHint: "Get your API key from Lobster" },
  { id: "vercel-ai-gateway", displayName: "Vercel AI Gateway", icon: Globe, category: "ai-providers", description: "Hundreds of models, one API key", configPath: "plugins.entries.vercel-ai-gateway", setupUrl: "https://vercel.com/dashboard", setupHint: "Get your API key from the Vercel Dashboard" },
  { id: "qianfan", displayName: "Qianfan", icon: Brain, category: "ai-providers", description: "Baidu Qianfan AI platform", configPath: "plugins.entries.qianfan", setupUrl: "https://console.bce.baidu.com/qianfan", setupHint: "Get your API key from the Baidu Qianfan Console" },
  { id: "volcengine", displayName: "Volcengine", icon: Cloud, category: "ai-providers", description: "ByteDance AI model platform", configPath: "plugins.entries.volcengine", setupUrl: "https://console.volcengine.com", setupHint: "Get your API key from the Volcengine Console" },
  { id: "modelstudio", displayName: "Model Studio", icon: Brain, category: "ai-providers", description: "Alibaba Cloud AI models", configPath: "plugins.entries.modelstudio", setupUrl: "https://modelstudio.aliyun.com", setupHint: "Get your API key from Alibaba Model Studio" },
  { id: "qwen-portal-auth", displayName: "Qwen OAuth", icon: Brain, category: "ai-providers", description: "Qwen portal authentication", configPath: "plugins.entries.qwen-portal-auth", setupHint: "Sign in with your Qwen portal account" },

  // ── Tools & Services (26) ──────────────────────────────────────────────
  { id: "brave", displayName: "Brave Search", icon: Search, category: "tools", description: "Web search via Brave", configPath: "plugins.entries.brave" },
  { id: "duckduckgo", displayName: "DuckDuckGo", icon: Search, category: "tools", description: "Private web search", configPath: "plugins.entries.duckduckgo" },
  { id: "exa", displayName: "Exa", icon: Search, category: "tools", description: "Neural web search", configPath: "plugins.entries.exa" },
  { id: "tavily", displayName: "Tavily", icon: Search, category: "tools", description: "AI-optimized search", configPath: "plugins.entries.tavily" },
  { id: "firecrawl", displayName: "Firecrawl", icon: Globe, category: "tools", description: "Web scraping & crawling", configPath: "plugins.entries.firecrawl" },
  { id: "elevenlabs", displayName: "ElevenLabs", icon: Volume2, category: "tools", description: "Premium voice synthesis", configPath: "plugins.entries.elevenlabs" },
  { id: "deepgram", displayName: "Deepgram", icon: Mic2, category: "tools", description: "Speech recognition API", configPath: "plugins.entries.deepgram" },
  { id: "fal", displayName: "fal.ai", icon: Image, category: "tools", description: "Generative media API", configPath: "plugins.entries.fal" },
  { id: "voice-call", displayName: "Voice Call", icon: PhoneCall, category: "tools", description: "Inbound & outbound phone calls", configPath: "plugins.entries.voice-call" },
  { id: "talk-voice", displayName: "Talk Voice", icon: Mic2, category: "tools", description: "Voice wake & talk mode", configPath: "plugins.entries.talk-voice" },
  { id: "phone-control", displayName: "Phone Control", icon: Smartphone, category: "tools", description: "Mobile device control", configPath: "plugins.entries.phone-control" },
  { id: "memory-core", displayName: "Memory (Core)", icon: Database, category: "tools", description: "Built-in memory backend", configPath: "plugins.entries.memory-core" },
  { id: "memory-lancedb", displayName: "Memory (LanceDB)", icon: Database, category: "tools", description: "Vector memory with LanceDB", configPath: "plugins.entries.memory-lancedb" },
  { id: "openshell", displayName: "OpenShell", icon: Terminal, category: "tools", description: "Remote shell sandbox", configPath: "plugins.entries.openshell" },
  { id: "device-pair", displayName: "Device Pair", icon: Smartphone, category: "tools", description: "Device pairing service", configPath: "plugins.entries.device-pair" },
  { id: "diagnostics-otel", displayName: "Diagnostics (OTel)", icon: Wrench, category: "tools", description: "OpenTelemetry diagnostics", configPath: "plugins.entries.diagnostics-otel" },
  { id: "diffs", displayName: "Diffs", icon: FileCode, category: "tools", description: "Code diff tools", configPath: "plugins.entries.diffs" },
  { id: "llm-task", displayName: "LLM Task", icon: CircuitBoard, category: "tools", description: "Background LLM task runner", configPath: "plugins.entries.llm-task" },
  { id: "acpx", displayName: "ACPX Runtime", icon: Terminal, category: "tools", description: "Agent communication protocol runtime", configPath: "plugins.entries.acpx" },
  { id: "kilocode", displayName: "Kilo Gateway", icon: Code, category: "tools", description: "Code generation gateway", configPath: "plugins.entries.kilocode" },
  { id: "open-prose", displayName: "OpenProse", icon: FileCode, category: "tools", description: "Prose editing tools", configPath: "plugins.entries.open-prose" },
  { id: "opencode", displayName: "OpenCode Zen", icon: Code, category: "tools", description: "AI-assisted code editing", configPath: "plugins.entries.opencode" },
  { id: "opencode-go", displayName: "OpenCode Go", icon: Code, category: "tools", description: "AI-assisted Go development", configPath: "plugins.entries.opencode-go" },
  { id: "synthetic", displayName: "Synthetic", icon: Layers, category: "tools", description: "Generate synthetic training data", configPath: "plugins.entries.synthetic" },
  { id: "thread-ownership", displayName: "Thread Ownership", icon: Puzzle, category: "tools", description: "Multi-agent thread routing", configPath: "plugins.entries.thread-ownership" },
  { id: "zai", displayName: "Z.AI", icon: Brain, category: "tools", description: "Z.AI autonomous agent tools", configPath: "plugins.entries.zai" },

  // ── Built-in Capabilities (6) ─────────────────────────────────────────
  { id: "builtin-voice", displayName: "Voice", icon: Volume1, category: "built-in", description: "Speak aloud with 9 voices or clone any voice", configPath: "integrations.voice", hasBuiltinPanel: true },
  { id: "builtin-speech", displayName: "Speech", icon: Mic, category: "built-in", description: "Transcribes any audio file", configPath: "integrations.stt", hasBuiltinPanel: true },
  { id: "builtin-vision", displayName: "Vision", icon: Eye, category: "built-in", description: "Understands images in chat", configPath: "integrations.vision", hasBuiltinPanel: true },
  { id: "builtin-images", displayName: "Images", icon: Image, category: "built-in", description: "Text-to-image & image editing", configPath: "integrations.images", hasBuiltinPanel: true },
  { id: "builtin-video", displayName: "Video", icon: Video, category: "built-in", description: "Text & image to video", configPath: "integrations.video", hasBuiltinPanel: true },
  { id: "builtin-3d", displayName: "3D", icon: Box, category: "built-in", description: "Image to 3D model", configPath: "integrations.3d", hasBuiltinPanel: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get all plugins for a given category */
export function getPluginsByCategory(category: PluginCategory): PluginMeta[] {
  return PLUGIN_REGISTRY.filter((p) => p.category === category);
}

/** Get a single plugin by ID */
export function getPlugin(id: string): PluginMeta | undefined {
  return PLUGIN_REGISTRY.find((p) => p.id === id);
}

/** Read a nested value from config by dot-separated path */
function getConfigValue(config: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Derive whether a plugin is currently enabled from the config */
export function isPluginEnabled(
  plugin: PluginMeta,
  config: Record<string, unknown> | null,
): boolean {
  if (!config) return false;
  const value = getConfigValue(config, plugin.configPath);
  if (value == null || typeof value !== "object") return false;
  return !!(value as Record<string, unknown>).enabled;
}

/** Count enabled plugins in a category */
export function countEnabledInCategory(
  category: PluginCategory,
  config: Record<string, unknown> | null,
): number {
  if (category === "built-in") return 6; // always active
  return getPluginsByCategory(category).filter((p) => isPluginEnabled(p, config)).length;
}
