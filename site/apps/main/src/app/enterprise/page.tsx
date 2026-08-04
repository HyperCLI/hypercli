import type { Metadata } from "next";
import Link from "next/link";
import { Footer, GlassCard, Header } from "@hypercli/shared-ui";
import { ArrowRight, Briefcase, Calculator, Check, Code, Database, FileBadge, Gauge, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { ContactCta } from "@/components/contact-cta";
import { BEYOND_PRO, PILOT_PROGRAM_PRICE } from "@/lib/plans";

export const metadata: Metadata = {
  title: "HyperCLI Enterprise — An AI workforce your company actually owns",
  description:
    "Always-on agents in Slack and Teams, a platform every department builds on, and open-weight infrastructure you can self-host. SSO, SOC 2, flat rate.",
};

const TRUST_CHIPS = [
  { icon: Lock, label: "SSO / SAML" },
  { icon: FileBadge, label: "SOC 2" },
  { icon: Database, label: "Never trained on" },
  { icon: LockOpen, label: "Open weights" },
  { icon: Gauge, label: "Flat rate" },
];

const ALTITUDES = [
  {
    kicker: "USE",
    kickerClass: "text-primary",
    title: "AI teammates, in your chat",
    body: "Every team delegates to always-on agents in Slack and Teams — research, reports, content, ops, monitoring. Real deliverables in the thread, not another app to adopt.",
  },
  {
    kicker: "BUILD",
    kickerClass: "text-chart-3",
    title: "A platform for your own agents",
    body: "Anyone builds an agent in plain English; engineers go deeper with SDKs and compatible APIs; our experts build the hard ones with you. Governed centrally — scoped keys, budgets, audit.",
  },
  {
    kicker: "OWN",
    kickerClass: "text-success",
    title: "Infrastructure on your terms",
    body: "Open-weight frontier models, GPU orchestration, and fine-tuning that's yours to keep — in our cloud, your VPC, or air-gapped. There's no black box in the stack.",
  },
];

const BUYERS = [
  {
    icon: Briefcase,
    who: "The business",
    objection: "Will anyone actually use it?",
    answers: [
      <>Lives in Slack and Teams — <b className="font-semibold text-foreground">zero new tools to adopt</b></>,
      <>Production workflows in 4 weeks via the Pilot, not an 18-month initiative</>,
      <>Every department, same agent platform — marketing to finance to eng</>,
    ],
  },
  {
    icon: ShieldCheck,
    who: "IT & security",
    objection: "What can it touch, and who's watching?",
    answers: [
      <>SSO/SAML, RBAC workspaces, <b className="font-semibold text-foreground">scoped keys per agent</b>, full audit logs</>,
      <>Your data is never training data — ours or anyone's</>,
      <>Open weights = auditable models; self-host up to air-gapped</>,
    ],
  },
  {
    icon: Calculator,
    who: "Finance",
    objection: "What does year two cost?",
    answers: [
      <><b className="font-semibold text-foreground">Flat rate</b> — adoption going well doesn't double the bill</>,
      <>One contract replaces the inference + agents + voice + media vendor stack</>,
      <>Pilot fee fully credited; self-host from $20K/mo, known in advance</>,
    ],
  },
  {
    icon: Code,
    who: "Engineering",
    objection: "Do we have to rebuild everything?",
    answers: [
      <>OpenAI- and Anthropic-compatible APIs — <b className="font-semibold text-foreground">existing code runs unmodified</b></>,
      <>Full SDK/CLI for custom agents and internal tools</>,
      <>Fine-tune on your data, on your GPUs — the tunes are yours</>,
    ],
  },
];

const DOORS = [
  {
    kicker: "Need your own cloud",
    title: "Private Cloud",
    body: "Your own managed, single-tenant deployment — isolated compute, your region, our operations.",
    price: BEYOND_PRO[1].price,
    href: "/pricing",
    go: "Talk to engineering",
    featured: false,
    wide: false,
  },
  {
    kicker: "Need it inside your walls",
    title: "Self-Hosted",
    body: "The entire platform on your infrastructure. No meter, no egress, air-gapped if required.",
    price: BEYOND_PRO[2].price,
    href: "/self-hosted",
    go: "Explore Self-Hosted",
    featured: true,
    wide: false,
  },
  {
    kicker: "Want your first agents built",
    title: "Pilot Program",
    body: "2–3 production agents in four weeks, built by our experts with your team.",
    price: `${PILOT_PROGRAM_PRICE}, fully credited if you continue`,
    href: "/pilot-program",
    go: "Explore the Pilot",
    featured: false,
    wide: true,
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">{children}</p>;
}

export default function EnterprisePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-18 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[6%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-chart-3/15 blur-[110px]" />
            <div className="absolute -bottom-[18%] left-[16%] h-[380px] w-[380px] rounded-full bg-success/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <Eyebrow>HyperCLI Enterprise</Eyebrow>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              An AI workforce your company
              <br />
              <span className="gradient-text-primary">actually owns.</span>
            </h1>
            <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Always-on agents doing real work in Slack and Teams, a platform every department builds on, and
              open-weight infrastructure your security team can hold in their hands — with a bill that doesn't move.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {TRUST_CHIPS.map((chip) => (
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

        {/* What HyperCLI is */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What HyperCLI <span className="text-primary">is.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              One platform, three altitudes. Most companies start at the first and grow into all three.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {ALTITUDES.map((card) => (
                <GlassCard key={card.kicker} interactive className="p-7">
                  <p className={`mb-2.5 text-xs font-bold uppercase tracking-[0.1em] ${card.kickerClass}`}>
                    {card.kicker}
                  </p>
                  <h3 className="mb-2 text-lg font-bold tracking-tight text-foreground">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-text-secondary">{card.body}</p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        {/* Buyer personas */}
        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface px-6 py-16 text-center sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Every seat at the table, <span className="text-primary">answered.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              The four people in the buying meeting, and what each one needs to hear.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2">
              {BUYERS.map((buyer) => (
                <GlassCard key={buyer.who} interactive className="bg-background p-7">
                  <h3 className="mb-1 flex items-center gap-3 text-base font-bold tracking-tight text-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <buyer.icon className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                    </span>
                    {buyer.who}
                  </h3>
                  <p className="mb-4 mt-2 text-sm italic text-text-secondary">&ldquo;{buyer.objection}&rdquo;</p>
                  <ul className="space-y-2.5">
                    {buyer.answers.map((answer, index) => (
                      <li key={index} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        <span>{answer}</span>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              ))}
            </div>
            <p className="mt-8 text-sm text-text-secondary">
              Technical evaluators: the full deployment picture — components, networking, data handling, updates — is
              in the{" "}
              <Link href="#" className="font-semibold text-primary hover:underline">
                architecture brief &rarr;
              </Link>
            </p>
          </div>
        </section>

        {/* Three ways in */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Three ways <span className="text-primary">in.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              Pick the one that sounds like you — many companies end up doing more than one.
            </p>
            <div className="mx-auto grid max-w-4xl gap-4 text-left sm:grid-cols-2">
              {DOORS.map((door) => (
                <Link
                  key={door.title}
                  href={door.href}
                  className={`group block ${door.wide ? "sm:col-span-2" : ""}`}
                >
                  <GlassCard
                    interactive
                    className={`h-full p-7 ${door.featured ? "border-2 border-primary" : ""}`}
                  >
                    <div className={door.wide ? "flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7" : "flex h-full flex-col"}>
                      <div className="flex-1">
                        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-primary">{door.kicker}</p>
                        <h3 className="mb-2 text-xl font-bold tracking-tight text-foreground">{door.title}</h3>
                        <p className="text-sm leading-relaxed text-text-secondary">{door.body}</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{door.price}</p>
                      </div>
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary">
                        {door.go}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                      </span>
                    </div>
                  </GlassCard>
                </Link>
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
                Twenty minutes beats twenty slides.
              </h2>
              <p className="mx-auto mb-9 max-w-xl text-lg text-text-secondary">
                Talk to an engineer, not a deck. We'll tell you what fits — including what doesn't.
              </p>
              <ContactCta
                source="enterprise"
                primaryLabel="Talk to engineering"
                secondaryLabel="Get the architecture brief"
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
