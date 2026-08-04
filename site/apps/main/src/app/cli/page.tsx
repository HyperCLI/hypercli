import type { Metadata } from "next";
import Link from "next/link";
import { GlassCard, Header, TerminalWindow, type TerminalLine } from "@hypercli/shared-ui";
import { BookOpen, Bot, Code, Cpu, Database, Image, Key, Mic, Package, SquareTerminal, User } from "lucide-react";

export const metadata: Metadata = {
  title: "HyperCLI — The CLI. It's in the name.",
  description:
    "One binary drives the whole platform — agents, GPUs, media, voice, memory, billing. If HyperCLI can do it, hyper can do it from your terminal.",
};

const TERMINAL_LINES: TerminalLine[] = [
  { tone: "comment", text: "# one binary, whole platform" },
  { tone: "cmd", text: "hyper agents create my-agent" },
  { tone: "success", text: "✓ live on its own machine · buzz.xyz/@my-agent" },
  { tone: "cmd", text: 'hyper flow text-to-image "launch hero, dawn palette"' },
  { tone: "success", text: "✓ render complete · hero-v1.png" },
  { tone: "cmd", text: "hyper voice clone --ref founder.wav" },
  { tone: "success", text: '✓ voice "founder" ready' },
  { tone: "cmd", text: "hyper instances launch train:latest -g h100 -n 2 --dry-run" },
  { tone: "success", text: "→ est. $4.12/hr · capacity available" },
  { tone: "cmd", text: "hyper billing" },
  { tone: "success", text: "✓ flat rate · nothing surprising here" },
];

const COMMAND_GROUPS = [
  {
    icon: Bot,
    title: "Agents",
    commands: ["hyper agents create my-agent --type openclaw-pro", "hyper agents shell my-agent"],
    href: "https://docs.hypercli.com/cli/commands/agents",
    linkLabel: "hyper agents reference →",
  },
  {
    icon: Image,
    title: "Media flows",
    commands: ['hyper flow text-to-image "a product hero image"', 'hyper flow text-to-video "30s launch teaser"'],
    href: "https://docs.hypercli.com/cli/commands/flow",
    linkLabel: "hyper flow reference →",
  },
  {
    icon: Mic,
    title: "Voice",
    commands: ["hyper voice clone --ref sample.wav", "hyper voice transcribe standup.mp3"],
    href: "https://docs.hypercli.com/cli/commands/agent",
    linkLabel: "voice commands →",
  },
  {
    icon: Cpu,
    title: "GPU jobs",
    commands: ["hyper instances launch train:latest -g h100 -n 2", "hyper jobs logs --follow"],
    href: "https://docs.hypercli.com/cli/commands/instances",
    linkLabel: "instances + jobs →",
  },
  {
    icon: Database,
    title: "Memory",
    commands: ["hyper memory import ./project-docs/"],
    href: "https://docs.hypercli.com/cli/index",
    linkLabel: "memory commands →",
  },
  {
    icon: Key,
    title: "Keys and billing",
    commands: ["hyper keys create --tag staging --ttl 30d", "hyper billing"],
    href: "https://docs.hypercli.com/cli/commands/keys",
    linkLabel: "keys + billing →",
  },
];

const PANES = [
  {
    icon: User,
    who: "You, from your laptop",
    lines: ["hyper agents create research-bot", "hyper memory import ./briefs/", "hyper agents logs research-bot --follow"],
  },
  {
    icon: Bot,
    who: "Your agent, from its machine",
    lines: ['hyper flow text-to-image "thumbnail v3"', "hyper voice transcribe meeting.mp3", "hyper agents create scraper-01 --ttl 48h"],
  },
];

const PHILOSOPHY = [
  {
    icon: SquareTerminal,
    title: "Scriptable by default.",
    body: "Everything returns clean output for pipes and scripts — your deploy process is a bash file, your cron jobs are one-liners.",
  },
  {
    icon: Package,
    title: "One install, no ceremony.",
    body: "pip or npm, one auth command, and every capability is live. No plugin maze, no per-service credentials.",
  },
  {
    icon: Code,
    title: "SDKs when you outgrow the shell.",
    body: "Python and TypeScript SDKs mirror the CLI one-to-one — prototype in the terminal, productionize without relearning anything.",
  },
  {
    icon: BookOpen,
    title: "Documented like we mean it.",
    body: "Per-command reference, guides, and OpenAPI specs at docs.hypercli.com — the source of truth this page happily defers to.",
  },
];

const CLI_FOOTER_LINKS = [
  { label: "Capabilities", href: "/capabilities" },
  { label: "Inference", href: "/inference" },
  { label: "Channels", href: "/slack" },
  { label: "Pricing", href: "/pricing" },
];

function CliFooter() {
  return (
    <footer className="border-t border-border px-6 pb-12 pt-8 text-center text-sm text-text-muted">
      <p>
        HyperCLI, Inc.
        {CLI_FOOTER_LINKS.map((link) => (
          <span key={link.href}>
            {" · "}
            <Link href={link.href} className="hover:text-foreground transition-colors">
              {link.label}
            </Link>
          </span>
        ))}
      </p>
    </footer>
  );
}

export default function CliPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative px-6 pb-20 pt-26 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-[8%] left-[8%] h-[440px] w-[440px] rounded-full bg-primary/15 blur-[110px]" />
            <div className="absolute -top-[2%] right-[9%] h-[360px] w-[360px] rounded-full bg-success/15 blur-[110px]" />
            <div className="absolute -bottom-[16%] left-[16%] h-[380px] w-[380px] rounded-full bg-chart-3/15 blur-[110px]" />
          </div>
          <div className="relative mx-auto max-w-5xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary">The CLI</p>
            <h1 className="mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              It's <span className="gradient-text-primary">in the name.</span>
            </h1>
            <p className="mx-auto mb-11 max-w-2xl text-lg leading-relaxed text-text-secondary">
              One binary drives the whole platform — agents, GPUs, media, voice, memory, billing. If HyperCLI can do
              it, <code className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-base text-primary">hyper</code>{" "}
              can do it from your terminal.
            </p>

            <div className="relative mx-auto mb-11 max-w-2xl">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-[6%_-7%_-12%_-7%] bg-[radial-gradient(50%_65%_at_32%_60%,rgb(var(--button-primary-rgb)_/_0.20),transparent_70%),radial-gradient(50%_65%_at_72%_55%,rgb(108_232_196_/_0.16),transparent_70%)] blur-[34px]"
              />
              <TerminalWindow title="hyper — zsh" lines={TERMINAL_LINES} typed className="relative min-h-[330px] text-left" />
            </div>

            <div className="flex flex-wrap justify-center gap-3.5">
              <a
                href="https://docs.hypercli.com/cli/quickstart"
                className="btn-primary inline-block rounded-full px-8 py-3.5 font-mono text-sm font-semibold"
              >
                pip install hypercli-cli
              </a>
              <a
                href="https://docs.hypercli.com/cli/index"
                className="btn-secondary inline-block rounded-full px-8 py-3.5 text-base font-semibold"
              >
                Read the CLI docs
              </a>
            </div>
          </div>
        </section>

        {/* Everything is a command */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Everything is a <span className="text-primary">command.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              The whole surface, one verb away. Every block links to its reference.
            </p>
            <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
              {COMMAND_GROUPS.map((group) => (
                <GlassCard key={group.title} interactive className="p-7">
                  <h3 className="mb-5 flex items-center gap-3 text-lg font-semibold tracking-tight text-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <group.icon className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                    </span>
                    {group.title}
                  </h3>
                  {group.commands.map((command) => (
                    <code
                      key={command}
                      className="mb-2.5 block overflow-x-auto whitespace-nowrap rounded-lg bg-surface-low px-4 py-2.5 font-mono text-xs text-text-secondary"
                    >
                      <span className="mr-2 select-none text-primary">$</span>
                      {command}
                    </code>
                  ))}
                  <a href={group.href} className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
                    {group.linkLabel}
                  </a>
                </GlassCard>
              ))}
            </div>
            <p className="mt-9 text-sm text-text-muted">
              Plus a full TUI:{" "}
              <code className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[13px] text-primary">hyper tui</code>{" "}
              — live jobs, logs, and metrics without leaving the terminal.
            </p>
          </div>
        </section>

        {/* Your agent speaks it too */}
        <section className="border-t border-border px-6 py-24 text-center">
          <div className="mx-auto max-w-6xl rounded-3xl bg-surface-low px-6 py-16 sm:px-12">
            <h2 className="mb-4 text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Your agent <span className="text-primary">speaks it too.</span>
            </h2>
            <p className="mx-auto mb-12 max-w-xl text-lg text-text-secondary">
              The CLI isn't just your interface — it's the shared language. The same commands you run are how your
              agent manages itself.
            </p>
            <div className="grid gap-5 text-left md:grid-cols-2">
              {PANES.map((pane) => (
                <div key={pane.who} className="rounded-2xl bg-terminal-background p-7">
                  <p className="mb-5 flex items-center gap-3 text-sm font-semibold text-terminal-foreground">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-hover/15">
                      <pane.icon className="h-4 w-4 text-accent-hover" aria-hidden="true" />
                    </span>
                    {pane.who}
                  </p>
                  <div className="font-mono text-xs leading-loose text-terminal-muted">
                    {pane.lines.map((line) => (
                      <div key={line} className="whitespace-pre-wrap">
                        <span className="mr-2 select-none text-accent-hover">$</span>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-9 max-w-xl leading-relaxed text-text-secondary">
              Anything you can script, it can script. Anything it does, you can read in plain command history —{" "}
              <b className="font-semibold text-foreground">auditable by design, automatable by default.</b>
            </p>
          </div>
        </section>

        {/* Philosophy */}
        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
            {PHILOSOPHY.map((item) => (
              <GlassCard key={item.title} interactive className="p-7">
                <h3 className="mb-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                  <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">{item.body}</p>
              </GlassCard>
            ))}
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
                Named after the thing
                <br />
                <span className="gradient-text-primary">we care about most.</span>
              </h2>
              <p className="mb-9 text-lg text-text-secondary">
                Install it, sign in, and the whole platform is a tab-complete away.
              </p>
              <div className="flex flex-wrap justify-center gap-3.5">
                <a
                  href="https://docs.hypercli.com/cli/quickstart"
                  className="btn-primary inline-block rounded-full px-8 py-4 font-mono text-sm font-semibold"
                >
                  pip install hypercli-cli
                </a>
                <a
                  href="https://docs.hypercli.com/cli/quickstart"
                  className="inline-block rounded-full border border-terminal-border px-8 py-4 text-base font-semibold text-terminal-foreground transition-colors hover:border-accent-hover hover:text-accent-hover"
                >
                  CLI quickstart
                </a>
              </div>
              <p className="mt-8 text-xs text-terminal-muted">
                Commands shown are illustrative. The reference at docs.hypercli.com is the source of truth — this page
                happily defers to it.
              </p>
            </div>
          </div>
        </section>
      </main>
      <CliFooter />
    </div>
  );
}
