/** Rich descriptions for high-priority integrations. Keyed by plugin ID. */
export const DIRECTORY_DESCRIPTIONS: Record<string, string> = {
  // Web
  duckduckgo:
    "Search the web without needing an API key. Your agent can look up current information, find answers, and research topics in real time. The simplest way to give your agent web access — just enable it.",
  brave:
    "Fast, privacy-focused web search with an API. Returns rich results including summaries and news. Requires a free API key from Brave.",
  tavily:
    "AI-optimized search built for agents. Returns clean, relevant results with extracted content — less noise than traditional search. Great for research-heavy workflows.",
  exa:
    "Semantic search that understands meaning, not just keywords. Best for finding specific types of content like research papers, documentation, or niche topics.",
  firecrawl:
    "Reads and extracts content from any web page. While search tools find pages, Firecrawl reads them deeply — pulling text, markdown, and structured data. Pair with a search tool for full web access.",

  // Channels
  telegram:
    "Connect your agent to Telegram. Users can DM your agent or add it to group chats. One of the easiest channels to set up — create a bot with BotFather and paste the token.",
  discord:
    "Bring your agent into Discord servers. It can respond to messages, join conversations, and help your community. Set up a Discord bot and invite it to your server.",
  slack:
    "Add your agent to your Slack workspace. It can respond in channels and DMs, making it accessible to your whole team without leaving the tools they already use.",
  whatsapp:
    "Connect your agent to WhatsApp. Requires scanning a QR code through the Shell tab — your agent gets its own WhatsApp session.",
  signal:
    "Privacy-first messaging through Signal. Your agent can receive and respond to encrypted messages. Requires signal-cli registration via the Shell tab.",
  msteams:
    "Bring your agent into Microsoft Teams. Works with Azure Bot registration — your team can chat with the agent directly in their existing workspace.",

  // Tools
  "memory-core":
    "Gives your agent persistent memory across conversations. It remembers context, preferences, and past interactions. Built-in and ready to go — just enable it.",
  "memory-lancedb":
    "Vector-powered memory for smarter recall. Your agent can search through past conversations by meaning, not just keywords. Upgrade from Core memory for agents that handle complex, ongoing work.",
  openshell:
    "Lets your agent execute shell commands in a sandboxed environment. Essential for agents that need to run code, install packages, or automate system tasks.",
  "diagnostics-otel":
    "OpenTelemetry diagnostics for monitoring agent health. Track performance, identify bottlenecks, and debug issues with your agent's runtime.",

  // Media
  "builtin-voice":
    "Your agent can speak aloud with 9 preset voices, or clone any voice from a short audio sample. Uses Qwen3-TTS for natural, expressive speech.",
  "builtin-speech":
    "Transcribes audio files in any language. Send your agent a voice memo and it converts it to text automatically. Powered by Faster-Whisper.",
  "builtin-vision":
    "Your agent can see and understand images. Send a screenshot, photo, or diagram and ask questions about it.",
  "builtin-images":
    "Generate images from text descriptions or edit existing images. Your agent can create illustrations, diagrams, and visual content on demand.",
  "builtin-video":
    "Create short videos from text descriptions or images. Your agent can produce visual content for presentations, social media, or documentation.",
  "builtin-3d":
    "Turn images into 3D models. Upload a photo of an object and your agent generates a textured 3D model you can rotate and inspect.",
};

/** Get the rich description for a plugin, falling back to the registry description */
export function getPluginDescription(pluginId: string, registryDescription: string): string {
  return DIRECTORY_DESCRIPTIONS[pluginId] ?? registryDescription;
}
