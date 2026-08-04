import type { Metadata } from "next";
import {
  CodeSnippetCard,
  Footer,
  GlassCard,
  Header,
} from "@hypercli/shared-ui";
import { GetStartedLink } from "@/components/get-started-link";
import {
  CheckCircle2,
  Cpu,
  Database,
  Images,
  MessageCircle,
  Mic,
  Monitor,
  Network,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "HyperCLI — Everything your agent can do",
  description:
    "The complete surface of an agent on HyperCLI: inference, media, voice, browser, memory, self-management, channels, GPU, and fleet — every capability on every agent.",
};

interface Capability {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  docsHref: string;
  lead: string;
  uses: string;
  specs: { term: string; detail?: string }[];
  snippetLabel: string;
  snippet: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: Zap,
    title: "Inference",
    docsHref: "https://docs.hypercli.com/inference/index",
    lead: "Your agent thinks with frontier models — and anything you've already built against OpenAI works here unmodified.",
    uses: "pointing an existing app at a new brain · streaming replies into buzz · agents that call tools mid-answer",
    specs: [
      { term: "Chat completion", detail: "K2.6 / K3, streaming supported" },
      { term: "Vision", detail: "image understanding on all models" },
      { term: "Tool calling", detail: "via chat stream events" },
      { term: "Standard surface", detail: "/v1/models, /v1/chat/completions" },
    ],
    snippetLabel: "sdk",
    snippet: 'const res = await hyper.chat.completions.create({\n  model: "kimi-k3", messages, stream: true });',
  },
  {
    icon: Images,
    title: "Media generation",
    docsHref: "https://docs.hypercli.com/flows/index",
    lead: "Your agent can show you things, not just tell you — images and video, generated and delivered without leaving the platform.",
    uses: "a product shot turned into a demo video · fresh thumbnails on every post · a lip-synced explainer straight from a script",
    specs: [
      { term: "Text-to-image", detail: "standard and HiDream" },
      { term: "Text-to-video", detail: "image-to-video, image-to-image" },
      { term: "Speaking video", detail: "lip-sync from image + audio" },
      { term: "First/last frame", detail: "interpolate between start and end images" },
      { term: "File inputs", detail: "upload images and audio as sources" },
      { term: "Pricing holds", detail: "$0.10/image, $0.25/video, refunded on failure" },
    ],
    snippetLabel: "sdk",
    snippet: "const render = await hyper.media.speakingVideo({ image, audio });\nconst url = await render.wait();",
  },
  {
    icon: Mic,
    title: "Voice and audio",
    docsHref: "https://docs.hypercli.com/cli/commands/agent",
    lead: "You talk to your agent, your agent talks back. Real conversation in both directions — not text with a speaker bolted on.",
    uses: "voice notes from your commute, transcribed and acted on · your morning digest read aloud · a voice you designed for your brand",
    specs: [
      { term: "TTS", detail: "multi-voice, instant, in mp3 · wav · opus · ogg · flac" },
      { term: "Voice cloning", detail: "from reference audio, x-vector-only mode" },
      { term: "Voice design", detail: "synthesize a voice from a text description" },
      { term: "Streaming", detail: "chunked audio over WebSocket" },
      { term: "Transcription", detail: "local faster-whisper, turbo and large-v3" },
    ],
    snippetLabel: "terminal",
    snippet: "$ hyper voice clone --ref sample.wav --name my-voice\n$ hyper voice transcribe meeting.mp3 --model large-v3",
  },
  {
    icon: Monitor,
    title: "Browser and desktop",
    docsHref: "https://docs.hypercli.com/agents/index",
    lead: "Your agent can go get things done on the web the way you would — click, fill, navigate — and on Pro pods you can literally watch it work.",
    uses: "checking a competitor's pricing page every morning · filling the form nobody wants to fill · researching across twenty tabs at once",
    specs: [
      { term: "Browser automation", detail: "Playwright-backed: snapshots, clicks, form fill, navigation" },
      { term: "Multi-tab", detail: "parallel sessions in one browser" },
      { term: "Desktop", detail: "VNC / browser-based desktop on OpenClaw Pro pods" },
      { term: "Web search", detail: "built-in search proxy, no separate key" },
    ],
    snippetLabel: "sdk",
    snippet: 'await hyper.browser.goto("https://news.ycombinator.com");\nconst snap = await hyper.browser.snapshot();',
  },
  {
    icon: Database,
    title: "Memory and knowledge",
    docsHref: "https://docs.hypercli.com/sdk/gateway",
    lead: "Your agent remembers what you told it last month, so you never explain anything twice — and teams can share what it knows.",
    uses: '"what did we decide about pricing?" · a shared workspace that onboards new teammates · importing your docs once, searching them forever',
    specs: [
      { term: "Agent memory", detail: "vector search over daily notes and memory files" },
      { term: "Workspaces", detail: "shared knowledge spaces with semantic search" },
      { term: "Ingestion", detail: "upload files with metadata, auto markdown conversion" },
      { term: "Access control", detail: "viewer / contributor / admin roles, expiring grants" },
      { term: "Sync", detail: "bulk-download workspace manifests to local disk" },
      { term: "Import", detail: "pull existing sources into agent memory via CLI" },
    ],
    snippetLabel: "sdk · cli",
    snippet: 'const hits = await hyper.memory.search("q3 launch decisions");\n$ hyper memory import ./project-docs/',
  },
  {
    icon: Settings2,
    title: "Self-management",
    docsHref: "https://docs.hypercli.com/sdk/gateway",
    lead: "You don't operate this agent — it operates itself. Tell it what you want; it configures, schedules, and upgrades on its own.",
    uses: '"send me a digest at 7am" and it writes its own cron · installing a PDF skill mid-task · tuning its own model config',
    specs: [
      { term: "Config", detail: "read, patch, and apply models, tools, channels, cron, memory" },
      { term: "Cron", detail: "list, add, remove, and trigger its own scheduled jobs" },
      { term: "Skills", detail: "install from ClawHub with security verdicts before install" },
      { term: "Plugins", detail: "install, enable, disable, refresh at runtime" },
      { term: "Sessions", detail: "list, preview history, patch metadata, reset" },
      { term: "Nodes", detail: "pair external machines, invoke remote commands" },
    ],
    snippetLabel: "sdk",
    snippet: 'await gateway.cron.add({ schedule: "0 7 * * *", task: "daily-digest" });\nawait gateway.skills.install("clawhub:pdf-tools");',
  },
  {
    icon: MessageCircle,
    title: "Channels",
    docsHref: "https://docs.hypercli.com/sdk/gateway",
    lead: "Your agent lives where you already talk — and it speaks first when something matters, instead of waiting to be asked.",
    uses: '"the build broke" in Slack before you noticed · a community bot that\'s native to buzz · one agent reachable from your phone',
    specs: [
      { term: "buzz", detail: "native, no bridge or wrapper" },
      { term: "Slack", detail: "relay, socket mode, or HTTP" },
      { term: "Telegram and WhatsApp", detail: "full configure / start / stop / logout" },
      { term: "Proactive messages", detail: "agent-initiated, any configured channel" },
      { term: "Integrations", detail: "managed connector auth: start, status, disconnect" },
    ],
    snippetLabel: "sdk",
    snippet: 'await gateway.channels.configure("slack", { mode: "socket" });\nawait gateway.messages.send({ channel: "buzz", text: "build is green" });',
  },
  {
    icon: Cpu,
    title: "Compute and GPU",
    docsHref: "https://docs.hypercli.com/instances/index",
    lead: "When a task outgrows inference, your agent can requisition real hardware — and it prices the job before spending a cent.",
    uses: "an overnight fine-tune on spot H100s · a ComfyUI render pipeline · batch-transcribing a year of recordings",
    specs: [
      { term: "GPU jobs", detail: "arbitrary containers: image, command, env, ports" },
      { term: "Hardware", detail: "L40S, H100, by count and region; spot or on-demand" },
      { term: "Dry-run pricing", detail: "validate and price before spending" },
      { term: "Lifecycle", detail: "create, monitor, extend, cancel, exec, interactive shell" },
      { term: "Observability", detail: "WebSocket log tail; GPU utilization, memory, temp, power" },
      { term: "ComfyUI", detail: "template workflows with node install and progress tracking" },
    ],
    snippetLabel: "terminal",
    snippet: "$ hyper instances launch train:latest -g h100 -n 2 --dry-run\n→ est. $4.12/hr · capacity available in us-east",
  },
  {
    icon: Network,
    title: "Fleet and platform",
    docsHref: "https://docs.hypercli.com/agents/index",
    lead: "One agent becomes a team. Yours can hire help — spin up siblings for big jobs, each with scoped credentials and a budget it can't exceed.",
    uses: "a research sibling spun up for one project · splitting a scrape across five agents · delegation with a 30-day key and a hard cap",
    specs: [
      { term: "Sibling agents", detail: "create, start, stop, resize, delete pods" },
      { term: "Scoped keys", detail: "child API keys per agent, with tags and expiration" },
      { term: "Budget and quota", detail: "check available agent slots and usage first" },
      { term: "Files", detail: "read/write across live pod, S3 backup, and gateway storage" },
      { term: "Remote exec", detail: "commands with timeouts, or a full WebSocket PTY" },
    ],
    snippetLabel: "sdk",
    snippet: 'const pod = await hyper.pods.create({ type: "openclaw-pro" });\nconst key = await hyper.keys.createScoped({ agent: pod.id, ttl: "30d" });',
  },
];

const MODELS = [
  {
    role: "Chat · vision · tools",
    name: "Kimi K2.6",
    body: "1T-param MoE, 256K context. Beat GPT-5.5 at coding; agent swarms to 300 sub-agents.",
  },
  {
    role: "Chat · vision · tools",
    name: "Kimi K3",
    badge: "Pro",
    body: "2.8T params, 1M context — the largest open model ever released. #1 in blind frontend testing.",
  },
  {
    role: "Memory · embeddings",
    name: "Qwen Embeddings + TTS",
    body: "Dense open models powering vector search, memory, and your agent's voice.",
  },
];

export default function CapabilitiesPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-14 pt-26 text-center">
          <div className="relative mx-auto max-w-4xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">Capabilities</p>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Everything your agent <span className="gradient-text-primary">can do.</span>
            </h1>
            <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-secondary">
              The complete surface of an agent running on HyperCLI — SDK, CLI, gateway, and platform. This is the
              spec, not the pitch.
            </p>
            <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-success/10 px-6 py-4 text-left">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden="true" />
              <p className="text-sm font-medium text-success">
                Everything on this page ships with every agent, out of the box. One API key covers all of it — no
                add-ons, no per-feature pricing, no upgrade gates.
              </p>
            </div>
          </div>
        </section>

        {/* Capability spec cards */}
        <section className="px-6 pb-10">
          <div className="mx-auto grid max-w-5xl gap-5">
            {CAPABILITIES.map((cap) => (
              <GlassCard key={cap.title} className="p-7 sm:p-9">
                <div className="mb-4 flex flex-wrap items-center gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                    <cap.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">{cap.title}</h2>
                  <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                    every agent
                  </span>
                  <a
                    href={cap.docsHref}
                    className="ml-auto text-sm font-semibold text-primary hover:underline"
                  >
                    Docs →
                  </a>
                </div>
                <p className="mb-2 max-w-3xl leading-relaxed text-foreground">{cap.lead}</p>
                <p className="mb-6 flex items-start gap-2 text-sm text-text-secondary">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>Use it for: {cap.uses}</span>
                </p>
                <ul className="mb-6 grid gap-x-7 gap-y-2 sm:grid-cols-2">
                  {cap.specs.map((spec) => (
                    <li key={spec.term} className="flex gap-2 text-sm text-text-secondary">
                      <span aria-hidden="true" className="text-text-muted">—</span>
                      <span>
                        <b className="font-semibold text-foreground">{spec.term}</b>
                        {spec.detail && <> — {spec.detail}</>}
                      </span>
                    </li>
                  ))}
                </ul>
                <CodeSnippetCard label={cap.snippetLabel} code={cap.snippet} />
              </GlassCard>
            ))}
          </div>
        </section>

        {/* The models underneath */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-8 py-16 text-center">
            <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              The models <span className="gradient-text-primary">underneath.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Three open frontier models, pre-wired into every agent. No provisioning, no separate bills.
            </p>
            <div className="grid gap-5 text-left md:grid-cols-3">
              {MODELS.map((model) => (
                <GlassCard key={model.name} interactive highlighted={model.badge === "Pro"} className="p-7">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    {model.role}
                  </p>
                  <h3 className="mb-2.5 flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
                    {model.name}
                    {model.badge && (
                      <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                        {model.badge}
                      </span>
                    )}
                  </h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{model.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* Closer */}
        <section className="px-6 pb-18 pt-4">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-terminal-background px-8 py-20 text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_70%_at_22%_0%,rgb(var(--button-primary-rgb)_/_0.24),transparent_60%),radial-gradient(50%_65%_at_82%_12%,rgb(108_232_196_/_0.15),transparent_60%),radial-gradient(45%_60%_at_55%_100%,rgb(169_126_255_/_0.15),transparent_65%)]"
            />
            <div className="relative">
              <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-terminal-foreground sm:text-5xl">
                One SDK. One CLI. <span className="gradient-text-primary">One bill.</span>
              </h2>
              <p className="mb-9 text-lg text-text-secondary">Every capability above, live in under 5 minutes.</p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <GetStartedLink
                  label="Deploy your first agent"
                  toAgentDashboard
                  className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold"
                />
                <a
                  href="https://docs.hypercli.com"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                >
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
