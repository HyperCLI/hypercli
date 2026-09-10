import { useState } from "react";
import { ArrowLeft, BriefcaseBusiness, Check, FileText, GitBranch, Handshake, Loader2, Mail, MessageCircle, Monitor, Palette, PlayCircle, Search, Smile, Users, Video, X } from "lucide-react";
import { createAgent, largestAvailableAgentSize, type AgentSummary } from "../api";
import { PERSONA_COLORS, PERSONA_ICONS, setPersona } from "../personas";
import { Avatar } from "./Avatar";

type Step = 0 | 1 | 2;

const SUGGESTIONS = [
  { name: "Deck Designer", title: "Builds and publishes slide decks from your notes.", color: "#7c5cd6", icon: "star" },
  { name: "Channel Digest", title: "Summarizes your busiest Slack channels daily.", color: "#3d9b63", icon: "mail" },
  { name: "Feedback Collector", title: "Gathers feedback from every tool into one doc.", color: "#d0932f", icon: "zap" },
];

const CONNECTORS = [
  { id: "workspace", label: "Workspace", icon: FileText },
  { id: "slack", label: "Slack", mark: SlackMark },
  { id: "buzz", label: "Buzz", mark: BuzzMark },
  { id: "notion", label: "Notion", mark: NotionMark },
  { id: "microsoft-365", label: "Microsoft 365", icon: Mail },
  { id: "github", label: "GitHub", icon: GitBranch },
  { id: "figma", label: "Figma", icon: Palette },
  { id: "zoom", label: "Zoom", icon: Video },
  { id: "salesforce", label: "Salesforce", icon: Handshake },
  { id: "linkedin", label: "LinkedIn", icon: Users },
  { id: "jira", label: "Jira", icon: BriefcaseBusiness },
  { id: "hubspot", label: "HubSpot", icon: MessageCircle },
  { id: "canva", label: "Canva", mark: CanvaMark },
] as const;

const AGENT_FAMILIES = [
  { id: "openclaw", label: "OpenClaw", description: "Browser, workspace, routines, and screen control." },
  { id: "hermes-agent", label: "Hermes", description: "Focused research and assistant runtime." },
  { id: "acp", label: "ACP", description: "Terminal-first agent runtimes over ACP." },
] as const;

const ACP_RUNTIMES = [
  { id: "opencode", label: "OpenCode" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "goose", label: "Goose" },
  { id: "kimi-code", label: "Kimi Code" },
  { id: "buzz-agent", label: "Buzz Agent" },
] as const;

function errorLines(error: string) {
  return error
    .split(/\n|;\s+(?=(?:body\.|query\.|path\.|\d+\s|[A-Z]))/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function NewAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: AgentSummary) => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(PERSONA_COLORS[4]);
  const [icon, setIcon] = useState<string>("smile");
  const [family, setFamily] = useState<(typeof AGENT_FAMILIES)[number]["id"]>("openclaw");
  const [acpRuntime, setAcpRuntime] = useState<(typeof ACP_RUNTIMES)[number]["id"]>("opencode");
  const [image, setImage] = useState("");
  const [selectedConnectors, setSelectedConnectors] = useState(new Set(["slack", "buzz"]));
  const [buzzPrivateKeyNsec, setBuzzPrivateKeyNsec] = useState("");
  const [buzzRelayUrl, setBuzzRelayUrl] = useState("wss://relay.buzz.hypercli.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    const agentName = name.trim() || "New agent";
    if (busy) return;
    setBusy(true);
    setError(null);
    const runtime = family === "acp" ? acpRuntime : family;
    try {
      const size = await largestAvailableAgentSize();
      const agent = await createAgent(agentName, runtime, size, runtime === "buzz-agent" ? {
        image: image.trim() || undefined,
        buzzPrivateKeyNsec: buzzPrivateKeyNsec.trim() || undefined,
        buzzRelayUrl: buzzRelayUrl.trim() || undefined,
      } : { image: image.trim() || undefined });
      setPersona(agent.id, { color, icon, title: title || undefined });
      onCreated(agent);
    } catch (e) {
      setError(e instanceof Error ? e.message : typeof e === "string" ? e : "Could not create the agent.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <main
        role="dialog"
        aria-modal="true"
        className="modal-card relative flex max-h-[86vh] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">New agent</div>
            <div className="text-[11px] text-text-secondary">Create a teammate</div>
          </div>
          <Progress step={step} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {step === 0 ? (
            <IntroStep onNext={() => setStep(1)} onSkip={() => setStep(1)} />
          ) : step === 1 ? (
            <CreateStep
              name={name}
              title={title}
              color={color}
              icon={icon}
              onName={setName}
              onTitle={setTitle}
              onColor={setColor}
              onIcon={setIcon}
              family={family}
              acpRuntime={acpRuntime}
              onFamily={setFamily}
              onAcpRuntime={setAcpRuntime}
              buzzPrivateKeyNsec={buzzPrivateKeyNsec}
              buzzRelayUrl={buzzRelayUrl}
              image={image}
              onBuzzPrivateKeyNsec={setBuzzPrivateKeyNsec}
              onBuzzRelayUrl={setBuzzRelayUrl}
              onImage={setImage}
            />
          ) : (
            <ConnectorsStep selected={selectedConnectors} onSelected={setSelectedConnectors} />
          )}

          {error && (
            <div className="mt-6 rounded-lg bg-error-bg px-3 py-2 text-[12px] leading-relaxed text-error">
              {errorLines(error).map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
          {step === 0 ? (
            <button type="button" onClick={onClose} className="text-[12px] text-text-secondary hover:text-foreground transition-colors">
              Skip
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((current) => (current === 2 ? 1 : 0))}
              className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-foreground transition-colors"
            >
              <ArrowLeft size={13} />
              Back
            </button>
          )}
          {step < 2 ? (
            <button type="button" onClick={() => setStep((current) => (current + 1) as Step)} className="onboarding-primary">
              Next
            </button>
          ) : (
            <button type="button" onClick={finish} disabled={busy} className="onboarding-primary min-w-24 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Get started"}
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-active-row hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <X size={15} />
        </button>
      </main>
    </div>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-1 rounded-full transition-all ${i === step ? "w-5 bg-accent" : "w-1 bg-border-strong"}`} />
      ))}
    </div>
  );
}

function IntroStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <section>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">HyperCLI agents get their own computer and work like you.</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">An AI teammate you hire, not a workflow you wire.</p>
      <div className="mt-8 space-y-6">
        <IntroRow icon={<Smile size={15} />} title="Hire agents like people" text="Name, job title, one-line description. That's the entire setup." active />
        <IntroRow icon={<Monitor size={15} />} title="Its own cloud computer" text="Same browser sessions, files, and workspace across restarts." />
        <IntroRow icon={<PlayCircle size={15} />} title="Teach by recording" text="Show it once while narrating. It watches and writes its own instructions." />
      </div>
      <div className="hidden">
        <button onClick={onNext}>Next</button>
        <button onClick={onSkip}>Skip</button>
      </div>
    </section>
  );
}

function IntroRow({ icon, title, text, active }: { icon: React.ReactNode; title: string; text: string; active?: boolean }) {
  return (
    <div className="flex gap-4">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? "bg-accent text-white" : "bg-active-row text-text-secondary"}`}>{icon}</div>
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <p className="mt-0.5 max-w-[430px] text-[12px] leading-relaxed text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

function CreateStep({
  name,
  title,
  color,
  icon,
  onName,
  onTitle,
  onColor,
  onIcon,
  family,
  acpRuntime,
  onFamily,
  onAcpRuntime,
  buzzPrivateKeyNsec,
  buzzRelayUrl,
  image,
  onBuzzPrivateKeyNsec,
  onBuzzRelayUrl,
  onImage,
}: {
  name: string;
  title: string;
  color: string;
  icon: string;
  onName: (value: string) => void;
  onTitle: (value: string) => void;
  onColor: (value: string) => void;
  onIcon: (value: string) => void;
  family: (typeof AGENT_FAMILIES)[number]["id"];
  acpRuntime: (typeof ACP_RUNTIMES)[number]["id"];
  onFamily: (value: (typeof AGENT_FAMILIES)[number]["id"]) => void;
  onAcpRuntime: (value: (typeof ACP_RUNTIMES)[number]["id"]) => void;
  buzzPrivateKeyNsec: string;
  buzzRelayUrl: string;
  image: string;
  onBuzzPrivateKeyNsec: (value: string) => void;
  onBuzzRelayUrl: (value: string) => void;
  onImage: (value: string) => void;
}) {
  const [showCustomImage, setShowCustomImage] = useState(false);
  return (
    <section>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Create your first agent</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">You can teach it tasks and edit its job description any time.</p>
      <div className="mt-6 rounded-xl border border-border-strong bg-card px-4 py-3.5">
        <div className="flex items-center gap-4">
          <Avatar name={name || "Agent"} size={44} color={color} icon={icon} />
          <div className="min-w-0 flex-1 space-y-1">
            <input value={name} onChange={(e) => onName(e.target.value)} autoFocus placeholder="Name it — e.g. Ops, Radar, Penny" className="w-full bg-transparent text-[14px] outline-none placeholder:text-text-secondary/70" />
            <input value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Job title — e.g. Sales pipeline" className="w-full bg-transparent text-[12px] outline-none placeholder:text-text-secondary/60" />
          </div>
        </div>
      </div>
      <FieldLabel>Color</FieldLabel>
      <div className="flex gap-2">
        {PERSONA_COLORS.map((c) => <button type="button" key={c} onClick={() => onColor(c)} className="h-6 w-6 rounded-full" style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined }} />)}
      </div>
      <FieldLabel>Icon</FieldLabel>
      <div className="flex gap-2">
        {PERSONA_ICONS.slice(0, 8).map((i) => (
           <button type="button" key={i} onClick={() => onIcon(i)} className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${icon === i ? "border-accent bg-accent-tint" : "border-border bg-card hover:bg-active-row"}`}>
            <Avatar name={name || "Agent"} size={18} color={color} icon={i} />
          </button>
        ))}
      </div>
      <FieldLabel>Agent type</FieldLabel>
      <div className="grid grid-cols-3 gap-2">
        {AGENT_FAMILIES.map((option) => (
          <button
            type="button"
            key={option.id}
            onClick={() => onFamily(option.id)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              family === option.id ? "border-accent bg-accent-tint" : "border-border bg-card hover:bg-active-row"
            }`}
          >
            <div className="text-[13px] font-semibold">{option.label}</div>
            <p className="mt-1 text-[11px] leading-snug text-text-secondary">{option.description}</p>
          </button>
        ))}
      </div>
      {family === "acp" && (
        <>
          <FieldLabel>ACP runtime</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {ACP_RUNTIMES.map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => onAcpRuntime(option.id)}
                className={`rounded-md border px-3 py-1.5 text-[12px] transition-colors ${
                  acpRuntime === option.id
                    ? "border-accent bg-accent-tint text-foreground"
                    : "border-border bg-card text-text-secondary hover:bg-active-row"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {acpRuntime === "buzz-agent" && (
            <div className="mt-3 rounded-lg border border-border bg-card px-3 py-3">
              <div className="text-[12px] font-medium">Buzz identity</div>
              <p className="mt-1 text-[11px] leading-snug text-text-secondary">Used once at launch and stored as an agent secret.</p>
              <input
                value={buzzPrivateKeyNsec}
                onChange={(e) => onBuzzPrivateKeyNsec(e.target.value)}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="nsec1..."
                className="mt-3 w-full rounded-md border border-border bg-input px-2.5 py-2 text-[12px] outline-none placeholder:text-text-secondary/60 focus:border-border-strong"
              />
              <input
                value={buzzRelayUrl}
                onChange={(e) => onBuzzRelayUrl(e.target.value)}
                placeholder="wss://relay.example.com"
                className="mt-2 w-full rounded-md border border-border bg-input px-2.5 py-2 text-[12px] outline-none placeholder:text-text-secondary/60 focus:border-border-strong"
              />
            </div>
          )}
        </>
      )}
      <div className="mt-5 rounded-lg border border-border bg-card">
        <button type="button" onClick={() => setShowCustomImage((value) => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] font-medium">
          Custom container
          <span className="text-[11px] font-normal text-text-secondary">{showCustomImage ? "Hide" : "Optional"}</span>
        </button>
        {showCustomImage && (
          <div className="border-t border-border px-3 py-3">
            <input
              value={image}
              onChange={(e) => onImage(e.target.value)}
              placeholder="ghcr.io/org/agent:latest"
              spellCheck={false}
              className="w-full rounded-md border border-border bg-input px-2.5 py-2 text-[12px] outline-none placeholder:text-text-secondary/60 focus:border-border-strong"
            />
            <p className="mt-2 text-[11px] leading-snug text-text-secondary">Leave empty to use the managed runtime image.</p>
          </div>
        )}
      </div>
      <FieldLabel>Or start from a suggestion</FieldLabel>
      <div className="grid grid-cols-3 gap-2">
        {SUGGESTIONS.map((s) => (
          <button type="button" key={s.name} onClick={() => { onName(s.name); onTitle(s.title); onColor(s.color); onIcon(s.icon); }} className="rounded-lg border border-border bg-card p-3 text-left hover:border-border-strong hover:bg-active-row transition-colors">
            <Avatar name={s.name} size={24} color={s.color} icon={s.icon} className="mb-3" />
            <div className="text-[13px] font-semibold">{s.name}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{s.title}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function ConnectorsStep({ selected, onSelected }: { selected: Set<string>; onSelected: (value: Set<string>) => void }) {
  return (
    <section>
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">What do you use every day?</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">We'll suggest these as connectors for your first agent. Pick any.</p>
      <label className="mt-7 flex items-center gap-2 rounded-lg border border-border-strong bg-card px-3 py-2.5 text-text-secondary">
        <Search size={14} />
        <input placeholder="Search tools" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-secondary/70" />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {CONNECTORS.map((connector) => {
          const isSelected = selected.has(connector.id);
          const Icon = "icon" in connector ? connector.icon : null;
          const Mark = "mark" in connector ? connector.mark : null;
          return (
            <button type="button" key={connector.id} onClick={() => { const next = new Set(selected); if (isSelected) next.delete(connector.id); else next.add(connector.id); onSelected(next); }} className={`relative rounded-lg border px-3 py-4 text-center transition-colors ${isSelected ? "border-accent bg-accent-tint" : "border-border bg-card hover:bg-active-row"}`}>
              {isSelected && <Check size={13} className="absolute right-2 top-2 text-accent" />}
              <div className={`mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-md ${isSelected ? "bg-accent text-white" : "bg-active-row text-text-secondary"}`}>{Icon ? <Icon size={14} strokeWidth={1.8} /> : Mark ? <Mark /> : null}</div>
              <div className="text-[12px] font-medium">{connector.label}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <div className="mb-2 mt-5 text-[12px] text-text-secondary">{children}</div>;
}

function SlackMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 3v7" />
      <path d="M16 14v7" />
      <path d="M21 8h-7" />
      <path d="M10 16H3" />
      <path d="M8 14a2 2 0 1 1 0 4" />
      <path d="M16 10a2 2 0 1 1 0-4" />
      <path d="M10 8a2 2 0 1 1-4 0" />
      <path d="M14 16a2 2 0 1 1 4 0" />
    </svg>
  );
}

function BuzzMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 15c3-7 11-7 14 0" />
      <path d="M8 12 6 7" />
      <path d="m16 12 2-5" />
      <path d="M9 16h6" />
      <path d="M10 19h4" />
      <path d="M10 9h4" />
    </svg>
  );
}

function NotionMark() {
  return <span className="font-serif text-[15px] leading-none">N</span>;
}

function CanvaMark() {
  return <span className="font-serif text-[15px] italic leading-none">C</span>;
}
