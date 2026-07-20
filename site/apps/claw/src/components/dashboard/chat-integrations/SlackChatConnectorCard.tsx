"use client";

import type { ComponentProps, CSSProperties } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";

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

export function SlackChatConnectorCard({
  slackRelaySetup,
  onDismiss,
  ...channelProps
}: SlackChatConnectorCardProps) {
  const docsHref = "https://docs.hypercli.com/agents/integrations";

  if (slackRelaySetup.mode === "self-hosted") {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-low/75 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Advanced mode</p>
            <p className="mt-1 text-xs leading-5 text-text-secondary">Use your own Slack app with Socket Mode credentials.</p>
          </div>
          {slackRelaySetup.hostedAvailable ? (
            <button
              type="button"
              onClick={slackRelaySetup.onChooseHosted}
              className="group inline-flex shrink-0 items-center gap-2 text-left text-[11px] text-text-muted transition-colors hover:text-foreground"
            >
              <span>Use the faster setup</span>
              <span className="font-bold text-foreground underline decoration-border underline-offset-4 group-hover:decoration-foreground">Express mode</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
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
  const connectedWorkspace = slackRelaySetup.workspace ? ` to ${slackRelaySetup.workspace}` : "";
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
      <Icon aria-hidden="true" className="pointer-events-none absolute -right-14 -top-10 h-52 w-52 rotate-12 opacity-[0.14] sm:-right-16 sm:h-64 sm:w-64" style={{ color: brand.color }} />
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss Slack setup"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/75 text-text-muted backdrop-blur transition-colors hover:bg-surface-high hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="relative z-10 p-4 sm:p-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <IntegrationBrandPulse active={active} accentColor={brand.color}>
            <Icon className="h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]" style={{ color: brand.color }} />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <p className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em]" style={{ color: brand.color }}>
              Connect Slack
            </p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">
              Fast hosted setup by default, with full Socket Mode control when you need it.
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 space-y-3 border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5">
        {slackRelaySetup.mode === "prompt" ? (
          <div className="space-y-3 rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
            {slackRelaySetup.hostedAvailable ? (
              slackRelaySetup.checking ? (
                <button
                  type="button"
                  disabled
                  className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/15 px-4 py-4 text-left text-white opacity-70 shadow-sm sm:px-5"
                  style={{ backgroundColor: brand.color }}
                >
                  <Icon aria-hidden="true" className="pointer-events-none absolute -right-5 -top-7 h-28 w-28 rotate-12 opacity-15" />
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-black/15 backdrop-blur-sm">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-white/70">Express mode</span>
                    <span className="mt-0.5 block text-base font-black tracking-[-0.01em]">Checking Slack connection</span>
                    <span className="mt-0.5 block text-[11px] text-white/75">Confirming whether this account already has Slack connected.</span>
                  </span>
                </button>
              ) : slackRelaySetup.connected ? (
                <button
                  type="button"
                  onClick={slackRelaySetup.onChooseHosted}
                  className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/15 px-4 py-4 text-left text-white shadow-sm transition-all hover:-translate-y-0.5 hover:brightness-105 sm:px-5"
                  style={{ backgroundColor: brand.color }}
                >
                  <Icon aria-hidden="true" className="pointer-events-none absolute -right-5 -top-7 h-28 w-28 rotate-12 opacity-15 transition-transform group-hover:scale-110" />
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-black/15 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-white/70">Express mode</span>
                    <span className="mt-0.5 block text-base font-black tracking-[-0.01em]">Continue Express setup</span>
                    <span className="mt-0.5 block text-[11px] text-white/75">Slack is connected{connectedWorkspace}. Attach the hosted app without copying tokens.</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="relative h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" />
                </button>
              ) : (
                <a
                  href={slackRelaySetup.connectHref}
                  onClick={slackRelaySetup.onRememberReturn}
                  className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/15 px-4 py-4 text-left text-white shadow-sm transition-all hover:-translate-y-0.5 hover:brightness-105 sm:px-5"
                  style={{ backgroundColor: brand.color }}
                >
                  <Icon aria-hidden="true" className="pointer-events-none absolute -right-5 -top-7 h-28 w-28 rotate-12 opacity-15 transition-transform group-hover:scale-110" />
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-black/15 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-white/70">Express mode</span>
                    <span className="mt-0.5 block text-base font-black tracking-[-0.01em]">Connect with Slack</span>
                    <span className="mt-0.5 block text-[11px] text-white/75">Authorize the hosted @{slackRelaySetup.handle} app. No bot or app tokens required.</span>
                  </span>
                  <ExternalLink aria-hidden="true" className="relative h-5 w-5 shrink-0" />
                </a>
              )
            ) : (
              <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface-low/80 px-4 py-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-text-muted">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">Express mode unavailable</p>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">Use Advanced mode with your own Slack app for this environment.</p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={slackRelaySetup.onChooseSelfHosted}
              className="group inline-flex items-center gap-2 px-1 text-left text-[11px] text-text-muted transition-colors hover:text-foreground"
            >
              <span>Prefer your own Slack app?</span>
              <span className="font-bold text-foreground underline decoration-border underline-offset-4 group-hover:decoration-foreground">Advanced mode</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--channel-accent)]">Express mode</p>
                <p className="mt-1 text-sm font-bold text-foreground">HyperCLI Slack App</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  The hosted @{slackRelaySetup.handle} app connects without pasting a Slack bot or app token into this agent.
                </p>
              </div>
              <button type="button" className={buttonClass()} onClick={slackRelaySetup.onRefreshHosted} disabled={slackRelaySetup.checking}>
                {slackRelaySetup.checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </button>
            </div>
            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${slackRelaySetup.connected ? "border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] text-[var(--channel-accent)]" : "border-border bg-surface-low text-text-secondary"}`}>
              {slackRelaySetup.checking ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              ) : slackRelaySetup.connected ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
              <p>
                {slackRelaySetup.checking
                  ? "Checking Slack connection..."
                  : slackRelaySetup.attached
                    ? `Express mode is attached${connectedWorkspace}. Restart the agent to load Slack.`
                    : slackRelaySetup.connected
                      ? `Connected${connectedWorkspace}. Attach this agent, then restart it to load Slack.`
                      : "Connect Slack once for this account, then return here to attach this agent."}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={slackRelaySetup.onChooseSelfHosted}
                disabled={slackRelaySetup.configuring}
                className="group inline-flex items-center gap-2 text-left text-[11px] text-text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                <span>Prefer your own Slack app?</span>
                <span className="font-bold text-foreground underline decoration-border underline-offset-4 group-hover:decoration-foreground">Advanced mode</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
              {!slackRelaySetup.attached ? (
                slackRelaySetup.connected ? (
                  <button type="button" className={buttonClass("primary")} disabled={slackRelaySetup.configuring} onClick={slackRelaySetup.onConfigureHosted}>
                    {slackRelaySetup.configuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Attach agent <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <a href={slackRelaySetup.connectHref} onClick={slackRelaySetup.onRememberReturn} className={buttonClass("primary")}>
                    Connect with Slack <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )
              ) : null}
            </div>
          </div>
        )}
        {slackRelaySetup.error ? (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">{slackRelaySetup.error}</p>
        ) : null}
      </div>
    </section>
  );
}
