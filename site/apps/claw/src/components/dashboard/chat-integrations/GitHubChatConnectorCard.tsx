"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, ExternalLink, Github, Loader2, RefreshCw, X } from "lucide-react";
import type {
  AgentConnectorRuntimeSetupResult,
  AgentConnectorsProvider,
} from "@hypercli.com/sdk/connectors";
import type {
  GatewayIntegrationAuthStartParams,
  GatewayIntegrationAuthStartResult,
  GatewayIntegrationAuthStatusParams,
  GatewayIntegrationAuthStatusResult,
  GatewayIntegrationDisconnectParams,
  GatewayIntegrationDisconnectResult,
  GatewayIntegrationStatusEntry,
  GatewayIntegrationStatusParams,
  GatewayIntegrationStatusResult,
  OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";
import { ConfirmDialog, RecoveryDetails } from "@hypercli/shared-ui";

import { schemaPathExists } from "@/components/dashboard/directory/directory-utils";
import { TooltipHint } from "@/components/ClawTooltip";
import {
  GITHUB_CLI_DEVICE_URL,
  isManagedGitHubAuthUnsupportedError,
  type GitHubAgentSetupPhase,
  type GitHubAgentSetupStatus,
} from "@/lib/github-cli-workspace";
import type { ConnectorWorkflow } from "@/lib/connector-workflow";
import { ConnectorWorkflowGuide } from "./ConnectorWorkflowGuide";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

const GITHUB_SCOPES = ["repo", "read:org", "gist"];
const DEFAULT_AUTH_POLL_TIMEOUT_MS = 15 * 60 * 1000;

type ConnectorStep = "checking" | "idle" | "starting" | "pending" | "connected" | "failed";
type GitHubCardTone = "neutral" | "primary" | "warning" | "info";

interface GitHubChatConnectorCardProps {
  connected: boolean;
  connectorsProvider?: AgentConnectorsProvider | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  onAuthStart?: (params: GatewayIntegrationAuthStartParams) => Promise<GatewayIntegrationAuthStartResult>;
  onAuthStatus?: (params: GatewayIntegrationAuthStatusParams) => Promise<GatewayIntegrationAuthStatusResult>;
  onIntegrationStatus?: (params?: GatewayIntegrationStatusParams) => Promise<GatewayIntegrationStatusResult>;
  onDisconnect?: (params: GatewayIntegrationDisconnectParams) => Promise<GatewayIntegrationDisconnectResult>;
  agentSetupStatus?: GitHubAgentSetupStatus;
  onStartAgentGitHubSetup?: () => Promise<void> | void;
  onVerifyAgentGitHubSetup?: () => Promise<void> | void;
  cachedWorkflow?: ConnectorWorkflow | null;
  onGenerateConnectorWorkflow?: (connectorId: "github") => Promise<ConnectorWorkflow>;
  onRunShellProposal?: (command: readonly string[]) => Promise<void>;
  onOpenIntegrationDetails?: () => void;
  onOpenFullSetup?: () => void;
  onDismiss?: () => void;
  directSetup?: boolean;
  onRequestProductUse?: () => boolean;
}

function hasGitHubCapability(configSchema: OpenClawConfigSchemaResponse | null): boolean {
  if (!configSchema) return false;
  const hintKeys = [
    "integrations.github",
    "integrations.github.auth",
    "integrations.github.connect",
    "services.github",
    "services.github.auth",
    "services.github.connect",
  ];
  return (
    schemaPathExists(configSchema.schema, "integrations.github") ||
    schemaPathExists(configSchema.schema, "services.github") ||
    hintKeys.some((key) => Boolean(configSchema.uiHints?.[key]))
  );
}

function statusEntry(result: GatewayIntegrationStatusResult | null | undefined): GatewayIntegrationStatusEntry | null {
  if (!result) return null;
  if (result.integrations?.github) return result.integrations.github;
  if (result.integration) return result.integration;
  const entry = result as GatewayIntegrationStatusEntry;
  if (
    entry.configured !== undefined ||
    entry.authenticated !== undefined ||
    entry.usable !== undefined ||
    entry.accountDisplayName !== undefined
  ) {
    return entry;
  }
  return null;
}

function isUsable(entry: GatewayIntegrationStatusEntry | null): boolean {
  if (!entry) return false;
  if (entry.usable === true) return true;
  return entry.configured === true && entry.authenticated === true && entry.usable !== false;
}

function authDone(result: GatewayIntegrationAuthStatusResult): boolean {
  const status = String(result.status ?? "").toLowerCase();
  return Boolean(result.connectionId) || ["authorized", "connected", "complete", "completed", "success"].includes(status);
}

function authFailed(result: GatewayIntegrationAuthStatusResult): boolean {
  const status = String(result.status ?? "").toLowerCase();
  return ["failed", "error", "expired", "denied", "cancelled", "canceled"].includes(status);
}

function authExpiryDeadline(expiresAt: string | number | undefined): number {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
  }
  if (typeof expiresAt === "string" && expiresAt.trim()) {
    const numeric = Number(expiresAt);
    if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + DEFAULT_AUTH_POLL_TIMEOUT_MS;
}

function buttonClass(tone: "primary" | "secondary" | "caution" = "secondary") {
  const base = "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-[background-color,border-color,color,transform,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45 motion-reduce:hover:translate-y-0";
  if (tone === "primary") {
    return `${base} bg-button-primary text-button-primary-foreground shadow-[0_6px_18px_rgb(var(--button-primary-rgb)_/_0.2)] hover:-translate-y-0.5 hover:bg-button-primary-hover hover:shadow-[0_8px_22px_rgb(var(--button-primary-rgb)_/_0.26)]`;
  }
  if (tone === "caution") {
    return `${base} border border-warning/30 bg-warning/10 text-warning hover:-translate-y-0.5 hover:border-warning/45 hover:bg-warning/15`;
  }
  return `${base} border border-border bg-background/70 text-text-secondary hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground`;
}

const CARD_TONE_CLASS: Record<GitHubCardTone, string> = {
  neutral: "border-border",
  primary: "border-success/30",
  warning: "border-warning/30",
  info: "border-[var(--selection-accent-border)]",
};

const HERO_TONE_CLASS: Record<GitHubCardTone, string> = {
  neutral: "text-foreground",
  primary: "text-success",
  warning: "text-warning",
  info: "text-[var(--selection-accent)]",
};

const ICON_TONE_CLASS: Record<GitHubCardTone, string> = {
  neutral: "text-text-muted/45",
  primary: "text-success/45",
  warning: "text-warning/45",
  info: "text-[rgb(var(--selection-accent-rgb)_/_0.45)]",
};

const SETUP_PROGRESS_STEP_LABELS = [
  "Setting everything up",
  "Preparing connection",
  "Enter device code",
  "Verify account",
  "Congratulations",
] as const;
const SETTING_UP_COPY_ROTATION_MS = 6000;
const DEVICE_CODE_FOCUS_VERIFY_THROTTLE_MS = 15_000;
const SETTING_UP_ROTATING_COPY = [
  "Hold on tight.",
  "Preparing your workspace.",
  "Getting GitHub ready.",
] as const;

interface GitHubSignalCardProps {
  tone: GitHubCardTone;
  heroLabel: string;
  heroSubtitle: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  iconLoading?: boolean;
}

function hasRenderableNode(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some(hasRenderableNode);
  if (React.isValidElement(node) && node.type === React.Fragment) {
    return hasRenderableNode((node.props as { children?: React.ReactNode }).children);
  }
  return true;
}

function GitHubSignalCard({ tone, heroLabel, heroSubtitle, children, actions, iconLoading = false }: GitHubSignalCardProps) {
  const reduceMotion = useReducedMotion();
  const iconClass = iconLoading ? "text-selection-accent" : ICON_TONE_CLASS[tone];
  const hasChildren = hasRenderableNode(children);
  const hasActions = hasRenderableNode(actions);
  return (
    <section
      className={`group relative mb-3 overflow-hidden rounded-2xl border bg-surface-low shadow-[var(--glass-card-shadow)] ${CARD_TONE_CLASS[tone]}`}
      aria-live="polite"
    >
      <Github className={`pointer-events-none absolute -right-12 -top-10 h-44 w-44 rotate-12 opacity-25 sm:-right-14 sm:h-52 sm:w-52 ${ICON_TONE_CLASS[tone]}`} strokeWidth={1} aria-hidden="true" />

      <div className="relative z-10 p-4 sm:p-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <IntegrationBrandPulse active={iconLoading} accentColor="rgb(var(--selection-accent-rgb))" className="!h-16 !w-16 sm:!h-20 sm:!w-20">
            <Github className={`h-11 w-11 sm:h-12 sm:w-12 ${iconClass}`} strokeWidth={1.35} aria-hidden="true" />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-10 items-center overflow-hidden">
              <motion.p
                key={heroLabel}
                initial={reduceMotion ? false : { opacity: 0, y: 18, filter: "blur(7px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 330, damping: 32, mass: 0.8 }}
                className={`text-balance text-left text-[clamp(1.35rem,4.5vw,2.2rem)] font-semibold leading-[1.05] tracking-[-0.04em] ${HERO_TONE_CLASS[tone]}`}
              >
                {heroLabel}
              </motion.p>
            </div>
            {heroSubtitle && <p className="mt-1.5 max-w-[62ch] text-xs leading-5 text-text-secondary sm:text-sm">{heroSubtitle}</p>}
          </div>
        </div>
      </div>

      {hasChildren ? (
        <div className="relative z-10 border-t border-border bg-background/35 px-4 py-4 text-xs leading-5 text-text-secondary sm:px-5">
          {children}
        </div>
      ) : null}

      {hasActions ? (
        <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-high/45 px-4 py-3 sm:px-5">
          {actions}
        </div>
      ) : null}
    </section>
  );
}

function agentPhaseIndex(status: GitHubAgentSetupStatus, started: boolean): number {
  switch (status.phase) {
    case "checking":
      return 0;
    case "installing":
    case "authenticating":
      return 1;
    case "device-code":
      return 2;
    case "ready":
      return 4;
    case "failed":
      if (status.accountDisplayName) return 3;
      if (status.userCode) return 2;
      return started ? 1 : 0;
    case "idle":
    default:
      return started ? 0 : -1;
  }
}

function agentHeroLabel(status: GitHubAgentSetupStatus, started: boolean, sending: boolean): string {
  if (sending || (started && status.phase === "idle")) return SETUP_PROGRESS_STEP_LABELS[0];
  if (status.phase === "failed") return "Retry connection";
  const activeIndex = agentPhaseIndex(status, started);
  return activeIndex >= 0 ? SETUP_PROGRESS_STEP_LABELS[activeIndex] ?? "Connect GitHub" : "Connect GitHub";
}

function GitHubCongratulations({ accountDisplayName }: { accountDisplayName?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-success/25 bg-success/10 px-4 py-4 text-foreground">
      <Github className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rotate-12 text-success/10" strokeWidth={1.1} aria-hidden="true" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-success/30 bg-background/65 text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-success">Connected</p>
          <p className="mt-1 truncate text-base font-semibold text-foreground">
            {accountDisplayName ? `Signed in as ${accountDisplayName}` : "GitHub connected"}
          </p>
        </div>
      </div>
    </div>
  );
}

function managedHeroLabel(step: ConnectorStep, userCode: string): string {
  switch (step) {
    case "checking":
      return "Check GitHub";
    case "starting":
      return "Starting sign-in";
    case "pending":
      return userCode ? "Enter device code" : "Waiting for GitHub";
    case "connected":
      return "GitHub connected";
    case "failed":
      return "Retry connection";
    case "idle":
    default:
      return "Connect GitHub";
  }
}

function managedHeroSubtitle(step: ConnectorStep): string {
  switch (step) {
    case "checking":
      return "Checking GitHub.";
    case "starting":
      return "Starting secure GitHub sign-in.";
    case "pending":
      return "Enter the code on GitHub, then return here.";
    case "connected":
      return "GitHub is connected.";
    case "failed":
      return "Review the sign-in step, then start the connection again.";
    case "idle":
    default:
      return "Connect GitHub for this workspace.";
  }
}

export function GitHubChatConnectorCard({
  connected,
  connectorsProvider,
  configSchema,
  onAuthStart,
  onAuthStatus,
  onIntegrationStatus,
  onDisconnect,
  agentSetupStatus,
  onStartAgentGitHubSetup,
  onVerifyAgentGitHubSetup,
  cachedWorkflow,
  onGenerateConnectorWorkflow,
  onRunShellProposal,
  onOpenIntegrationDetails,
  onOpenFullSetup,
  onDismiss,
  directSetup = false,
  onRequestProductUse,
}: GitHubChatConnectorCardProps) {
  const reduceMotion = useReducedMotion();
  const hasCapability = hasGitHubCapability(configSchema);
  const hasManagedMethods = Boolean(connectorsProvider || (onAuthStart && onAuthStatus && onIntegrationStatus));
  const [step, setStep] = React.useState<ConnectorStep>("checking");
  const [authStart, setAuthStart] = React.useState<GatewayIntegrationAuthStartResult | null>(null);
  const [runtimeSetup, setRuntimeSetup] = React.useState<AgentConnectorRuntimeSetupResult | null>(null);
  const [entry, setEntry] = React.useState<GatewayIntegrationStatusEntry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [technicalDetails, setTechnicalDetails] = React.useState<string | null>(null);
  const [agentSetupStarted, setAgentSetupStarted] = React.useState(false);
  const [agentSetupSending, setAgentSetupSending] = React.useState(false);
  const [agentSetupVerifying, setAgentSetupVerifying] = React.useState(false);
  const [settingUpCopyIndex, setSettingUpCopyIndex] = React.useState(0);
  const [copiedCode, setCopiedCode] = React.useState(false);
  const [codeRippleActive, setCodeRippleActive] = React.useState(false);
  const [agentVerificationRequested, setAgentVerificationRequested] = React.useState(false);
  const [authPolling, setAuthPolling] = React.useState(false);
  const [authPollRevision, setAuthPollRevision] = React.useState(0);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = React.useState(false);
  const [generatedWorkflow, setWorkflow] = React.useState<ConnectorWorkflow | null>(null);
  const workflow = (directSetup ? cachedWorkflow : null) ?? generatedWorkflow;
  const [workflowLoading, setWorkflowLoading] = React.useState(false);
  const [workflowUnavailable, setWorkflowUnavailable] = React.useState(false);
  const directSetupStartedRef = React.useRef(false);
  const codeRippleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const verificationResetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusVerifyRef = React.useRef<number | null>(null);
  const authId = runtimeSetup?.setupId ?? (typeof authStart?.authId === "string" ? authStart.authId : "");
  const allowProductUse = React.useCallback(
    () => onRequestProductUse?.() ?? true,
    [onRequestProductUse],
  );
  const managedUserCode = runtimeSetup?.deviceCode ?? (typeof authStart?.userCode === "string" ? authStart.userCode : "");
  const managedVerificationHref = runtimeSetup?.deviceUrl ?? (typeof authStart?.verificationUri === "string"
    ? authStart.verificationUri
    : typeof authStart?.url === "string"
      ? authStart.url
      : GITHUB_CLI_DEVICE_URL);
  const accountDisplayName = entry?.accountDisplayName ?? authStart?.accountDisplayName;
  const githubAgentStatus: GitHubAgentSetupStatus = agentSetupStatus ?? { phase: "idle", recentCommands: [] };
  const agentFlowActive = agentSetupStarted || githubAgentStatus.phase !== "idle";
  const effectiveWorkflowUnavailable = workflowUnavailable && !workflow;
  const workflowActive = workflowLoading || Boolean(workflow) || effectiveWorkflowUnavailable;
  const agentSetupSucceeded = githubAgentStatus.phase === "ready";
  const agentSetupFailed = githubAgentStatus.phase === "failed";
  const agentDeviceCode = githubAgentStatus.userCode;
  const showAgentDeviceCode = githubAgentStatus.phase === "device-code" && Boolean(agentDeviceCode);
  const checkingAgentAuthorization = showAgentDeviceCode && (agentSetupVerifying || agentVerificationRequested);
  const agentSetupHeroLabel = checkingAgentAuthorization
    ? SETUP_PROGRESS_STEP_LABELS[3]
    : agentHeroLabel(githubAgentStatus, agentSetupStarted, agentSetupSending);
  const settingEverythingUpActive = connected && agentFlowActive && agentSetupHeroLabel === SETUP_PROGRESS_STEP_LABELS[0] && !agentSetupSucceeded && !agentSetupFailed && !showAgentDeviceCode;

  React.useEffect(() => {
    if (!settingEverythingUpActive) return;
    const timer = window.setInterval(() => {
      setSettingUpCopyIndex((current) => (current + 1) % SETTING_UP_ROTATING_COPY.length);
    }, SETTING_UP_COPY_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [settingEverythingUpActive]);

  React.useEffect(() => () => {
    if (codeRippleTimerRef.current) clearTimeout(codeRippleTimerRef.current);
    if (verificationResetTimerRef.current) clearTimeout(verificationResetTimerRef.current);
  }, []);

  const verifyAgentGitHubSetup = React.useCallback(async (force = false) => {
    if (!onVerifyAgentGitHubSetup || agentSetupVerifying) return;
    const now = Date.now();
    if (!force && lastFocusVerifyRef.current !== null && now - lastFocusVerifyRef.current < DEVICE_CODE_FOCUS_VERIFY_THROTTLE_MS) return;
    lastFocusVerifyRef.current = now;
    if (verificationResetTimerRef.current) clearTimeout(verificationResetTimerRef.current);
    setAgentVerificationRequested(true);
    verificationResetTimerRef.current = setTimeout(() => {
      setAgentVerificationRequested(false);
      verificationResetTimerRef.current = null;
    }, DEVICE_CODE_FOCUS_VERIFY_THROTTLE_MS);
    setAgentSetupVerifying(true);
    setError(null);
    setTechnicalDetails(null);
    try {
      await onVerifyAgentGitHubSetup();
    } catch (cause) {
      lastFocusVerifyRef.current = null;
      if (verificationResetTimerRef.current) clearTimeout(verificationResetTimerRef.current);
      verificationResetTimerRef.current = null;
      setAgentVerificationRequested(false);
      setError("GitHub could not be checked. Return from GitHub, then try verifying again.");
      setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
    } finally {
      setAgentSetupVerifying(false);
    }
  }, [agentSetupVerifying, onVerifyAgentGitHubSetup]);

  React.useEffect(() => {
    if (!connected || !showAgentDeviceCode || !onVerifyAgentGitHubSetup || agentSetupSucceeded || agentSetupFailed) return;

    const handleFocusVerification = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void verifyAgentGitHubSetup(false);
    };

    window.addEventListener("focus", handleFocusVerification);
    document.addEventListener("visibilitychange", handleFocusVerification);
    return () => {
      window.removeEventListener("focus", handleFocusVerification);
      document.removeEventListener("visibilitychange", handleFocusVerification);
    };
  }, [agentSetupFailed, agentSetupSucceeded, connected, onVerifyAgentGitHubSetup, showAgentDeviceCode, verifyAgentGitHubSetup]);

  const refresh = React.useCallback(async (probe = false) => {
    if (connectorsProvider) {
      const connectors = await connectorsProvider.list({ connectorId: "github", probe });
      const connector = connectors.find((candidate) => candidate.connectorId === "github");
      const nextEntry: GatewayIntegrationStatusEntry | null = connector ? {
        configured: connector.configured,
        authenticated: connector.authenticated,
        usable: connector.usable,
      } : null;
      setEntry(nextEntry);
      setStep(isUsable(nextEntry) ? "connected" : "idle");
      return;
    }
    if (!onIntegrationStatus) return;
    const result = await onIntegrationStatus({ integrationId: "github", probe });
    const nextEntry = statusEntry(result);
    setEntry(nextEntry);
    setStep(isUsable(nextEntry) ? "connected" : "idle");
  }, [connectorsProvider, onIntegrationStatus]);

  React.useEffect(() => {
    if (!connected || (!connectorsProvider && (!onIntegrationStatus || !hasCapability))) {
      return;
    }
    let cancelled = false;
    const statusPromise: Promise<GatewayIntegrationStatusEntry | null> = connectorsProvider
      ? connectorsProvider.list({ connectorId: "github" }).then((connectors) => {
        const connector = connectors.find((candidate) => candidate.connectorId === "github");
        return connector ? {
          configured: connector.configured,
          authenticated: connector.authenticated,
          usable: connector.usable,
        } : null;
      })
      : onIntegrationStatus!({ integrationId: "github", probe: false }).then(statusEntry);
    void statusPromise.then((nextEntry) => {
        if (cancelled) return;
        setEntry(nextEntry);
        setStep(isUsable(nextEntry) ? "connected" : "idle");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError("GitHub status is not available yet. Check the agent connection and refresh.");
        setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
        setStep("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, connectorsProvider, hasCapability, onIntegrationStatus]);

  React.useEffect(() => {
    if (!connected || step !== "pending" || !authId || (!connectorsProvider && (!onAuthStatus || !onIntegrationStatus))) return;
    let cancelled = false;
    let polling = false;
    const reportedIntervalMs = runtimeSetup?.pollIntervalMs ?? authStart?.intervalMs;
    const intervalMs = typeof reportedIntervalMs === "number" ? Math.max(reportedIntervalMs, 1500) : 3000;
    const expiresAt = authExpiryDeadline(runtimeSetup?.expiresAt ?? authStart?.expiresAt);
    const poll = async () => {
      if (polling || cancelled) return;
      if (Date.now() >= expiresAt) {
        setError("GitHub authorization expired. Start the connection again and approve the new code.");
        setTechnicalDetails(null);
        setStep("failed");
        return;
      }
      polling = true;
      setAuthPolling(true);
      try {
        if (connectorsProvider) {
          const result = await connectorsProvider.pollSetup({ connectorId: "github", setupId: authId });
          if (cancelled) return;
          if (result.state === "complete") {
            setError(null);
            setTechnicalDetails(null);
            setEntry({
              configured: true,
              authenticated: true,
              usable: true,
              connectionId: result.connectionId,
              accountDisplayName: result.accountDisplayName,
              scopes: result.scopes,
            });
            setStep("connected");
            return;
          }
          if (result.state === "failed") {
            setError("GitHub authorization did not finish. Start the connection again and approve the new code.");
            setTechnicalDetails(result.error?.trim() || null);
            setStep("failed");
            return;
          }
          setError(null);
          setTechnicalDetails(null);
          return;
        }
        const result = await onAuthStatus!({ authId, integrationId: "github" });
        if (cancelled) return;
        if (authDone(result)) {
          setAuthStart((prev) => ({ ...(prev ?? {}), ...result }));
          const statusResult = await onIntegrationStatus!({ integrationId: "github", connectionId: result.connectionId, probe: true });
          if (cancelled) return;
          setEntry(statusEntry(statusResult) ?? {
            configured: true,
            authenticated: true,
            usable: true,
            connectionId: result.connectionId,
            accountDisplayName: result.accountDisplayName,
            scopes: result.scopes,
          });
          setStep("connected");
          return;
        }
        if (authFailed(result)) {
          setError("GitHub authorization did not finish. Start the connection again and approve the new code.");
          setTechnicalDetails(result.error?.trim() || null);
          setStep("failed");
          return;
        }
        const statusResult = await onIntegrationStatus!({ integrationId: "github", probe: true });
        if (cancelled) return;
        const nextEntry = statusEntry(statusResult);
        if (isUsable(nextEntry)) {
          setError(null);
          setTechnicalDetails(null);
          setEntry(nextEntry);
          setStep("connected");
          return;
        }
        setError(null);
        setTechnicalDetails(null);
      } catch (cause) {
        if (!cancelled) {
          setError("GitHub is taking longer to confirm. We will keep checking automatically.");
          setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
        }
      } finally {
        polling = false;
        if (!cancelled) setAuthPolling(false);
      }
    };
    const timer = window.setInterval(() => void poll(), intervalMs);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authId, authPollRevision, authStart?.expiresAt, authStart?.intervalMs, connected, connectorsProvider, onAuthStatus, onIntegrationStatus, runtimeSetup?.expiresAt, runtimeSetup?.pollIntervalMs, step]);

  const generateWorkflow = React.useCallback(async () => {
    if (!allowProductUse()) return false;
    if (!onGenerateConnectorWorkflow) return false;
    setWorkflowLoading(true);
    setWorkflowUnavailable(false);
    setError(null);
    try {
      setWorkflow(await onGenerateConnectorWorkflow("github"));
      return true;
    } catch {
      if (!workflow) setWorkflowUnavailable(true);
      return false;
    } finally {
      setWorkflowLoading(false);
    }
  }, [allowProductUse, onGenerateConnectorWorkflow, workflow]);

  React.useEffect(() => {
    if (!directSetup || !connected || !onGenerateConnectorWorkflow || directSetupStartedRef.current) return;
    directSetupStartedRef.current = true;
    void generateWorkflow();
  }, [connected, directSetup, generateWorkflow, onGenerateConnectorWorkflow]);

  const startAgentSetup = React.useCallback(async () => {
    if (!allowProductUse()) return;
    if (!onStartAgentGitHubSetup && onGenerateConnectorWorkflow) {
      await generateWorkflow();
      return;
    }
    setAgentSetupStarted(true);
    setAgentSetupSending(true);
    setSettingUpCopyIndex(0);
    setCopiedCode(false);
    if (verificationResetTimerRef.current) clearTimeout(verificationResetTimerRef.current);
    verificationResetTimerRef.current = null;
    setAgentVerificationRequested(false);
    setError(null);
    setTechnicalDetails(null);
    try {
      if (!onStartAgentGitHubSetup) {
        throw new Error("Ask the agent to set up GitHub from chat; this page cannot start the setup prompt automatically.");
      }
      await onStartAgentGitHubSetup();
    } catch (cause) {
      setError("GitHub setup did not start. Check the agent connection and try again.");
      setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
    } finally {
      setAgentSetupSending(false);
    }
  }, [allowProductUse, generateWorkflow, onGenerateConnectorWorkflow, onStartAgentGitHubSetup]);

  const start = async () => {
    if (!allowProductUse()) return;
    setError(null);
    setTechnicalDetails(null);
    setAuthStart(null);
    setRuntimeSetup(null);
    setWorkflow(null);
    setWorkflowUnavailable(false);
    if (!hasManagedMethods || (!connectorsProvider && !onAuthStart)) {
      await startAgentSetup();
      return;
    }

    setStep("starting");
    try {
      if (connectorsProvider) {
        const result = await connectorsProvider.startSetup({ connectorId: "github", mode: "managed-auth", scopes: GITHUB_SCOPES });
        setRuntimeSetup(result);
        if (result.setupId) {
          setStep("pending");
        } else {
          await refresh(true);
        }
        return;
      }
      if (!onAuthStart) throw new Error("GitHub authorization is unavailable for this workspace.");
      const result = await onAuthStart({ integrationId: "github", scopes: GITHUB_SCOPES });
      setAuthStart(result);
      if (result.authId) {
        setStep("pending");
      } else {
        await refresh(true);
      }
    } catch (cause) {
      if (isManagedGitHubAuthUnsupportedError(cause)) {
        setStep("idle");
        await startAgentSetup();
        return;
      }
      setError("GitHub authorization did not start. Check the agent connection and try again.");
      setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
      setStep("failed");
    }
  };

  const copyDeviceCode = async (code: string) => {
    if (!code || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
    } catch {
      setError("Could not copy the GitHub device code.");
    }
  };

  const copyAgentDeviceCode = async (code: string) => {
    if (codeRippleTimerRef.current) clearTimeout(codeRippleTimerRef.current);
    setCodeRippleActive(true);
    await copyDeviceCode(code);
    codeRippleTimerRef.current = setTimeout(() => {
      setCodeRippleActive(false);
      codeRippleTimerRef.current = null;
    }, 3000);
  };

  const disconnect = async () => {
    if (!onDisconnect) return;
    setDisconnecting(true);
    setError(null);
    setTechnicalDetails(null);
    try {
      const result = await onDisconnect({ integrationId: "github", connectionId: entry?.connectionId, revoke: true });
      if (result?.ok !== true) {
        setError("GitHub is still connected. Check the agent connection and try disconnecting again.");
        setTechnicalDetails("The gateway did not confirm that GitHub was disconnected.");
        return;
      }
      setEntry(null);
      setAuthStart(null);
      setStep("idle");
      setDisconnectConfirmOpen(false);
    } catch (cause) {
      setError("GitHub is still connected. Check the agent connection and try disconnecting again.");
      setTechnicalDetails(cause instanceof Error && cause.message.trim() ? cause.message.trim() : null);
    } finally {
      setDisconnecting(false);
    }
  };

  if (!connected) {
    return (
      <GitHubSignalCard
        tone="warning"
        heroLabel="Offline"
        heroSubtitle="Start or reconnect the agent, then try again. Do not paste GitHub tokens into chat."
        actions={(
          <>
            {onOpenFullSetup && <button type="button" className={buttonClass()} onClick={onOpenFullSetup}>Open integrations</button>}
            {onOpenIntegrationDetails && <button type="button" className={buttonClass()} onClick={onOpenIntegrationDetails}>Open in integrations</button>}
            {onDismiss && <button type="button" className={buttonClass()} onClick={onDismiss}>Dismiss</button>}
          </>
        )}
      >
        <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Start or reconnect the agent, then try again. Do not paste GitHub tokens into chat.</p>
        </div>
      </GitHubSignalCard>
    );
  }

  const visibleStep = (!connectorsProvider && (!hasCapability || !onIntegrationStatus)) && step === "checking" ? "idle" : step;
  const tone: GitHubCardTone = workflowActive
    ? effectiveWorkflowUnavailable ? "warning" : "info"
    : agentFlowActive
    ? agentSetupSucceeded
      ? "primary"
      : agentSetupFailed
        ? "warning"
        : "neutral"
    : visibleStep === "connected" ? "primary" : visibleStep === "failed" ? "warning" : visibleStep === "idle" ? "neutral" : "warning";
  const heroLabel = workflowActive
    ? workflow ? "Setup guide" : workflowLoading ? "Preparing setup" : "Guidance unavailable"
    : agentFlowActive
    ? settingEverythingUpActive ? SETTING_UP_ROTATING_COPY[settingUpCopyIndex] ?? SETTING_UP_ROTATING_COPY[0] : agentSetupHeroLabel
    : managedHeroLabel(visibleStep, managedUserCode);
  const heroSubtitle = workflowActive
    ? workflow ? "Review each setup step before making changes." : "Preparing setup guidance."
    : agentFlowActive
    ? ""
    : managedHeroSubtitle(visibleStep);
  const iconLoading = (workflowLoading && !workflow) || (agentFlowActive
    ? !agentSetupSucceeded && !agentSetupFailed
    : visibleStep === "starting" || visibleStep === "pending");

  return (
    <>
      <GitHubSignalCard
        tone={tone}
        heroLabel={heroLabel}
        heroSubtitle={heroSubtitle}
        iconLoading={iconLoading}
        actions={(
          <>
          {workflowActive ? (
            effectiveWorkflowUnavailable ? (
              <button type="button" className={buttonClass("primary")} disabled={workflowLoading} onClick={() => void generateWorkflow()}>
                Try again
              </button>
            ) : null
          ) : agentFlowActive ? (
            <>
              {showAgentDeviceCode && onVerifyAgentGitHubSetup ? (
                <button type="button" className={buttonClass()} disabled={checkingAgentAuthorization} onClick={() => { if (allowProductUse()) void verifyAgentGitHubSetup(true); }}>
                  {checkingAgentAuthorization ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {checkingAgentAuthorization ? "Checking" : "Check connection"}
                </button>
              ) : null}
              {((githubAgentStatus.phase === "idle" && (!agentSetupStarted || Boolean(error))) || githubAgentStatus.phase === "failed") && (
                <button type="button" className={buttonClass("primary")} disabled={agentSetupSending} onClick={() => void startAgentSetup()}>
                  {githubAgentStatus.phase === "failed" ? "Try again" : "Start connection"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          ) : (visibleStep === "idle" || visibleStep === "failed") ? (
            <button type="button" className={buttonClass("primary")} onClick={() => void start()}>
              Start connection
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {!agentFlowActive && visibleStep === "pending" && managedUserCode && (
            <>
              <button type="button" className={buttonClass("primary")} onClick={() => void copyDeviceCode(managedUserCode)}>
                <Copy className="h-3.5 w-3.5" />
                {copiedCode ? "Copied" : "Copy code"}
              </button>
              <a href={managedVerificationHref} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open GitHub
              </a>
              <button type="button" className={buttonClass()} disabled={authPolling} onClick={() => setAuthPollRevision((current) => current + 1)}>
                <RefreshCw className={`h-3.5 w-3.5 ${authPolling ? "animate-spin" : ""}`} />
                Check connection
              </button>
            </>
          )}
          {!agentFlowActive && visibleStep === "connected" && (
            <>
              {onIntegrationStatus && (
                <button type="button" className={buttonClass()} onClick={() => { if (allowProductUse()) void refresh(true); }}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Test
                </button>
              )}
              {onDisconnect && (
                <button type="button" className={buttonClass("caution")} disabled={disconnecting} onClick={() => setDisconnectConfirmOpen(true)}>
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Disconnect
                </button>
              )}
            </>
          )}
          {onOpenIntegrationDetails && <button type="button" className={buttonClass()} onClick={onOpenIntegrationDetails}>Open in integrations</button>}
          {onDismiss && <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button>}
          </>
        )}
      >
      {error && (
        <div className="mb-2 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-warning">
          <p role="alert">{error}</p>
          {technicalDetails ? <RecoveryDetails label="Technical details" technicalDetails={technicalDetails} className="mt-2 text-left" /> : null}
        </div>
      )}
      {workflowActive ? (
        <ConnectorWorkflowGuide
          workflow={workflow}
          loading={workflowLoading}
          unavailable={effectiveWorkflowUnavailable}
          onRequestProductUse={onRequestProductUse}
          onRunShellProposal={onRunShellProposal}
        />
      ) : agentFlowActive ? (
        <>
          {agentSetupSucceeded ? <GitHubCongratulations accountDisplayName={githubAgentStatus.accountDisplayName} /> : null}
          {showAgentDeviceCode && agentDeviceCode && (
            <div className="grid gap-4 px-2 py-3 text-center sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:text-left">
              <div className="min-w-0">
                <TooltipHint label="Copy code">
                  <button
                    type="button"
                    onClick={() => void copyAgentDeviceCode(agentDeviceCode)}
                    disabled={checkingAgentAuthorization}
                    className="relative isolate max-w-full font-mono text-[clamp(1.65rem,9vw,3rem)] font-bold tracking-[0.12em] text-foreground transition-colors hover:text-selection-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Copy GitHub device code ${agentDeviceCode}`}
                  >
                    {codeRippleActive ? (
                      <motion.span
                        key="device-code-ripple"
                        aria-hidden="true"
                        data-testid="github-device-code-ripple"
                        className="pointer-events-none absolute inset-[-0.45rem] -z-10 rounded-2xl border border-selection-accent/50 bg-selection-accent/12"
                        initial={reduceMotion ? false : { opacity: 0.82, scale: 0.72 }}
                        animate={reduceMotion ? { opacity: 0.2, scale: 1 } : { opacity: 0, scale: 1.42 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 3, ease: [0.16, 1, 0.3, 1] }}
                      />
                    ) : null}
                    {agentDeviceCode}
                  </button>
                </TooltipHint>
                <p className="mt-3 text-sm font-medium text-text-secondary sm:text-base">
                  {checkingAgentAuthorization
                    ? "Checking GitHub now. You do not need to enter this code again."
                    : copiedCode
                      ? "Copied. Enter it on GitHub, then return here."
                      : "Click the code to copy it, then enter it on GitHub."}
                </p>
              </div>
              {!checkingAgentAuthorization ? (
                <a href={githubAgentStatus.verificationUri ?? GITHUB_CLI_DEVICE_URL} target="_blank" rel="noopener noreferrer" className={`${buttonClass("primary")} justify-center sm:self-center`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open GitHub
                </a>
              ) : null}
            </div>
          )}
        </>
      ) : visibleStep === "checking" || visibleStep === "starting" ? (
        null
      ) : visibleStep === "pending" ? (
        <div className="space-y-3">
          <p>{runtimeSetup?.instructions ?? "Enter the code on GitHub, then return here."}</p>
          {managedUserCode && (
            <div className="rounded-lg border border-border bg-background/70 px-3 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Device code</p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-[0.14em] text-foreground" aria-label={`GitHub device code ${managedUserCode}`}>{managedUserCode}</p>
            </div>
          )}
          <a href={managedVerificationHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-[var(--link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Open GitHub
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : visibleStep === "connected" ? (
        <div className="space-y-2">
          <p className="font-medium text-success">GitHub connected{accountDisplayName ? ` as ${String(accountDisplayName)}` : ""}.</p>
        </div>
      ) : (
        null
      )}
      </GitHubSignalCard>
      <ConfirmDialog
        open={disconnectConfirmOpen}
        title="Disconnect GitHub?"
        message="This revokes the saved GitHub connection for this workspace. The agent will need a new authorization before it can use GitHub again."
        confirmLabel="Disconnect GitHub"
        loading={disconnecting}
        onConfirm={() => void disconnect()}
        onCancel={() => { if (!disconnecting) setDisconnectConfirmOpen(false); }}
      />
    </>
  );
}
