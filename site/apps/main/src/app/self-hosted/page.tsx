import type { Metadata } from "next";
import Link from "next/link";
import { Footer, GlassCard, Header, MetricCard } from "@hypercli/shared-ui";
import {
  Check,
  Cloud,
  Code,
  Factory,
  FileBadge,
  Gauge,
  Headset,
  ListChecks,
  Lock,
  Package,
  RefreshCw,
  Server,
  ShieldCheck,
  Unplug,
} from "lucide-react";

export const metadata: Metadata = {
  title: "HyperCLI Self-Hosted — The whole platform. Inside your walls.",
  description:
    "The entire HyperCLI suite — open-weight models, agent orchestration, inference gateway, GPU scheduling — running on your infrastructure. Your hardware, your network, your rules.",
};

const VALUE_CARDS = [
  {
    icon: Gauge,
    title: "The meter is gone. For good.",
    body: "One platform fee, your own compute. A thousand agents running around the clock costs the same as ten. Your AI budget becomes a line item, not a variable you explain to finance every quarter.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing leaves your network.",
    body: "Prompts, outputs, memory, embeddings — all of it stays on your hardware, with air-gapped deployment available. And because the models are open-weight, there's no lock-in to escape: if you ever leave, the weights stay. Closed labs structurally can't offer either.",
  },
  {
    icon: Factory,
    title: "Build AI like you build software.",
    body: "Not a vendor's chatbot in your sidebar — a factory floor. Every team gets agents, every workflow becomes automatable, and the models themselves learn your business: fine-tune on your own data, on your own GPUs.",
  },
];

const IN_THE_BOX = [
  {
    lead: "Open-weight models, in-house",
    body: "Kimi K2.6, K3, and Qwen embeddings + TTS running on your GPUs, with our serving stack and update pipeline",
  },
  {
    lead: "Fine-tuning pipeline",
    body: "tune models on your own data, on your own hardware; your fine-tunes never leave and are yours to keep",
  },
  {
    lead: "Agent orchestration",
    body: "the full pod system: always-on agents with browser, voice, media, memory, and channels",
  },
  {
    lead: "Inference gateway",
    body: "OpenAI- and Anthropic-compatible endpoints for every internal team and existing app",
  },
  {
    lead: "GPU scheduling",
    body: "the same job system from our cloud, pointed at your cluster: containers, queues, observability",
  },
  {
    lead: "Fleet administration",
    body: "scoped keys, budgets, workspaces with roles, audit logs, SSO/SAML",
  },
  {
    lead: "White-glove deployment",
    body: "our engineers stand it up with yours; a named engineer stays on your account",
  },
];

const FACTORY_CARDS = [
  {
    icon: Code,
    title: "Engineering",
    body: "Agents that triage incidents, review PRs, and watch deployments — on repos that never leave your network.",
  },
  {
    icon: Headset,
    title: "Operations",
    body: "Back-office automation with full audit trails — claims, invoices, compliance checks, on internal systems.",
  },
  {
    icon: Package,
    title: "Product",
    body: "Ship AI features on your own inference — no per-user token math wrecking your unit economics. Tune the model to your domain and it's a moat, not a vendor bill.",
  },
];

const CFO_STATS = [
  { label: "Metered APIs at scale", value: "$100K+", detail: "/mo, growing", highlighted: false },
  { label: "Build it yourself", value: "18 mo", detail: "+ 10 engineers", highlighted: false },
  { label: "Self-hosted HyperCLI", value: "from $20K", detail: "/mo", highlighted: true },
];

const RUNS_WHERE = [
  {
    icon: Cloud,
    title: "Your cloud VPC",
    body: "AWS, GCP, Azure — inside your account, your IAM, your VPC.",
  },
  {
    icon: Server,
    title: "Your datacenter",
    body: "On-prem on your GPU cluster, integrated with your stack.",
  },
  {
    icon: Unplug,
    title: "Air-gapped",
    body: "Fully disconnected deployment for regulated and sovereign environments.",
  },
];

const FEATURE_CHIPS = [
  { icon: Lock, label: "SSO / SAML" },
  { icon: FileBadge, label: "SOC 2" },
  { icon: ListChecks, label: "Audit logs" },
  { icon: Headset, label: "Named engineer" },
  { icon: RefreshCw, label: "Managed model updates" },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function SelfHostedPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>HyperCLI Self-Hosted</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              The whole platform.
              <br />
              <span className="gradient-text-primary">Inside your walls.</span>
            </h1>
            <p className="mx-auto mb-4 max-w-2xl text-lg leading-relaxed text-text-secondary">
              The entire HyperCLI suite — open-weight models, agent orchestration, inference gateway, GPU scheduling —
              running on your infrastructure. Your hardware, your network, your rules.
            </p>
            <p className="mb-8 text-sm text-text-muted">
              Starting at $20,000/mo · Unlimited agents · No per-token pricing, ever
            </p>
            <div className="flex flex-wrap justify-center gap-3.5">
              <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-3.5 text-base font-semibold">
                Talk to engineering
              </Link>
              <Link
                href="/pricing"
                className="btn-secondary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
              >
                Get the architecture brief
              </Link>
            </div>
          </div>
        </section>

        {/* Value cards */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VALUE_CARDS.map((card) => (
              <GlassCard key={card.title} interactive className="p-7">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </span>
                <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{card.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{card.body}</p>
              </GlassCard>
            ))}
          </div>
        </section>

        {/* What's in the box */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What's in <span className="text-primary">the box.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Everything cloud customers get — deployed by our engineers, run by yours.
            </p>
            <div className="grid gap-6 text-left sm:grid-cols-2">
              {IN_THE_BOX.map((item) => (
                <div key={item.lead} className="flex items-start gap-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/15">
                    <Check className="h-4.5 w-4.5 text-success" aria-hidden="true" />
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    <b className="font-semibold text-foreground">{item.lead}</b> — {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The software factory */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              The software <span className="text-primary">factory.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-lg text-text-secondary">
              The question stops being "which AI vendor?" and becomes "what should we build this week?" — with models
              that get better at your business the longer you run them.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {FACTORY_CARDS.map((card) => (
                <GlassCard key={card.title} interactive className="p-7">
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{card.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* CFO math */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              The math your CFO <span className="text-primary">will do anyway.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-lg text-text-secondary">
              Enterprises running serious agent workloads on metered APIs routinely clear $100K+/month — and the bill
              grows with success. Building this platform internally is a 10-engineer, 18-month project. Self-hosted
              HyperCLI is neither.
            </p>
            <div className="mx-auto grid max-w-3xl gap-4 text-left sm:grid-cols-3">
              {CFO_STATS.map((stat) => (
                <MetricCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  detail={stat.detail}
                  highlighted={stat.highlighted}
                  className="p-6 text-center"
                />
              ))}
            </div>
          </div>
        </section>

        {/* Runs where you run */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-12 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Runs where <span className="text-primary">you run.</span>
            </h2>
            <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
              {RUNS_WHERE.map((card) => (
                <GlassCard key={card.title} interactive className="p-7 text-center">
                  <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <card.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{card.body}</p>
                </GlassCard>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {FEATURE_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className="flex items-center gap-1.5 rounded-full border border-border-medium bg-surface px-4 py-2 text-sm font-medium text-text-secondary"
                >
                  <chip.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  {chip.label}
                </span>
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
                Own the factory, not just the output.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                A working pilot on your hardware in 30 days. Talk to an engineer, not a sales deck.
              </p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <Link href="/pricing" className="btn-primary inline-block rounded-full px-8 py-4 text-base font-semibold">
                  Talk to engineering
                </Link>
                <Link
                  href="/pricing"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                >
                  Get the architecture brief
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
