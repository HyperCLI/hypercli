import type { Metadata } from "next";
import Link from "next/link";
import { FAQBlock, Footer, GlassCard, Header } from "@hypercli/shared-ui";
import {
  Boxes,
  BrickWall,
  Check,
  CircleCheck,
  CircleX,
  FileBadge,
  Hand,
  KeyRound,
  Lock,
  LockOpen,
  ShieldCheck,
  X,
} from "lucide-react";

export const metadata: Metadata = {
  title: "HyperCLI Security — Architecture, not a policy document",
  description:
    "Credentials the model never sees, isolated machines per agent, scoped keys, open-weight models you can audit, self-hosting up to air-gapped.",
};

// IMPORTANT: Claim statuses (SOC 2 Type II, Slack listing, credential gateway, approval gates,
// TLS/AES specifics, security@) are DRAFTED, not verified. Confirm with legal/compliance before publishing.

const CERT_CHIPS = [
  { icon: FileBadge, label: "SOC 2" },
  { icon: ShieldCheck, label: "GDPR · DPA ready" },
  { icon: Lock, label: "SSO / SAML" },
  { icon: LockOpen, label: "Open weights" },
];

const COMPLIANCE_ROWS = [
  {
    standard: "SOC 2 Type II",
    status: "In progress",
    statusClass: "bg-warning/15 text-warning",
    coverage: "Audit underway. Controls overview available now; report shared under NDA after attestation.",
  },
  {
    standard: "GDPR",
    status: "Aligned",
    statusClass: "bg-success/15 text-success",
    coverage: "DPA ready to sign during procurement. Sub-processor list public.",
  },
  {
    standard: "CCPA",
    status: "Aligned",
    statusClass: "bg-success/15 text-success",
    coverage: "California privacy requirements addressed.",
  },
  {
    standard: "Slack App Directory",
    status: "Private",
    statusClass: "bg-primary/10 text-primary",
    coverage:
      "Distributed as a private Slack app — installed directly to your workspace, not via the public directory.",
  },
  {
    standard: "ISO 27001",
    status: "In progress",
    statusClass: "bg-warning/15 text-warning",
    coverage: "Controls overview available now; audit evidence shared after certification.",
  },
];

const DOES = [
  {
    lead: "Encrypts everything",
    body: "TLS in transit, AES-256 at rest, secrets in dedicated vaults.",
  },
  {
    lead: "Authenticates with your SSO",
    body: "SAML 2.0 — Okta, Entra ID, Google Workspace, any compliant IdP.",
  },
  {
    lead: "Operates under scoped keys",
    body: "Every agent runs on a key with explicit grants, TTLs, and budget caps.",
  },
  {
    lead: "Revokes instantly",
    body: "Kill a task, pause an agent, or disconnect an integration in one click. Full audit log.",
  },
];

const NEVER_DOES = [
  {
    lead: "Train on your data",
    body: "Not our models, not anyone's. Your prompts, files, and memory stay yours.",
  },
  {
    lead: "See your credentials",
    body: "Keys and tokens are injected at execution time by the gateway — never in model context.",
  },
  {
    lead: "Act above its grant",
    body: "Sensitive actions wait for approval in your chat; an agent can't exceed its key's scope even if asked.",
  },
  {
    lead: "Cross tenant lines",
    body: "Each agent runs on its own isolated machine — memory, files, and skills never touch another customer.",
  },
];

const RISKS = [
  {
    icon: KeyRound,
    title: "Invisible credentials",
    body: "The gateway injects secrets at execution time. A prompt-injected agent can't leak keys it never saw.",
  },
  {
    icon: Hand,
    title: "Approval gates",
    body: "Money, code pushes, external emails — gated behind explicit approve/reject in your chat. Injection can't move what approval guards.",
  },
  {
    icon: Boxes,
    title: "Machine-level isolation",
    body: "Each agent's browser, files, and memory live on its own machine — a compromised task can't reach another agent, or another customer.",
  },
  {
    icon: BrickWall,
    title: "Scoped by construction",
    body: "Child keys with tags, TTLs, and budgets mean even agent-spawned agents inherit hard limits, not good intentions.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Does the model see our API keys or passwords?",
    a: "No. Credentials are stored in encrypted vaults and injected at execution time by the gateway — never present in model context, planning, or logs.",
  },
  {
    q: "What about prompt injection?",
    a: "Untrusted content is treated as data, not instructions; high-risk tools sit behind approval gates and scoped keys. An injected agent can't exceed its grant.",
  },
  {
    q: "Which channels can it read?",
    a: "Only channels it's explicitly invited to, DMs sent to it, and files shared with it. Remove it from a channel and access ends immediately.",
  },
  {
    q: "How do we delete everything?",
    a: "Offboarding removes the agent's machine, memory, embeddings, and files. Deletion semantics are documented in the DPA.",
  },
  {
    q: "Found a vulnerability?",
    a: "Tell us: security@hypercli.com. We'd rather hear it from a researcher than read about it on X. Recognition, public credit if you want it, and platform credits while our formal bounty program stands up.",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function SecurityPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        {/* Hero + cert chips */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[10%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>Security</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Security that's architecture,
              <br />
              <span className="gradient-text-primary">not a policy document.</span>
            </h1>
            <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Credentials the model never sees. Agents on isolated machines with scoped keys they can't exceed. Models
              you can audit down to the weights — because they're open. And when that's not enough, take the whole
              stack inside your walls.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {CERT_CHIPS.map((chip) => (
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

        {/* Compliance table */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Independently <span className="text-primary">verified.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Real statuses, including the in-progress ones. Ask for the reports.
            </p>
            <div className="text-left">
              <div className="hidden grid-cols-[170px_110px_1fr] gap-4 pb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted sm:grid">
                <span>Standard</span>
                <span>Status</span>
                <span>Coverage</span>
              </div>
              {COMPLIANCE_ROWS.map((row) => (
                <div
                  key={row.standard}
                  className="grid gap-2 border-t border-border py-4 text-sm sm:grid-cols-[170px_110px_1fr] sm:items-baseline sm:gap-4"
                >
                  <span className="font-semibold text-foreground">{row.standard}</span>
                  <span>
                    <span
                      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${row.statusClass}`}
                    >
                      {row.status}
                    </span>
                  </span>
                  <span className="leading-relaxed text-text-secondary">{row.coverage}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Does / never does */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-12 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What your agent does. <span className="text-primary">What it never does.</span>
            </h2>
            <div className="grid gap-4 text-left md:grid-cols-2">
              <GlassCard className="p-7">
                <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
                  Does
                </h3>
                <ul className="space-y-4">
                  {DOES.map((item) => (
                    <li key={item.lead} className="flex items-start gap-2.5 text-sm leading-relaxed">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      <span className="text-text-secondary">
                        <b className="block font-semibold text-foreground">{item.lead}</b>
                        {item.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </GlassCard>
              <GlassCard className="p-7">
                <h3 className="mb-5 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <CircleX className="h-5 w-5 text-error" aria-hidden="true" />
                  Never does
                </h3>
                <ul className="space-y-4">
                  {NEVER_DOES.map((item) => (
                    <li key={item.lead} className="flex items-start gap-2.5 text-sm leading-relaxed">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden="true" />
                      <span className="text-text-secondary">
                        <b className="block font-semibold text-foreground">{item.lead}</b>
                        {item.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
          </div>
        </section>

        {/* AI-specific risks */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              AI-specific risks, <span className="text-primary">handled in the architecture.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Agents create attack surfaces normal SaaS doesn't have. Four controls keep them small.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
              {RISKS.map((risk) => (
                <GlassCard key={risk.title} interactive className="p-7">
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <risk.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-base font-bold tracking-tight text-foreground">{risk.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{risk.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* Open-weight audit */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-3xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              The audit no closed lab <span className="text-primary">can offer.</span>
            </h2>
            <p className="mx-auto mb-5 max-w-xl text-lg leading-relaxed text-text-secondary">
              Our models are open-weight. Your security team can inspect the exact artifacts that process your data —
              not a model card, the weights. And if your requirements outgrow any shared cloud, the entire platform
              deploys inside your walls, up to fully air-gapped.
            </p>
            <p className="font-semibold text-foreground">
              Trust, then verify, then — if you want — take the keys.{" "}
              <Link href="/self-hosted" className="text-primary hover:underline">
                Explore Self-Hosted &rarr;
              </Link>
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-10 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Security <span className="text-primary">FAQ.</span>
            </h2>
            <FAQBlock items={FAQ_ITEMS} className="text-left" />
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
                Security review coming?
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                Send your questionnaire — or skip a cycle and read the architecture first.
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
