"use client";

import type { ComponentProps, CSSProperties } from "react";
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { ChannelChatConnectorCard } from "./ChannelChatConnectorCard";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

export interface SlackRelaySetupOptions {
  mode: "prompt" | "hosted" | "self-hosted";
  handle: string;
  hostedAvailable: boolean;
  connected: boolean | null;
  workspace: string | null;
  attached: boolean;
  checking: boolean;
  configuring: boolean;
  error: string | null;
  connectHref: string;
  onChooseHosted: () => void;
  onChooseSelfHosted: () => void;
  onBackToChoice: () => void;
  onRefreshHosted: () => void;
  onConfigureHosted: () => void;
  onRememberReturn?: () => void;
}

type SlackChatConnectorCardProps = Omit<ComponentProps<typeof ChannelChatConnectorCard>, "channelId" | "directSetup"> & {
  slackRelaySetup: SlackRelaySetupOptions;
};

function buttonClass(tone: "primary" | "secondary" = "secondary") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--channel-accent)] px-3 text-xs font-black uppercase tracking-[0.12em] text-[var(--channel-accent-foreground)] shadow-[0_0_24px_color-mix(in_srgb,var(--channel-accent)_24%,transparent)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-3 text-xs font-black uppercase tracking-[0.12em] text-text-secondary backdrop-blur transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
}

function choiceClass(tone: "primary" | "secondary" = "secondary") {
  if (tone === "primary") {
    return "flex min-h-[92px] w-full flex-col items-start justify-center rounded-xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-4 py-3 text-left transition-colors hover:border-[var(--channel-accent)] disabled:cursor-not-allowed disabled:opacity-50";
  }
  return "flex min-h-[92px] w-full flex-col items-start justify-center rounded-xl border border-border bg-surface-low/80 px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-50";
}

export function SlackChatConnectorCard({
  slackRelaySetup,
  onDismiss,
  ...channelProps
}: SlackChatConnectorCardProps) {
  const hostedReady = slackRelaySetup.hostedAvailable && slackRelaySetup.connected === true;
  const docsHref = "https://docs.hypercli.com/agents/integrations";

  if (slackRelaySetup.mode === "self-hosted") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={buttonClass()} onClick={slackRelaySetup.onBackToChoice}>
            Back to Slack options
          </button>
          {hostedReady ? (
            <button type="button" className={buttonClass("primary")} onClick={slackRelaySetup.onChooseHosted}>
              Use the HyperCLI Slack App instead
            </button>
          ) : (
            <a href={docsHref} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
              Read the docs
            </a>
          )}
        </div>
        <ChannelChatConnectorCard
          {...channelProps}
          channelId="slack"
          directSetup
          onDismiss={onDismiss}
        />
      </div>
    );
  }

  const brand = INTEGRATION_BRAND_LOGOS.slack;
  const Icon = brand.icon;
  const active = slackRelaySetup.checking || slackRelaySetup.configuring;
  const style = {
    "--channel-accent": "var(--selection-accent)",
    "--channel-accent-foreground": "var(--selection-accent-foreground)",
    "--channel-accent-border": "color-mix(in srgb, var(--channel-accent) 33%, transparent)",
    "--channel-accent-soft": "color-mix(in srgb, var(--channel-accent) 9%, transparent)",
  } as CSSProperties;

  return (
    <section
      className="group relative mb-3 overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-2xl"
      style={style}
      aria-live="polite"
    >
      <Icon className="pointer-events-none absolute -right-14 -top-10 h-52 w-52 rotate-12 opacity-[0.14] sm:-right-16 sm:h-64 sm:w-64" style={{ color: brand.color }} />
      <div className="relative z-10 p-4 sm:p-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <IntegrationBrandPulse active={active} accentColor={brand.color}>
            <Icon className="h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]" style={{ color: brand.color }} />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <p className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em]" style={{ color: brand.color }}>
              Create Slack app
            </p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">
              Choose self-hosted Socket Mode or the HyperCLI Slack App.
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 space-y-3 border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5">
        {slackRelaySetup.mode === "prompt" ? (
          <div className="rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
            <p className="text-sm font-bold text-foreground">Select Slack transport</p>
            <p className="mt-2 text-xs leading-5 text-text-secondary">
              Self-hosted uses your own Slack app token and bot token. The HyperCLI Slack App appears here only after this HyperCLI account has connected Slack.
            </p>
            {slackRelaySetup.checking ? (
              <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking HyperCLI Slack App status...
              </p>
            ) : hostedReady ? (
              <div className="mt-3 rounded-xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-3 py-2 text-xs leading-5 text-text-secondary">
                <span className="font-semibold text-foreground">HyperCLI Slack App Enabled</span>
                {slackRelaySetup.workspace ? ` for ${slackRelaySetup.workspace}` : ""}. <a href={docsHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--channel-accent)] underline-offset-2 hover:underline">Read the docs</a>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-border bg-surface-low px-3 py-2 text-xs leading-5 text-text-secondary">
                HyperCLI Slack App is not connected for this account. Use self-hosted Slack here, or connect Slack from Settings.
              </div>
            )}
            <div className={`mt-4 grid gap-2 ${hostedReady ? "sm:grid-cols-2" : ""}`}>
              <button type="button" className={choiceClass()} onClick={slackRelaySetup.onChooseSelfHosted}>
                <span className="text-xs font-black uppercase tracking-[0.12em] text-foreground">Self-hosted Socket Mode</span>
                <span className="mt-1 text-[11px] leading-4 text-text-muted">Use a custom Slack app for this agent.</span>
              </button>
              {hostedReady ? (
                <button type="button" className={choiceClass("primary")} onClick={slackRelaySetup.onChooseHosted}>
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-foreground">HyperCLI Slack App</span>
                  <span className="mt-1 text-[11px] leading-4 text-text-muted">Use hosted relay for @{slackRelaySetup.handle}.</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">HyperCLI Slack App</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  The hosted @{slackRelaySetup.handle} app connects through relay. No Slack bot or app token is pasted into this agent.
                </p>
              </div>
              <button type="button" className={buttonClass()} onClick={slackRelaySetup.onRefreshHosted} disabled={slackRelaySetup.checking}>
                {slackRelaySetup.checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-border bg-surface-low px-3 py-2 text-xs text-text-secondary">
              {slackRelaySetup.checking
                ? "Checking Slack connection..."
                : slackRelaySetup.attached
                  ? `Relay config saved${slackRelaySetup.workspace ? ` for ${slackRelaySetup.workspace}` : ""}. Stop and start the agent to load it.`
                  : slackRelaySetup.connected
                  ? `Connected${slackRelaySetup.workspace ? ` to ${slackRelaySetup.workspace}` : ""}.`
                  : "Connect Slack once for this HyperCLI account, then return here to attach this agent."}
            </div>
            {slackRelaySetup.connected ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-3 py-2 text-[var(--channel-accent)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{slackRelaySetup.attached ? "Hosted relay is attached. Restart the agent to load Slack." : "Slack OAuth is connected. Attach this agent, then stop and start it to load hosted relay."}</p>
              </div>
            ) : null}
          </div>
        )}
        {slackRelaySetup.error ? (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">{slackRelaySetup.error}</p>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-high/35 px-4 py-3 backdrop-blur-md sm:px-5">
        {slackRelaySetup.mode === "hosted" ? (
          <>
            <button type="button" className={buttonClass()} disabled={slackRelaySetup.configuring} onClick={slackRelaySetup.onBackToChoice}>Back</button>
            {slackRelaySetup.connected ? (
              <button type="button" className={buttonClass("primary")} disabled={slackRelaySetup.configuring} onClick={slackRelaySetup.onConfigureHosted}>
                {slackRelaySetup.configuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Attach agent
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <a href={slackRelaySetup.connectHref} onClick={slackRelaySetup.onRememberReturn} className={buttonClass("primary")}>
                Connect Slack <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        ) : (
          <>
            <button type="button" className={buttonClass()} onClick={slackRelaySetup.onChooseSelfHosted}>
              Self-hosted
            </button>
            {hostedReady ? (
              <button type="button" className={buttonClass("primary")} onClick={slackRelaySetup.onChooseHosted}>
                HyperCLI Slack App <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </>
        )}
        {onDismiss ? <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button> : null}
      </div>
    </section>
  );
}
