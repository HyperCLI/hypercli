import type { Metadata } from "next";
import Link from "next/link";
import {
  CodeSnippetCard,
  FAQBlock,
  Footer,
  GlassCard,
  Header,
  type FAQItem,
} from "@hypercli/shared-ui";
import {
  AuroraFinalCta,
  AuroraGlowFrame,
  AuroraHero,
  AuroraHeroHeading,
  AuroraHeroLead,
  MarketingActionGroup,
  MarketingBand,
  MarketingContainer,
  MarketingEyebrow,
  MarketingShell,
  marketingCtaClassName,
} from "@hypercli/shared-ui/marketing";
import { Bot, KeyRound } from "lucide-react";
import { InferenceCostCalculator } from "@/components/inference-cost-calculator";
import { GetStartedLink } from "@/components/get-started-link";

export const metadata: Metadata = {
  title: "HyperCLI Inference — Frontier models. Flat rate. No meter.",
  description:
    "Kimi K2.6 and K3 behind OpenAI- and Anthropic-compatible APIs, Qwen embeddings + TTS included. Up to 100M tokens/day, flat.",
};

const SWITCH_SNIPPET = `const client = new OpenAI({
  baseURL: "https://api.hypercli.com/v1",
  apiKey: process.env.HYPER_KEY });`;

const CURL_SNIPPET = `$ curl https://api.hypercli.com/v1/chat/completions \\
  -H "Authorization: Bearer $HYPER_KEY" \\
  -d '{"model":"kimi-k2.6","messages":[...]}'`;

const AGENT_SNIPPET = `$ hyper agents create my-agent
✓ live on its own machine`;

const MODELS = [
  {
    role: "Standard · chat · vision · tools",
    name: "Kimi K2.6",
    body: "The workhorse. A 1T-parameter MoE built for long-horizon coding and autonomous execution — it beat GPT-5.5 at coding on release. 256K context, agent swarms to 300 sub-agents.",
  },
  {
    role: "Advanced · chat · vision · tools",
    name: "Kimi K3",
    highlighted: true,
    body: "The heavyweight. 2.8T parameters — the largest open model ever released — reading entire repos in a single 1M-token prompt. Beats Fable 5 on Terminal-Bench; #1 in blind frontend testing.",
  },
  {
    role: "Included · memory · voice",
    name: "Qwen Embeddings + TTS",
    body: "The quiet ones. Dense open models running your embeddings, vector search, agent memory, and voice — at no extra cost.",
  },
];

const FAQ_ITEMS: FAQItem[] = [
  {
    q: "100M tokens a day — what's the catch?",
    a: "There isn't a hidden one. The allowance resets daily, and we can offer it flat because we run open models on a global fabric of aggregated GPU capacity. Fair-use terms apply to automated abuse (key sharing, resale), not to heavy legitimate use.",
  },
  {
    q: "What happens if I hit the cap?",
    a: "Requests throttle until the daily reset — you never get a surprise bill. Need more headroom? Add another key and keep going: each subscription carries its own allowance, so scaling up is a checkout, not a negotiation.",
  },
  {
    q: "Is it really OpenAI-compatible?",
    a: "Yes — and Anthropic-compatible too. Standard /v1/chat/completions and /v1/messages surfaces with streaming, tool calling, and vision. OpenAI SDKs, Anthropic SDKs, LangChain, and LlamaIndex all work by changing the base URL and key.",
  },
  {
    q: "Do you train on my data?",
    a: "No. Prompts and completions are not used for training.",
  },
  {
    q: "Why open models instead of a frontier lab API?",
    a: "Kimi K2.6 beats GPT-5.5 at coding, and Pro gets the frontier K3. Open weights mean no vendor lock-in — the models that run your workload are public, so you can verify claims and always have an exit.",
  },
  {
    q: "API key vs. full agent — which should I pick?",
    a: "If you're adding inference to an existing app, take the key. If you want an always-on agent with a browser, voice, memory, and channels, deploy the agent — and you can add the other later on the same account.",
  },
];

export default function InferencePage() {
  return (
    <MarketingShell header={<Header />} footer={<Footer />} headerClearance="section-nav">
      {/* Hero */}
      <AuroraHero backdropVariant="standard">
        <MarketingEyebrow>Inference</MarketingEyebrow>
        <AuroraHeroHeading>
          Frontier models. Flat rate.
          <br />
          <span className="gradient-text-primary">No meter.</span>
        </AuroraHeroHeading>
        <AuroraHeroLead>
          Kimi K2.6 and K3 behind OpenAI- and Anthropic-compatible APIs, with Qwen embeddings + TTS included. Up
          to 100 million tokens a day — your bill never moves.
        </AuroraHeroLead>
        <MarketingActionGroup className="mb-11">
          <GetStartedLink label="Get an API key" className={marketingCtaClassName()} />
          <GetStartedLink
            label="Deploy a full agent"
            toAgentDashboard
            className={marketingCtaClassName({ variant: "secondary" })}
          />
        </MarketingActionGroup>
        <AuroraGlowFrame className="max-w-[560px]">
          <CodeSnippetCard
            label="two lines to switch — either SDK"
            code={SWITCH_SNIPPET}
            className="relative"
          />
        </AuroraGlowFrame>
        <p className="mt-7 text-sm text-text-muted">
          Works with OpenAI and Anthropic SDKs, LangChain, LlamaIndex — anything speaking /v1/chat/completions or
          /v1/messages.
        </p>
      </AuroraHero>

      {/* Cost calculator */}
      <MarketingBand bordered className="text-center">
        <MarketingContainer width="4xl">
          <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What would your volume <span className="text-primary">cost elsewhere?</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Published list prices, July 2026. Drag to your daily usage.
          </p>
          <InferenceCostCalculator />
        </MarketingContainer>
      </MarketingBand>

      {/* Every model, one key */}
      <MarketingBand spacing="compact">
        <MarketingContainer className="rounded-3xl bg-surface-low px-8 py-16 text-center">
          <h2 className="mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Every model, <span className="text-primary">one key.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
            Open weights, frontier results. Numbers below are published benchmarks, not our marketing.
          </p>
          <div className="grid gap-5 text-left md:grid-cols-3">
            {MODELS.map((model) => (
              <GlassCard key={model.name} interactive highlighted={model.highlighted} className="p-7">
                <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                  {model.role}
                </p>
                <h3 className="mb-2.5 text-xl font-bold tracking-tight text-foreground">{model.name}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{model.body}</p>
              </GlassCard>
            ))}
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* Two ways in */}
      <MarketingBand bordered>
        <MarketingContainer width="5xl">
          <h2 className="mb-4 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Two ways <span className="text-primary">in.</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-lg text-text-secondary">
            Same models, same flat rate. Start where you are.
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            <GlassCard className="flex flex-col p-7 sm:p-8">
              <h3 className="mb-3.5 flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
                <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
                Just the API
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-text-secondary">
                You have an app. Point it here. No migration, no new SDK — your OpenAI or Anthropic code runs
                unmodified.
              </p>
              <CodeSnippetCard label="terminal" code={CURL_SNIPPET} className="flex flex-1 flex-col" preClassName="flex-1" />
              <p className="mt-5 text-sm">
                <GetStartedLink label="Get an API key →" className="font-semibold text-primary hover:underline" />
              </p>
            </GlassCard>
            <GlassCard highlighted className="flex flex-col p-7 sm:p-8">
              <h3 className="mb-3.5 flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
                <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
                The whole agent
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-text-secondary">
                Same inference — plus a cloud machine that&apos;s always on, with browser, desktop, voice, media, memory,
                and every channel. The models are the brain; this is the body.
              </p>
              <CodeSnippetCard label="terminal" code={AGENT_SNIPPET} className="flex flex-1 flex-col" preClassName="flex-1" />
              <p className="mt-5 text-sm">
                <Link href="/capabilities" className="font-semibold text-primary hover:underline">
                  See everything it can do →
                </Link>
              </p>
            </GlassCard>
          </div>
        </MarketingContainer>
      </MarketingBand>

      {/* FAQ */}
      <MarketingBand spacing="compact">
        <MarketingContainer width="5xl" className="rounded-3xl bg-surface-low px-8 py-16 sm:px-14">
          <h2 className="mb-12 text-center text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Questions you <span className="text-primary">should be asking.</span>
          </h2>
          <FAQBlock items={FAQ_ITEMS} />
        </MarketingContainer>
      </MarketingBand>

      {/* Closer */}
      <AuroraFinalCta
        heading={
          <>
            Stop <span className="gradient-text-primary">counting tokens.</span>
          </>
        }
        description="Frontier inference, one flat bill. Live in minutes either way."
        actions={
          <MarketingActionGroup>
            <GetStartedLink
              label="Get an API key"
              className={marketingCtaClassName({ size: "final" })}
            />
            <GetStartedLink
              label="Deploy a full agent"
              toAgentDashboard
              className={marketingCtaClassName({ variant: "terminal-secondary", size: "final" })}
            />
          </MarketingActionGroup>
        }
      />
    </MarketingShell>
  );
}
