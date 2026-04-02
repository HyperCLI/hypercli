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
  { id: "telegram", displayName: "Telegram", icon: Send, category: "chat", description: "Bot API via grammY", configPath: "channels.telegram", hasWizard: true },
  { id: "discord", displayName: "Discord", icon: MessageCircle, category: "chat", description: "Servers, channels & DMs", configPath: "channels.discord", hasWizard: true },
  { id: "slack", displayName: "Slack", icon: Hash, category: "chat", description: "Workspace apps via Bolt", configPath: "channels.slack", hasWizard: true },
  { id: "whatsapp", displayName: "WhatsApp", icon: Phone, category: "chat", description: "QR pairing via Baileys", configPath: "plugins.entries.whatsapp" },
  { id: "signal", displayName: "Signal", icon: Shield, category: "chat", description: "Privacy-focused via signal-cli", configPath: "plugins.entries.signal" },
  { id: "imessage", displayName: "iMessage", icon: Smartphone, category: "chat", description: "iMessage via AppleScript bridge", configPath: "plugins.entries.imessage" },
  { id: "bluebubbles", displayName: "iMessage (BlueBubbles)", icon: Smartphone, category: "chat", description: "iMessage via BlueBubbles server", configPath: "plugins.entries.bluebubbles" },
  { id: "msteams", displayName: "Microsoft Teams", icon: Building2, category: "chat", description: "Enterprise team chat", configPath: "plugins.entries.msteams" },
  { id: "matrix", displayName: "Matrix", icon: Globe, category: "chat", description: "Matrix protocol", configPath: "plugins.entries.matrix" },
  { id: "nostr", displayName: "Nostr", icon: Radio, category: "chat", description: "Decentralized DMs via NIP-04", configPath: "plugins.entries.nostr" },
  { id: "tlon", displayName: "Tlon Messenger", icon: MessagesSquare, category: "chat", description: "P2P ownership-first chat", configPath: "plugins.entries.tlon" },
  { id: "zalo", displayName: "Zalo", icon: MessageSquare, category: "chat", description: "Zalo Bot API", configPath: "plugins.entries.zalo" },
  { id: "zalouser", displayName: "Zalo Personal", icon: MessageSquare, category: "chat", description: "Personal account via QR login", configPath: "plugins.entries.zalouser" },
  { id: "mattermost", displayName: "Mattermost", icon: MessageSquareMore, category: "chat", description: "Self-hosted team chat", configPath: "plugins.entries.mattermost" },
  { id: "line", displayName: "LINE", icon: MessageCircle, category: "chat", description: "LINE Messaging API", configPath: "plugins.entries.line" },
  { id: "feishu", displayName: "Feishu (Lark)", icon: Building2, category: "chat", description: "Feishu/Lark bot integration", configPath: "plugins.entries.feishu" },
  { id: "googlechat", displayName: "Google Chat", icon: MessageSquare, category: "chat", description: "Google Workspace chat", configPath: "plugins.entries.googlechat" },
  { id: "nextcloud-talk", displayName: "Nextcloud Talk", icon: Server, category: "chat", description: "Self-hosted Nextcloud chat", configPath: "plugins.entries.nextcloud-talk" },
  { id: "synology-chat", displayName: "Synology Chat", icon: Server, category: "chat", description: "Synology NAS chat", configPath: "plugins.entries.synology-chat" },
  { id: "irc", displayName: "IRC", icon: Monitor, category: "chat", description: "Internet Relay Chat", configPath: "plugins.entries.irc" },
  { id: "twitch", displayName: "Twitch", icon: Tv, category: "chat", description: "Twitch chat integration", configPath: "plugins.entries.twitch" },
  { id: "xiaomi", displayName: "Xiaomi", icon: Smartphone, category: "chat", description: "Xiaomi smart assistant", configPath: "plugins.entries.xiaomi" },

  // ── AI Model Providers (32) ────────────────────────────────────────────
  { id: "anthropic", displayName: "Anthropic", icon: Brain, category: "ai-providers", description: "Claude Pro/Max + Opus", configPath: "plugins.entries.anthropic" },
  { id: "openai", displayName: "OpenAI", icon: Sparkles, category: "ai-providers", description: "GPT-4, GPT-5, o1", configPath: "plugins.entries.openai" },
  { id: "google", displayName: "Google", icon: Brain, category: "ai-providers", description: "Gemini 2.5 Pro/Flash", configPath: "plugins.entries.google" },
  { id: "deepseek", displayName: "DeepSeek", icon: Zap, category: "ai-providers", description: "DeepSeek V3 & R1", configPath: "plugins.entries.deepseek" },
  { id: "groq", displayName: "Groq", icon: Cpu, category: "ai-providers", description: "Ultra-fast inference", configPath: "plugins.entries.groq" },
  { id: "mistral", displayName: "Mistral", icon: Brain, category: "ai-providers", description: "Mistral Large & Codestral", configPath: "plugins.entries.mistral" },
  { id: "ollama", displayName: "Ollama", icon: Terminal, category: "ai-providers", description: "Local open-source models", configPath: "plugins.entries.ollama" },
  { id: "openrouter", displayName: "OpenRouter", icon: Globe, category: "ai-providers", description: "Unified API gateway", configPath: "plugins.entries.openrouter" },
  { id: "perplexity", displayName: "Perplexity", icon: Search, category: "ai-providers", description: "Search-augmented AI", configPath: "plugins.entries.perplexity" },
  { id: "together", displayName: "Together", icon: Cloud, category: "ai-providers", description: "Open-source model hosting", configPath: "plugins.entries.together" },
  { id: "xai", displayName: "xAI", icon: Sparkles, category: "ai-providers", description: "Grok 3 & 4", configPath: "plugins.entries.xai" },
  { id: "huggingface", displayName: "Hugging Face", icon: Bot, category: "ai-providers", description: "Open-source model hub", configPath: "plugins.entries.huggingface" },
  { id: "kimi", displayName: "Kimi", icon: Brain, category: "ai-providers", description: "Moonshot Kimi models", configPath: "plugins.entries.kimi" },
  { id: "minimax", displayName: "MiniMax", icon: Zap, category: "ai-providers", description: "MiniMax M2.5", configPath: "plugins.entries.minimax" },
  { id: "moonshot", displayName: "Moonshot", icon: Brain, category: "ai-providers", description: "Moonshot AI models", configPath: "plugins.entries.moonshot" },
  { id: "nvidia", displayName: "NVIDIA", icon: Cpu, category: "ai-providers", description: "NVIDIA NIM inference", configPath: "plugins.entries.nvidia" },
  { id: "vllm", displayName: "vLLM", icon: Server, category: "ai-providers", description: "Self-hosted vLLM engine", configPath: "plugins.entries.vllm" },
  { id: "sglang", displayName: "SGLang", icon: Server, category: "ai-providers", description: "SGLang serving engine", configPath: "plugins.entries.sglang" },
  { id: "amazon-bedrock", displayName: "Amazon Bedrock", icon: Cloud, category: "ai-providers", description: "AWS managed AI models", configPath: "plugins.entries.amazon-bedrock" },
  { id: "microsoft", displayName: "Microsoft Speech", icon: Volume2, category: "ai-providers", description: "Azure speech services", configPath: "plugins.entries.microsoft" },
  { id: "venice", displayName: "Venice", icon: Brain, category: "ai-providers", description: "Privacy-focused AI", configPath: "plugins.entries.venice" },
  { id: "byteplus", displayName: "BytePlus", icon: Cloud, category: "ai-providers", description: "BytePlus AI services", configPath: "plugins.entries.byteplus" },
  { id: "chutes", displayName: "Chutes", icon: Cloud, category: "ai-providers", description: "Chutes AI inference", configPath: "plugins.entries.chutes" },
  { id: "cloudflare-ai-gateway", displayName: "Cloudflare AI Gateway", icon: Cloud, category: "ai-providers", description: "Cloudflare edge AI", configPath: "plugins.entries.cloudflare-ai-gateway" },
  { id: "copilot-proxy", displayName: "Copilot Proxy", icon: Code, category: "ai-providers", description: "GitHub Copilot proxy", configPath: "plugins.entries.copilot-proxy" },
  { id: "github-copilot", displayName: "GitHub Copilot", icon: Code, category: "ai-providers", description: "GitHub Copilot models", configPath: "plugins.entries.github-copilot" },
  { id: "lobster", displayName: "Lobster", icon: Brain, category: "ai-providers", description: "Lobster AI models", configPath: "plugins.entries.lobster" },
  { id: "vercel-ai-gateway", displayName: "Vercel AI Gateway", icon: Globe, category: "ai-providers", description: "Hundreds of models, 1 API key", configPath: "plugins.entries.vercel-ai-gateway" },
  { id: "qianfan", displayName: "Qianfan", icon: Brain, category: "ai-providers", description: "Baidu Qianfan platform", configPath: "plugins.entries.qianfan" },
  { id: "volcengine", displayName: "Volcengine", icon: Cloud, category: "ai-providers", description: "ByteDance AI platform", configPath: "plugins.entries.volcengine" },
  { id: "modelstudio", displayName: "Model Studio", icon: Brain, category: "ai-providers", description: "Alibaba Model Studio", configPath: "plugins.entries.modelstudio" },
  { id: "qwen-portal-auth", displayName: "Qwen OAuth", icon: Brain, category: "ai-providers", description: "Qwen portal authentication", configPath: "plugins.entries.qwen-portal-auth" },

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
  { id: "acpx", displayName: "ACPX Runtime", icon: Terminal, category: "tools", description: "ACP runtime backend", configPath: "plugins.entries.acpx" },
  { id: "kilocode", displayName: "Kilo Gateway", icon: Code, category: "tools", description: "Kilo code gateway", configPath: "plugins.entries.kilocode" },
  { id: "open-prose", displayName: "OpenProse", icon: FileCode, category: "tools", description: "Prose editing tools", configPath: "plugins.entries.open-prose" },
  { id: "opencode", displayName: "OpenCode Zen", icon: Code, category: "tools", description: "Code editing provider", configPath: "plugins.entries.opencode" },
  { id: "opencode-go", displayName: "OpenCode Go", icon: Code, category: "tools", description: "Go code provider", configPath: "plugins.entries.opencode-go" },
  { id: "synthetic", displayName: "Synthetic", icon: Layers, category: "tools", description: "Synthetic data provider", configPath: "plugins.entries.synthetic" },
  { id: "thread-ownership", displayName: "Thread Ownership", icon: Puzzle, category: "tools", description: "Multi-agent thread routing", configPath: "plugins.entries.thread-ownership" },
  { id: "zai", displayName: "Z.AI", icon: Brain, category: "tools", description: "Z.AI provider", configPath: "plugins.entries.zai" },

  // ── Built-in Capabilities (6) ─────────────────────────────────────────
  { id: "builtin-voice", displayName: "Voice", icon: Volume1, category: "built-in", description: "9 preset speakers + voice cloning", configPath: "integrations.voice", hasBuiltinPanel: true },
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
