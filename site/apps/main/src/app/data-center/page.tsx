import type { Metadata } from "next";
import { Footer, GlassCard, Header, TerminalWindow } from "@hypercli/shared-ui";
import { Bot, Check, CircleCheck, ImagePlay, Settings, Zap } from "lucide-react";
import { ContactCta } from "@/components/contact-cta";
import { EarningsCalculator } from "@/components/earnings-calculator";

export const metadata: Metadata = {
  title: "HyperCLI for Data Centers — Turn idle GPUs into revenue",
  description:
    "One command connects your racks to a global fabric of always-on workloads. No SLAs, no commitments, monthly payouts.",
};

const TERMINAL_LINES = [
  { tone: "cmd" as const, text: "docker run hyperdc/agent" },
  { tone: "success" as const, text: "✓ 8× H100 discovered · validated · job-ready" },
  { tone: "success" as const, text: "→ routing workloads" },
];

const DEMAND_CARDS = [
  {
    icon: Bot,
    title: "Always-on agents",
    body: "Customer agents run around the clock — browsing, building, remembering. Demand that never clocks out.",
  },
  {
    icon: Zap,
    title: "Flat-rate inference",
    body: "Subscribers with daily token allowances they actually use. Steady, predictable draw.",
  },
  {
    icon: ImagePlay,
    title: "Media and training",
    body: "Image, video, voice, fine-tuning, and batch pipelines — the bursty work that fills the gaps.",
  },
];

const NEVER_SIGN_UP_FOR = [
  {
    lead: "No SLAs or uptime guarantees",
    body: "Connect whenever, disconnect anytime",
  },
  {
    lead: "No capacity commitments",
    body: "Sell us your idle hours, keep your clients' peak hours",
  },
  {
    lead: "No support burden",
    body: "Customers are ours; the 2am page is ours too",
  },
  {
    lead: "No inbound traffic",
    body: "The agent dials out; your network posture stays closed",
  },
];

const WE_RUN_CHIPS = [
  "Scheduling",
  "Routing",
  "Autoscaling",
  "GPU splitting",
  "Model placement",
  "Failover",
  "Billing + metering",
  "Isolation + security",
];

const FIT_CHIPS = [
  "Regional colos",
  "GPU hosting providers",
  "HPC and research clusters",
  "Sovereign and private clouds",
  "Mixed fleets — H100 to L40S",
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function DataCenterPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[6%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>For data centers</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Your GPUs sleep eight hours a night.
              <br />
              <span className="gradient-text-primary">Our agents don't.</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-text-secondary">
              HyperCLI routes a global fabric of always-on agent, inference, and media workloads to idle GPU capacity.
              One command connects your racks. Revenue starts the same hour — no SLAs, no commitments, no sales team
              required.
            </p>
            <div className="relative mx-auto mb-10 max-w-lg">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-[6%_-7%_-12%_-7%] bg-[radial-gradient(50%_65%_at_32%_60%,rgb(var(--button-primary-rgb)_/_0.20),transparent_70%),radial-gradient(50%_65%_at_72%_55%,rgb(108_232_196_/_0.16),transparent_70%)] blur-[34px]"
              />
              <TerminalWindow title="hyperdc — zsh" lines={TERMINAL_LINES} typed className="relative text-left" />
            </div>
            <ContactCta
              source="data-center"
              primaryLabel="Get the data center deck"
              secondaryLabel="Talk to partnerships"
            />
          </div>
        </section>

        {/* Why the work never runs out */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Why the work <span className="text-primary">never runs out.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-lg text-text-secondary">
              Most GPU marketplaces list your capacity and hope. We sell flat-rate plans to thousands of customers —
              which only works if capacity never idles. Your racks are the other half of our business model.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {DEMAND_CARDS.map((card) => (
                <GlassCard key={card.title} interactive className="bg-background p-7">
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

        {/* Earnings calculator */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What your fleet earns <span className="text-primary">while you do nothing.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Drag to your fleet size. Estimates at current fabric rates.*
            </p>
            <EarningsCalculator />
          </div>
        </section>

        {/* The deal */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 sm:px-12">
            <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
              <GlassCard interactive className="bg-background p-7">
                <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
                  What you never sign up for
                </h3>
                <ul className="space-y-4">
                  {NEVER_SIGN_UP_FOR.map((item) => (
                    <li key={item.lead} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      <span>
                        <b className="block font-semibold text-foreground">{item.lead}</b>
                        {item.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </GlassCard>
              <GlassCard interactive className="bg-background p-7">
                <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <Settings className="h-5 w-5 text-primary" aria-hidden="true" />
                  What we run for you
                </h3>
                <div className="mb-4 flex flex-wrap gap-2">
                  {WE_RUN_CHIPS.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-border-medium bg-surface px-3.5 py-1.5 text-sm font-medium text-text-secondary"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-text-secondary">
                  Workloads arrive containerized and isolated, run metered, and leave. You provide the hardware and the
                  power bill. Everything else is our job — that's the deal.
                </p>
              </GlassCard>
            </div>
          </div>
        </section>

        {/* Who this fits */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-8 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Who this <span className="text-primary">fits.</span>
            </h2>
            <div className="flex flex-wrap justify-center gap-3">
              {FIT_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-border-medium bg-surface px-4.5 py-2.5 text-sm font-medium text-text-secondary"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="mt-6 text-sm text-text-muted">
              Legacy and modern GPUs, bare-metal or virtualized, fractional or whole. If it runs Docker, it can earn.
            </p>
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
                Your racks, working the night shift.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                One command to connect. One dashboard to watch it earn. Disconnect anytime.
              </p>
              <ContactCta
                source="data-center"
                primaryLabel="Get the data center deck"
                secondaryLabel="Schedule a technical call"
                theme="dark"
              />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
