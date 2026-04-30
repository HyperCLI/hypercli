"use client";

import { useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clock3,
  CreditCard,
  Crown,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pencil,
  Plug,
  Rocket,
  ShieldCheck,
  UserRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { BRAND_ICONS } from "@/components/dashboard/BrandIcons";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createOpenClawAgent } from "@/lib/agent-client";

type StageId = "plan" | "agent" | "connect" | "files" | "ready";
type PlanId = "starter" | "team" | "scale";
type AgentTemplateId = "ops" | "support" | "builder";
type ServiceId = "slack" | "telegram" | "teams";
type ConnectionStatus = "idle" | "testing" | "connected";
type FileStatus = "missing" | "draft" | "ready";
type RequestId = "boundaries" | "escalation" | "sources" | "schedule";

interface DevPlan {
  id: PlanId;
  name: string;
  eyebrow: string;
  price: string;
  accent: string;
  icon: LucideIcon;
  recommended?: boolean;
  slots: Record<string, number>;
  features: string[];
  promise: string;
}

interface AgentTemplate {
  id: AgentTemplateId;
  name: string;
  role: string;
  tier: string;
  accent: string;
  icon: LucideIcon;
  summary: string;
  traits: string[];
  profile: string;
}

interface ActiveAgentProfile {
  id: string;
  name: string;
  role: string;
  tier: string;
  accent: string;
  icon: LucideIcon;
  summary: string;
  traits: string[];
  profile: string;
}

interface ServiceDefinition {
  id: ServiceId;
  name: string;
  description: string;
  accent: string;
  icon: ComponentType<{ className?: string }>;
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    secret?: boolean;
  }>;
  checklist: string[];
}

interface SetupFile {
  id: string;
  path: string;
  label: string;
  purpose: string;
  owner: string;
  content: string;
}

interface InfoRequest {
  id: RequestId;
  label: string;
  prompt: string;
  chips: string[];
  icon: LucideIcon;
}

const plans: DevPlan[] = [
  {
    id: "starter",
    name: "Starter",
    eyebrow: "Solo setup",
    price: "$19/mo",
    accent: "#38D39F",
    icon: Bot,
    slots: { small: 1 },
    features: ["1 small agent", "Shared setup notes", "Simple channel pairing"],
    promise: "A simple place to meet your first agent and try a focused workflow.",
  },
  {
    id: "team",
    name: "Team",
    eyebrow: "Recommended",
    price: "$49/mo",
    accent: "#7c8cff",
    icon: Crown,
    recommended: true,
    slots: { medium: 1, small: 1 },
    features: ["1 medium agent", "1 small helper agent", "Team context and approvals"],
    promise: "A friendly starting point for a shared workspace agent and a little room to grow.",
  },
  {
    id: "scale",
    name: "Scale",
    eyebrow: "Production team",
    price: "$149/mo",
    accent: "#f0c56c",
    icon: Rocket,
    slots: { large: 1, medium: 2 },
    features: ["1 large agent", "2 medium agents", "Room for scheduled work"],
    promise: "A roomier setup for teams that want to explore bigger workflows together.",
  },
];

const agentTemplates: AgentTemplate[] = [
  {
    id: "ops",
    name: "kiminka",
    role: "Project manager",
    tier: "medium",
    accent: "#38D39F",
    icon: ShieldCheck,
    summary: "Keeps plans moving, follows up on open work, and helps the team stay aligned.",
    traits: ["organized", "steady", "follow-through"],
    profile:
      "Name: kiminka\nRole: Project manager\nTone: warm, organized, steady\nPrimary promise: keep the team aligned, unblock the next step, and follow through on open work.",
  },
  {
    id: "support",
    name: "Gilfoyle",
    role: "Code agent and orchestrator",
    tier: "small",
    accent: "#7c8cff",
    icon: UserRound,
    summary: "Coordinates code tasks, keeps workflows tidy, and helps technical work move from idea to execution.",
    traits: ["technical", "dry", "orchestrated"],
    profile:
      "Name: Gilfoyle\nRole: Code agent and orchestrator\nTone: dry, precise, highly technical\nPrimary promise: coordinate technical work, keep execution organized, and move code tasks forward cleanly.",
  },
  {
    id: "builder",
    name: "Forge",
    role: "Workflow builder",
    tier: "large",
    accent: "#f0c56c",
    icon: Wand2,
    summary: "Turns team knowledge into useful notes, checks, and repeatable routines.",
    traits: ["proactive", "systems-minded", "documentation heavy"],
    profile:
      "Name: Forge\nRole: Workflow builder\nTone: precise, proactive, thoughtful\nPrimary promise: turn team context into repeatable workspace routines.",
  },
];

const services: ServiceDefinition[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Bring the agent into a workspace channel or DM.",
    accent: "#4A154B",
    icon: BRAND_ICONS.slack,
    fields: [
      { key: "workspace", label: "Workspace", placeholder: "acme.slack.com" },
      { key: "botToken", label: "Bot token", placeholder: "xoxb-...", secret: true },
      { key: "appToken", label: "App token", placeholder: "xapp-...", secret: true },
      { key: "defaultChannel", label: "Default channel", placeholder: "#ops-agent" },
    ],
    checklist: ["Bot scopes", "Socket mode", "Channel invite"],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Pair the agent with a direct chat or team group.",
    accent: "#2AABEE",
    icon: BRAND_ICONS.telegram,
    fields: [
      { key: "botName", label: "Bot username", placeholder: "@your_agent_bot" },
      { key: "botToken", label: "Bot token", placeholder: "123456:AA...", secret: true },
      { key: "dmPolicy", label: "DM policy", placeholder: "pairing" },
      { key: "defaultGroup", label: "Default group", placeholder: "Ops Command" },
    ],
    checklist: ["BotFather token", "DM policy", "Group mention rule"],
  },
  {
    id: "teams",
    name: "Teams",
    description: "Connect the agent to Teams channels and chats.",
    accent: "#5059C9",
    icon: BRAND_ICONS.teams,
    fields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "appId", label: "Bot App ID", placeholder: "Azure app registration ID" },
      { key: "clientSecret", label: "Client secret", placeholder: "Paste secret", secret: true },
      { key: "defaultTeam", label: "Default team", placeholder: "Engineering" },
    ],
    checklist: ["Azure Bot", "Teams channel", "Tenant consent"],
  },
];

const setupFiles: SetupFile[] = [
  {
    id: "agent-profile",
    path: "agent/agent-profile.md",
    label: "Agent profile",
    purpose: "Name, role, tone, and the first helpful promise.",
    owner: "User",
    content:
      "# Agent Profile\n\nName: Nova\nRole: Operations copilot\nTone: calm, concise, supportive\nPrimary promise: help the team stay unblocked and informed.",
  },
  {
    id: "communication-rules",
    path: "agent/communication-rules.md",
    label: "Communication rules",
    purpose: "When to reply, when to wait, and how to handle mentions with care.",
    owner: "Agent",
    content:
      "# Communication Rules\n\n- Answer direct mentions immediately.\n- In shared channels, ask one clarifying question before taking action.\n- Summarize completed work with links and next steps.",
  },
  {
    id: "workspace-context",
    path: "workspace/context.json",
    label: "Workspace context",
    purpose: "Team names, links, priorities, and the words your team already uses.",
    owner: "Team",
    content:
      '{\n  "team": "Platform",\n  "priority": "Reduce incident response time",\n  "systems": ["dashboard", "billing", "agents-api"],\n  "vocabulary": ["AIU", "grant", "entitlement"]\n}',
  },
  {
    id: "handoff-policy",
    path: "agent/handoff-policy.md",
    label: "Handoff policy",
    purpose: "Who to ask for help, what needs approval, and which actions deserve extra care.",
    owner: "Admin",
    content:
      "# Handoff Policy\n\nBring a teammate in for payment, production, and account deletion actions.\nAsk for approval before changing billing plans or rotating secrets.",
  },
];

const infoRequests: InfoRequest[] = [
  {
    id: "boundaries",
    label: "Autonomy",
    prompt: "What should the agent feel comfortable doing on its own?",
    chips: ["draft only", "read and summarize", "create tasks", "suggest safe fixes"],
    icon: ShieldCheck,
  },
  {
    id: "escalation",
    label: "Escalation",
    prompt: "Who should the agent ask for help when a decision feels sensitive?",
    chips: ["team lead", "on-call engineer", "billing owner", "security reviewer"],
    icon: UserRound,
  },
  {
    id: "sources",
    label: "Sources",
    prompt: "Which files or spaces should the agent trust first?",
    chips: ["README files", "runbooks", "Linear project", "Slack pins"],
    icon: FileText,
  },
  {
    id: "schedule",
    label: "Cadence",
    prompt: "When would a gentle check-in be useful?",
    chips: ["weekday mornings", "after deploys", "incident closeout", "never proactive"],
    icon: Clock3,
  },
];

const initialServiceConfig: Record<ServiceId, Record<string, string>> = {
  slack: {
    workspace: "",
    botToken: "",
    appToken: "",
    defaultChannel: "",
  },
  telegram: {
    botName: "",
    botToken: "",
    dmPolicy: "pairing",
    defaultGroup: "",
  },
  teams: {
    tenantId: "",
    appId: "",
    clientSecret: "",
    defaultTeam: "",
  },
};

const initialFileStatus = setupFiles.reduce<Record<string, FileStatus>>((acc, file) => {
  acc[file.id] = "missing";
  return acc;
}, {});

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function cardStyle(accent: string, selected: boolean): CSSProperties {
  return {
    borderColor: selected ? hexToRgba(accent, 0.5) : "rgba(255,255,255,0.06)",
    background: selected
      ? `radial-gradient(120% 90% at 0% 0%, ${hexToRgba(accent, 0.14)} 0%, rgba(20,20,22,0.85) 55%, rgba(14,14,16,0.85) 100%)`
      : "linear-gradient(180deg, rgba(22,22,25,0.7) 0%, rgba(16,16,19,0.7) 100%)",
    boxShadow: selected
      ? `0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 32px ${hexToRgba(accent, 0.16)}`
      : "0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 22px rgba(0,0,0,0.22)",
  };
}

function heroPanelStyle(accent: string): CSSProperties {
  return {
    borderColor: hexToRgba(accent, 0.32),
    background: `radial-gradient(140% 100% at 0% 0%, ${hexToRgba(accent, 0.12)} 0%, rgba(20,20,22,0.85) 55%, rgba(13,13,15,0.9) 100%)`,
    boxShadow: `0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 36px ${hexToRgba(accent, 0.12)}`,
  };
}

function getService(id: ServiceId) {
  return services.find((service) => service.id === id) ?? services[0];
}

function getPlan(id: PlanId) {
  return plans.find((plan) => plan.id === id) ?? plans[1];
}

function getAgentTemplate(id: AgentTemplateId) {
  return agentTemplates.find((template) => template.id === id) ?? agentTemplates[0];
}

function formatAgentProfile({
  name,
  role,
  tone,
  promise,
}: {
  name: string;
  role: string;
  tone: string;
  promise: string;
}) {
  return `Name: ${name}\nRole: ${role}\nTone: ${tone}\nPrimary promise: ${promise}`;
}

export default function DevAgentSetupPage() {
  const router = useRouter();
  const { getToken } = useAgentAuth();
  const [stage, setStage] = useState<StageId>("plan");
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>("team");
  const [activePlanId, setActivePlanId] = useState<PlanId | null>(null);
  const [activatingPlanId, setActivatingPlanId] = useState<PlanId | null>(null);
  const [selectedAgentTemplateId, setSelectedAgentTemplateId] = useState<AgentTemplateId>("ops");
  const [activeAgentTemplateId, setActiveAgentTemplateId] = useState<AgentTemplateId | null>(null);
  const [activeAgent, setActiveAgent] = useState<ActiveAgentProfile | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [creatingAgentSource, setCreatingAgentSource] = useState<AgentTemplateId | "custom" | null>(null);
  const [launchingWorkspace, setLaunchingWorkspace] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [createdSetupAgentId, setCreatedSetupAgentId] = useState<string | null>(null);
  const [customAgentName, setCustomAgentName] = useState("Northstar");
  const [customAgentRole, setCustomAgentRole] = useState("Team coordinator");
  const [customAgentTone, setCustomAgentTone] = useState("warm, organized, reassuring");
  const [customAgentPromise, setCustomAgentPromise] = useState("keep the team aligned and make the next step feel clear");
  const [customAgentTier, setCustomAgentTier] = useState("medium");
  const [selectedService, setSelectedService] = useState<ServiceId>("slack");
  const [connectedService, setConnectedService] = useState<ServiceId | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [serviceConfig, setServiceConfig] = useState(initialServiceConfig);
  const [fileStatus, setFileStatus] = useState<Record<string, FileStatus>>(initialFileStatus);
  const [selectedFileId, setSelectedFileId] = useState(setupFiles[0].id);
  const [fileEdits, setFileEdits] = useState(
    setupFiles.reduce<Record<string, string>>((acc, file) => {
      acc[file.id] = file.content;
      return acc;
    }, {}),
  );
  const [answers, setAnswers] = useState<Partial<Record<RequestId, string>>>({});
  const [activeRequestId, setActiveRequestId] = useState<RequestId>("boundaries");

  const service = getService(selectedService);
  const selectedPlan = getPlan(selectedPlanId);
  const activePlan = activePlanId ? getPlan(activePlanId) : null;
  const selectedAgentTemplate = getAgentTemplate(selectedAgentTemplateId);
  const SelectedServiceIcon = service.icon;
  const selectedFile = setupFiles.find((file) => file.id === selectedFileId) ?? setupFiles[0];
  const readyFiles = Object.values(fileStatus).filter((status) => status === "ready").length;
  const draftedFiles = Object.values(fileStatus).filter((status) => status !== "missing").length;
  const answeredCount = Object.keys(answers).length;
  const activeRequest = infoRequests.find((request) => request.id === activeRequestId) ?? infoRequests[0];
  const allContextAnswered = answeredCount === infoRequests.length;

  const allFieldsFilled = service.fields.every(
    (field) => (serviceConfig[selectedService][field.key] ?? "").trim() !== "",
  );

  const nextMissingRequest = useMemo(
    () => infoRequests.find((request) => !answers[request.id]) ?? infoRequests[0],
    [answers],
  );
  const availablePlanTiers = useMemo(() => Object.keys(activePlan?.slots ?? {}), [activePlan]);
  const effectiveCustomAgentTier =
    availablePlanTiers.includes(customAgentTier) ? customAgentTier : (availablePlanTiers[0] ?? customAgentTier);
  const setupReadiness = [
    {
      label: "Chat home",
      detail: connectedService ? `${getService(connectedService).name} is connected` : "Pick the first service",
      done: Boolean(connectedService),
    },
    {
      label: "Starter files",
      detail: `${readyFiles}/${setupFiles.length} ready`,
      done: readyFiles === setupFiles.length,
    },
    {
      label: "Guidance answers",
      detail: allContextAnswered ? "Everything is filled in" : `${answeredCount}/${infoRequests.length} answered`,
      done: allContextAnswered,
    },
  ];
  const starterPrompts = [
    `Hi ${activeAgent?.name ?? "there"}, introduce yourself and tell me how you can help in ${connectedService ? getService(connectedService).name : "this workspace"}.`,
    `Summarize this setup and suggest the best next action for ${activeAgent?.name ?? "the agent"}.`,
    `What extra context would help you be more useful right away?`,
  ];
  const customAgentPreviewProfile = useMemo(
    () =>
      formatAgentProfile({
        name: customAgentName.trim() || "Your agent",
        role: customAgentRole.trim() || "Custom teammate",
        tone: customAgentTone.trim() || "warm, organized, reassuring",
        promise: customAgentPromise.trim() || "help the team move forward with clarity",
      }),
    [customAgentName, customAgentPromise, customAgentRole, customAgentTone],
  );

  const activatePlan = (planId: PlanId) => {
    setActivatingPlanId(planId);
    setCreatedSetupAgentId(null);
    setLaunchError(null);
    window.sessionStorage.removeItem("dev-agent-setup-created-agent-id");
    window.setTimeout(() => {
      window.sessionStorage.setItem("dev-agent-setup-plan", planId);
      setActivePlanId(planId);
      setActivatingPlanId(null);
      setStage("agent");
    }, 650);
  };

  const createAgent = (templateId: AgentTemplateId) => {
    const template = getAgentTemplate(templateId);
    setCreatingAgent(true);
    setCreatingAgentSource(templateId);
    setCreatedSetupAgentId(null);
    setLaunchError(null);
    window.sessionStorage.removeItem("dev-agent-setup-created-agent-id");
    window.setTimeout(() => {
      window.sessionStorage.setItem("dev-agent-setup-agent-name", template.name);
      setActiveAgent({
        ...template,
        id: template.id,
      });
      setActiveAgentTemplateId(templateId);
      setCreatingAgent(false);
      setCreatingAgentSource(null);
      setFileEdits((prev) => ({
        ...prev,
        "agent-profile": `# Agent Profile\n\n${template.profile}`,
      }));
      setStage("connect");
    }, 650);
  };

  const createCustomAgent = () => {
    const name = customAgentName.trim() || "Your agent";
    const role = customAgentRole.trim() || "Custom teammate";
    const tone = customAgentTone.trim() || "warm, organized, reassuring";
    const promise = customAgentPromise.trim() || "help the team move forward with clarity";
    const profile = formatAgentProfile({ name, role, tone, promise });
    setCreatingAgent(true);
    setCreatingAgentSource("custom");
    setCreatedSetupAgentId(null);
    setLaunchError(null);
    window.sessionStorage.removeItem("dev-agent-setup-created-agent-id");
    window.setTimeout(() => {
      window.sessionStorage.setItem("dev-agent-setup-agent-name", name);
      setActiveAgent({
        id: "custom",
        name,
        role,
        tier: effectiveCustomAgentTier,
        accent: "#38D39F",
        icon: Bot,
        summary: promise,
        traits: tone.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 3),
        profile,
      });
      setActiveAgentTemplateId(null);
      setCreatingAgent(false);
      setCreatingAgentSource(null);
      setFileEdits((prev) => ({
        ...prev,
        "agent-profile": `# Agent Profile\n\n${profile}`,
      }));
      setStage("connect");
    }, 650);
  };

  const updateServiceConfig = (key: string, value: string) => {
    setServiceConfig((prev) => ({
      ...prev,
      [selectedService]: {
        ...prev[selectedService],
        [key]: value,
      },
    }));
  };

  const handleConnect = () => {
    setConnectionStatus("testing");
    window.setTimeout(() => {
      setConnectedService(selectedService);
      setConnectionStatus("connected");
      setStage("files");
    }, 550);
  };

  const draftAllFiles = () => {
    setFileStatus(
      setupFiles.reduce<Record<string, FileStatus>>((acc, file) => {
        acc[file.id] = "draft";
        return acc;
      }, {}),
    );
    setSelectedFileId(setupFiles[0].id);
  };

  const markSelectedFileReady = () => {
    setFileStatus((prev) => ({
      ...prev,
      [selectedFile.id]: "ready",
    }));
  };

  const markAllFilesReady = () => {
    setFileStatus(
      setupFiles.reduce<Record<string, FileStatus>>((acc, file) => {
        acc[file.id] = "ready";
        return acc;
      }, {}),
    );
    setStage("ready");
    setActiveRequestId(nextMissingRequest.id);
  };

  const saveAnswer = (requestId: RequestId, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setLaunchError(null);
    setAnswers((prev) => ({ ...prev, [requestId]: trimmed }));
    const remaining = infoRequests.filter((request) => request.id !== requestId && !answers[request.id]);
    const next = remaining[0];
    if (next) {
      setActiveRequestId(next.id);
    }
  };

  const launchWorkspace = async () => {
    if (launchingWorkspace) return;
    setLaunchingWorkspace(true);
    setLaunchError(null);
    try {
      const agentToCreate = activeAgent ?? {
        id: selectedAgentTemplate.id,
        name: selectedAgentTemplate.name,
        role: selectedAgentTemplate.role,
        tier: selectedAgentTemplate.tier,
        accent: selectedAgentTemplate.accent,
        icon: selectedAgentTemplate.icon,
        summary: selectedAgentTemplate.summary,
        traits: selectedAgentTemplate.traits,
        profile: selectedAgentTemplate.profile,
      };
      const token = await getToken();
      const createdAgentId = createdSetupAgentId ?? window.sessionStorage.getItem("dev-agent-setup-created-agent-id");
      const finalAgentId = createdAgentId || (await createOpenClawAgent(token, {
        name: agentToCreate.name,
        start: true,
        size: agentToCreate.tier,
        meta: {
          ui: {
            avatar: {
              image: null,
              icon_index: agentToCreate.id === "support" ? 1 : agentToCreate.id === "builder" ? 11 : 0,
            },
          },
        },
      })).id;

      window.sessionStorage.setItem("dev-agent-setup-agent-name", agentToCreate.name);
      window.sessionStorage.setItem("dev-agent-setup-created-agent-id", finalAgentId);
      window.sessionStorage.setItem("dev-agent-setup-agent-profile", agentToCreate.profile);
      window.sessionStorage.setItem("dev-agent-setup-agent-tier", agentToCreate.tier);
      setCreatedSetupAgentId(finalAgentId);
      router.push("/dev/agent-setup/agents");
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Could not create the agent yet.");
      setLaunchingWorkspace(false);
    }
  };

  return (
    <div className="min-h-full pb-10">
      <>
        {stage === "plan" && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-left">
                <h2 className="text-left text-lg font-semibold text-foreground">Choose a home for your first agent</h2>
                <p className="mt-1 text-left text-sm text-text-secondary">
                  Start with the plan that gives your agent enough room to help. This setup is only a preview, so no billing changes happen here.
                </p>
              </div>
              {activePlan && (
                <SummaryPill icon={CreditCard} label={`${activePlan.name} active`} />
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={selectedPlanId === plan.id}
                  active={activePlanId === plan.id}
                  activating={activatingPlanId === plan.id}
                  onSelect={() => setSelectedPlanId(plan.id)}
                  onActivate={() => activatePlan(plan.id)}
                />
              ))}
            </div>

            <div
              className="relative overflow-hidden rounded-xl border p-6"
              style={heroPanelStyle(selectedPlan.accent)}
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: selectedPlan.accent }}>
                    Plan preview
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">{selectedPlan.name} plan</h3>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{selectedPlan.promise}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(selectedPlan.slots).map(([tier, count]) => (
                      <Chip key={tier}>
                        {count} {tier} {count === 1 ? "slot" : "slots"}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className="w-full max-w-sm rounded-xl border border-white/8 bg-background/60 p-4 backdrop-blur-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Setup preview</p>
                      <p className="text-xs text-text-muted">A safe walkthrough with no billing changes.</p>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{selectedPlan.price}</p>
                  </div>
                  <div className="space-y-2">
                    {selectedPlan.features.map((feature) => (
                      <div key={feature} className="flex items-center gap-2 text-sm text-text-secondary">
                        <Check className="h-3.5 w-3.5 text-primary" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => activePlanId === selectedPlan.id ? setStage(activeAgent ? "connect" : "agent") : activatePlan(selectedPlan.id)}
                    disabled={Boolean(activatingPlanId)}
                    className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                  >
                    {activatingPlanId === selectedPlan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : activePlanId === selectedPlan.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    {activatingPlanId === selectedPlan.id
                      ? "Activating"
                      : activePlanId === selectedPlan.id
                        ? "Continue"
                        : `Use ${selectedPlan.name}`}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === "agent" && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Create your first agent</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  The {activePlan?.name ?? "selected"} plan has space ready. Choose the kind of helper you want to meet first.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SummaryPill icon={CreditCard} label={activePlan ? `${activePlan.name} plan` : "No plan"} />
                {activeAgent && <SummaryPill icon={Bot} label={`${activeAgent.name} created`} />}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-xl border p-6"
              style={heroPanelStyle("#38D39F")}
            >
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_340px]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    Start from scratch
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">Shape the agent yourself</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                    If you already know the kind of teammate you want, you can start with a name, a role, and a tone before looking at the suggested agents below.
                  </p>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Agent name"
                      value={customAgentName}
                      onChange={setCustomAgentName}
                      placeholder="Northstar"
                    />
                    <Field
                      label="Role"
                      value={customAgentRole}
                      onChange={setCustomAgentRole}
                      placeholder="Team coordinator"
                    />
                    <Field
                      label="Tone"
                      value={customAgentTone}
                      onChange={setCustomAgentTone}
                      placeholder="warm, organized, reassuring"
                    />
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">Size</label>
                      <div className="flex flex-wrap gap-2">
                        {availablePlanTiers.map((tier) => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => setCustomAgentTier(tier)}
                            className={`rounded-full border px-3 py-2 text-xs font-medium capitalize transition-colors ${
                              effectiveCustomAgentTier === tier
                                ? "border-primary/40 bg-primary/15 text-primary"
                                : "border-white/8 bg-white/[0.03] text-text-secondary hover:border-white/15 hover:text-foreground"
                            }`}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Field
                      label="What should this agent help with first?"
                      value={customAgentPromise}
                      onChange={setCustomAgentPromise}
                      placeholder="keep the team aligned and make the next step feel clear"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-background/60 p-4 backdrop-blur-sm">
                  <p className="mb-3 text-sm font-semibold text-foreground">Custom agent preview</p>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-background/80 p-3 text-xs leading-6 text-text-secondary">
                    {customAgentPreviewProfile}
                  </pre>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip>{effectiveCustomAgentTier} slot</Chip>
                    <Chip>made for your workflow</Chip>
                  </div>
                  <button
                    type="button"
                    onClick={createCustomAgent}
                    disabled={creatingAgent}
                    className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                  >
                    {creatingAgentSource === "custom" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    {creatingAgentSource === "custom" ? "Creating" : "Create from scratch"}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Or start with a suggestion</p>
              <p className="text-sm text-text-secondary">
                These starter agents give you a quick way in if you want a role and personality already sketched out.
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {agentTemplates.map((template) => (
                <AgentTemplateCard
                  key={template.id}
                  template={template}
                  selected={selectedAgentTemplateId === template.id}
                  active={activeAgentTemplateId === template.id}
                  creating={creatingAgentSource === template.id}
                  onSelect={() => setSelectedAgentTemplateId(template.id)}
                  onCreate={() => createAgent(template.id)}
                />
              ))}
            </div>

            <div
              className="relative overflow-hidden rounded-xl border p-6"
              style={heroPanelStyle(selectedAgentTemplate.accent)}
            >
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: selectedAgentTemplate.accent }}>
                    Agent preview
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">{selectedAgentTemplate.name}</h3>
                  <p className="mt-1 text-sm font-medium text-text-secondary">{selectedAgentTemplate.role}</p>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">{selectedAgentTemplate.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip>uses 1 {selectedAgentTemplate.tier} slot</Chip>
                    {selectedAgentTemplate.traits.map((trait) => (
                      <Chip key={trait}>{trait}</Chip>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-background/60 p-4 backdrop-blur-sm">
                  <p className="mb-3 text-sm font-semibold text-foreground">Meet this agent</p>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-background/80 p-3 text-xs leading-6 text-text-secondary">
                    {selectedAgentTemplate.profile}
                  </pre>
                  <button
                    type="button"
                    onClick={() => activeAgentTemplateId === selectedAgentTemplate.id ? setStage("connect") : createAgent(selectedAgentTemplate.id)}
                    disabled={creatingAgent}
                    className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                  >
                    {creatingAgent ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : activeAgentTemplateId === selectedAgentTemplate.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    {creatingAgent
                      ? "Creating"
                      : activeAgentTemplateId === selectedAgentTemplate.id
                        ? "Continue"
                        : `Create ${selectedAgentTemplate.name}`}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === "connect" && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Choose where the agent should greet you</h2>
              <p className="mt-1 text-sm text-text-secondary">
                {activeAgent?.name ?? "The agent"} is ready. Pick the first service so it has a familiar place to help.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {services.map((item) => (
                <ServiceCard
                  key={item.id}
                  service={item}
                  selected={selectedService === item.id}
                  connected={connectedService === item.id}
                  onSelect={() => {
                    setSelectedService(item.id);
                    setConnectionStatus(connectedService === item.id ? "connected" : "idle");
                  }}
                />
              ))}
            </div>

            <div
              className="relative overflow-hidden rounded-xl border p-6"
              style={heroPanelStyle(service.accent)}
            >
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-white ring-1 ring-white/15"
                    style={{ backgroundColor: service.accent }}
                  >
                    <SelectedServiceIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{service.name} connection</h3>
                    <p className="text-sm text-text-secondary">{service.description}</p>
                  </div>
                </div>
                <StatusPill status={connectionStatus} />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  {service.fields.map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      value={serviceConfig[selectedService][field.key] ?? ""}
                      onChange={(value) => updateServiceConfig(field.key, value)}
                      placeholder={field.placeholder}
                      type={field.secret ? "password" : "text"}
                    />
                  ))}
                </div>

                <div className="rounded-xl border border-white/8 bg-background/60 p-4 backdrop-blur-sm">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">What we will check</p>
                  <div className="space-y-2">
                    {service.checklist.map((item) => (
                      <div key={item} className="flex items-center gap-2 text-sm text-text-secondary">
                        <Check className="h-3.5 w-3.5 text-primary" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-xs text-text-tertiary">
                  <Check className="h-3.5 w-3.5 text-primary" />
                  <span>{activeAgent?.name ?? "The agent"} will start here once the connection is ready.</span>
                </div>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connectionStatus === "testing" || !allFieldsFilled}
                  className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                >
                  {connectionStatus === "testing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                  {connectionStatus === "testing" ? "Checking" : `Connect ${service.name}`}
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === "files" && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Give the agent a helpful starter kit</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  These starter files tell the agent how to communicate, what matters, and when to ask for help.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={draftAllFiles}
                  className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  <Wand2 className="h-4 w-4" />
                  Draft starter files
                </button>
                <button
                  type="button"
                  onClick={markAllFilesReady}
                  disabled={draftedFiles === 0}
                  className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  Open chat
                </button>
              </div>
            </div>

            <div className="grid min-h-[560px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-xl border border-white/8 bg-surface-low/80">
                <div className="border-b border-white/8 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Setup files</p>
                    <span className="text-xs tabular-nums text-text-tertiary">{readyFiles}/{setupFiles.length} ready</span>
                  </div>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {setupFiles.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      status={fileStatus[file.id]}
                      selected={selectedFileId === file.id}
                      onClick={() => setSelectedFileId(file.id)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-surface-low/80">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 p-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedFile.label}</p>
                    <p className="mt-0.5 text-xs text-text-tertiary">{selectedFile.path}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFileStatus((prev) => ({ ...prev, [selectedFile.id]: "draft" }))}
                      className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Draft
                    </button>
                    <button
                      type="button"
                      onClick={markSelectedFileReady}
                      className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Ready
                    </button>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="min-h-0 p-4">
                    <textarea
                      value={fileEdits[selectedFile.id] ?? ""}
                      onChange={(event) => setFileEdits((prev) => ({ ...prev, [selectedFile.id]: event.target.value }))}
                      className="h-full min-h-[360px] w-full resize-none rounded-lg border border-white/8 bg-background/60 p-4 font-mono text-xs leading-6 text-foreground placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
                    />
                  </div>
                  <div className="border-t border-white/8 p-4 lg:border-l lg:border-t-0">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Why this helps</p>
                    <p className="text-sm leading-6 text-text-secondary">{selectedFile.purpose}</p>
                    <div className="mt-5 rounded-lg border border-white/8 bg-background/60 p-3">
                      <p className="text-xs text-text-muted">Owner</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{selectedFile.owner}</p>
                    </div>
                    <div className="mt-3 rounded-lg border border-white/8 bg-background/60 p-3">
                      <p className="text-xs text-text-muted">Status</p>
                      <p className="mt-1 text-sm font-medium capitalize text-foreground">{fileStatus[selectedFile.id]}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {stage === "ready" && (
          <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-left">
                <h2 className="text-left text-lg font-semibold text-foreground">
                  {allContextAnswered ? `${activeAgent?.name ?? "Your agent"} is ready` : "A few last decisions"}
                </h2>
                <p className="mt-1 text-left text-sm text-text-secondary">
                  {allContextAnswered
                    ? "Everything is in place. Open the workspace to start the real conversation."
                    : "Tell the agent how it should operate. You can change any answer later from the workspace."}
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-2 sm:justify-end">
                <SummaryPill icon={CreditCard} label={activePlan ? `${activePlan.name} plan` : "No plan"} />
                <SummaryPill icon={Bot} label={activeAgent ? activeAgent.name : "No agent"} />
                <SummaryPill icon={Plug} label={connectedService ? getService(connectedService).name : "No service"} />
                <SummaryPill icon={FileText} label={`${readyFiles}/${setupFiles.length} files`} />
              </div>
            </div>

            {(!connectedService || readyFiles < setupFiles.length) && (
              <div className="flex items-start gap-3 rounded-xl border border-[#f0c56c]/25 bg-[#f0c56c]/[0.06] p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f0c56c]" />
                <div>
                  <p className="text-sm font-semibold text-foreground">A little setup is left</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    {!connectedService
                      ? "Connect a service first so the agent knows where to help."
                      : "Mark the starter files ready before opening the workspace."}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              {setupReadiness.map((item) => (
                <ReadinessCard key={item.label} label={item.label} detail={item.detail} done={item.done} />
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-h-[460px] flex-col overflow-hidden rounded-xl border border-white/8 bg-surface-low/80">
                <div className="flex flex-wrap items-center gap-3 border-b border-white/8 p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground">{activeAgent?.name ?? "Your agent"}</p>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {activeAgent?.role ?? "Custom agent"} · ready in {connectedService ? getService(connectedService).name : "your service"}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    Ready
                  </span>
                </div>

                <div className="flex flex-1 flex-col">
                  {allContextAnswered ? (
                    <LaunchReady
                      agentName={activeAgent?.name ?? "Your agent"}
                      creating={launchingWorkspace}
                      error={launchError}
                      onLaunch={launchWorkspace}
                    />
                  ) : (
                    <LaunchQuestion
                      request={activeRequest}
                      stepIndex={infoRequests.findIndex((request) => request.id === activeRequest.id)}
                      total={infoRequests.length}
                      onAnswer={(value) => saveAnswer(activeRequest.id, value)}
                    />
                  )}
                </div>

                {!allContextAnswered && (
                  <div className="border-t border-white/8 px-5 py-4">
                    <button
                      type="button"
                      onClick={() => void launchWorkspace()}
                      disabled={launchingWorkspace}
                      className="inline-flex items-center gap-2 text-xs font-medium text-text-tertiary transition-colors hover:text-foreground disabled:opacity-60"
                    >
                      {launchingWorkspace ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {launchingWorkspace ? "Creating agent" : "Create now and open the workspace"}
                    </button>
                    {launchError ? (
                      <p className="mt-2 text-xs text-[#d05f5f]">{launchError}</p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-white/8 bg-surface-low/80">
                <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">Operating context</p>
                  <span className="text-xs tabular-nums text-text-tertiary">{answeredCount}/{infoRequests.length}</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {infoRequests.map((request) => {
                    const Icon = request.icon;
                    const answered = Boolean(answers[request.id]);
                    const active = activeRequestId === request.id;
                    return (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => setActiveRequestId(request.id)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 ${
                          active && !answered ? "bg-primary/[0.06]" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1 transition-colors ${
                            answered
                              ? "bg-primary text-primary-foreground ring-white/15"
                              : active
                                ? "bg-primary/15 text-primary ring-primary/30"
                                : "bg-white/[0.04] text-text-muted ring-white/8"
                          }`}
                        >
                          {answered ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">{request.label}</p>
                          <p className="mt-0.5 truncate text-xs text-text-muted">
                            {answered ? answers[request.id] : request.prompt}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
}) {
  const [visible, setVisible] = useState(false);
  const inputType = type === "password" ? (visible ? "text" : "password") : type;

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-lg border border-white/8 bg-background/60 px-3 pr-10 text-sm text-foreground placeholder:text-text-muted transition-colors focus:border-primary/60 focus:bg-background focus:outline-none"
        />
        {type === "password" && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}


function PlanCard({
  plan,
  selected,
  active,
  activating,
  onSelect,
  onActivate,
}: {
  plan: DevPlan;
  selected: boolean;
  active: boolean;
  activating: boolean;
  onSelect: () => void;
  onActivate: () => void;
}) {
  const PlanIcon = plan.icon;

  return (
    <div
      onClick={onSelect}
      style={cardStyle(plan.accent, selected)}
      className="group relative min-h-72 cursor-pointer overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 ease-out hover:-translate-y-0.5"
    >
      <div className="relative flex h-full flex-col">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            style={{ backgroundColor: plan.accent }}
          >
            <PlanIcon className="h-5 w-5" />
          </div>
          {active ? (
            <Badge tone="primary" icon={Check}>Active</Badge>
          ) : plan.recommended ? (
            <Badge>Recommended</Badge>
          ) : null}
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: plan.accent }}>{plan.eyebrow}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
          <span className="text-sm font-semibold text-foreground">{plan.price}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{plan.promise}</p>

        <div className="my-4 flex flex-wrap gap-1.5">
          {Object.entries(plan.slots).map(([tier, count]) => (
            <Chip key={tier}>{count} {tier}</Chip>
          ))}
        </div>

        <div className="my-4 space-y-2">
          {plan.features.map((feature) => (
            <div key={feature} className="flex items-start gap-2 text-xs leading-5 text-text-secondary">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
              <span>{feature}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onActivate();
          }}
          disabled={active || activating}
          className="btn-secondary mt-auto inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Check className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
          {activating ? "Activating" : active ? "Selected" : "Choose"}
        </button>
      </div>
    </div>
  );
}

function AgentTemplateCard({
  template,
  selected,
  active,
  creating,
  onSelect,
  onCreate,
}: {
  template: AgentTemplate;
  selected: boolean;
  active: boolean;
  creating: boolean;
  onSelect: () => void;
  onCreate: () => void;
}) {
  const TemplateIcon = template.icon;

  return (
    <div
      onClick={onSelect}
      style={cardStyle(template.accent, selected)}
      className="group relative min-h-64 cursor-pointer overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 ease-out hover:-translate-y-0.5"
    >
      <div className="relative flex h-full flex-col">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            style={{ backgroundColor: template.accent }}
          >
            <TemplateIcon className="h-5 w-5" />
          </div>
          {active ? (
            <Badge tone="primary" icon={Check}>Created</Badge>
          ) : (
            <Badge>{template.tier}</Badge>
          )}
        </div>

        <h3 className="text-lg font-semibold text-foreground">{template.name}</h3>
        <p className="mt-1 text-sm font-medium text-text-secondary">{template.role}</p>
        <p className="mt-3 text-sm leading-6 text-text-secondary">{template.summary}</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {template.traits.map((trait) => (
            <Chip key={trait}>{trait}</Chip>
          ))}
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCreate();
          }}
          disabled={active || creating}
          className="btn-secondary mt-auto inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? <Check className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          {creating ? "Creating" : active ? "Created" : "Create"}
        </button>
      </div>
    </div>
  );
}

function ServiceCard({
  service,
  selected,
  connected,
  onSelect,
}: {
  service: ServiceDefinition;
  selected: boolean;
  connected: boolean;
  onSelect: () => void;
}) {
  const ServiceIcon = service.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={cardStyle(service.accent, selected)}
      className="group relative min-h-44 overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 ease-out hover:-translate-y-0.5"
    >
      <div className="relative mb-4 flex items-center justify-between">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-white ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:scale-[1.04]"
          style={{ backgroundColor: service.accent }}
        >
          <ServiceIcon className="h-5 w-5" />
        </div>
        {connected ? (
          <Badge tone="primary" icon={Check}>Connected</Badge>
        ) : selected ? (
          <Badge>Selected</Badge>
        ) : null}
      </div>
      <div className="relative">
        <h3 className="font-semibold text-foreground">{service.name}</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{service.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {service.checklist.map((item) => (
            <Chip key={item}>{item}</Chip>
          ))}
        </div>
      </div>
    </button>
  );
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const label = status === "connected" ? "Connected" : status === "testing" ? "Checking" : "Waiting";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
        status === "connected"
          ? "border-primary/25 bg-primary/10 text-primary"
          : status === "testing"
            ? "border-[#f0c56c]/25 bg-[#f0c56c]/10 text-[#f0c56c]"
            : "border-white/8 bg-white/[0.03] text-text-muted"
      }`}
    >
      {status === "testing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-current" />}
      {label}
    </span>
  );
}

function FileRow({
  file,
  status,
  selected,
  onClick,
}: {
  file: SetupFile;
  status: FileStatus;
  selected: boolean;
  onClick: () => void;
}) {
  const accent = status === "ready" ? "#38D39F" : status === "draft" ? "#f0c56c" : "#7c7b82";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderLeftColor: selected ? accent : "transparent",
        background: selected ? `linear-gradient(90deg, ${hexToRgba(accent, 0.1)} 0%, transparent 60%)` : undefined,
      }}
      className={`group flex w-full items-start gap-3 border-l-2 px-4 py-4 text-left transition-colors duration-200 ${
        selected ? "" : "hover:bg-white/[0.02]"
      }`}
    >
      <div
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-foreground ring-1 ring-white/10 transition-transform duration-300 ease-out group-hover:scale-[1.04]"
        style={{ backgroundColor: hexToRgba(accent, status === "missing" ? 0.16 : 0.8) }}
      >
        {status === "ready" ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </div>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{file.label}</span>
        <span className="mt-1 block truncate text-xs text-text-muted">{file.path}</span>
        <span
          className="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize"
          style={{
            borderColor: hexToRgba(accent, 0.3),
            color: status === "missing" ? "var(--text-tertiary)" : accent,
            backgroundColor: hexToRgba(accent, 0.08),
          }}
        >
          {status}
        </span>
      </span>
    </button>
  );
}

function ReadinessCard({
  label,
  detail,
  done,
}: {
  label: string;
  detail: string;
  done: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-surface-low/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="mt-1 text-sm text-text-secondary">{detail}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            done ? "border-primary/25 bg-primary/10 text-primary" : "border-white/8 bg-white/[0.03] text-text-muted"
          }`}
        >
          {done ? "Ready" : "Pending"}
        </span>
      </div>
    </div>
  );
}

function LaunchQuestion({
  request,
  stepIndex,
  total,
  onAnswer,
}: {
  request: InfoRequest;
  stepIndex: number;
  total: number;
  onAnswer: (value: string) => void;
}) {
  const [customValue, setCustomValue] = useState("");
  const Icon = request.icon;

  const submitCustom = () => {
    if (!customValue.trim()) return;
    onAnswer(customValue);
    setCustomValue("");
  };

  return (
    <div className="flex flex-1 flex-col gap-5 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
          Question {stepIndex + 1} of {total}
        </span>
        <div className="flex gap-1">
          {Array.from({ length: total }).map((_, index) => (
            <span
              key={index}
              className={`h-1 w-6 rounded-full transition-colors ${
                index <= stepIndex ? "bg-primary" : "bg-white/8"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-foreground">{request.label}</p>
          <p className="mt-1 text-sm leading-6 text-text-secondary">{request.prompt}</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-tertiary">Pick one</p>
        <div className="flex flex-wrap gap-2">
          {request.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onAnswer(chip)}
              className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-tertiary">Or write your own</p>
        <div className="flex gap-2">
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCustom();
              }
            }}
            className="h-11 min-w-0 flex-1 rounded-lg border border-white/8 bg-background/60 px-3 text-sm text-foreground placeholder:text-text-muted transition-colors focus:border-primary/60 focus:bg-background focus:outline-none"
            placeholder="Type a custom answer"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customValue.trim()}
            className="btn-primary inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            Save
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LaunchReady({
  agentName,
  creating,
  error,
  onLaunch,
}: {
  agentName: string;
  creating: boolean;
  error: string | null;
  onLaunch: () => Promise<void>;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground ring-1 ring-white/15 shadow-[0_18px_44px_rgba(56,211,159,0.25)]">
        <Check className="h-8 w-8" />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-foreground">{agentName} is ready to work</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
        Plan, agent, service, files, and operating context are all set. We will create the agent now and open the workspace.
      </p>
      {error ? (
        <p className="mt-4 max-w-md rounded-lg border border-[#d05f5f]/25 bg-[#d05f5f]/10 px-3 py-2 text-sm text-[#d05f5f]">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void onLaunch()}
        disabled={creating}
        className="btn-primary mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {creating ? "Creating agent" : "Create agent and open workspace"}
        {!creating ? <ArrowRight className="h-4 w-4" /> : null}
      </button>
    </div>
  );
}

function SummaryPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-text-secondary">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {label}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-text-secondary">
      {children}
    </span>
  );
}

function Badge({
  children,
  tone = "neutral",
  icon: Icon,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary";
  icon?: LucideIcon;
}) {
  const tones: Record<"neutral" | "primary", string> = {
    neutral: "border-white/12 bg-white/[0.05] text-foreground",
    primary: "border-primary/30 bg-primary/15 text-primary",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}
