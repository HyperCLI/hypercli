"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

type SlackOauthResultMessage = {
  source: "hypercli.slack-oauth";
  integrationId: "slack";
  ok: boolean;
  teamId?: string;
  error?: string;
};

function buildResult(searchParams: URLSearchParams): SlackOauthResultMessage {
  const ok = searchParams.get("ok") === "true";
  const teamId = searchParams.get("team_id")?.trim() || undefined;
  const error = searchParams.get("error")?.trim() || undefined;
  return {
    source: "hypercli.slack-oauth",
    integrationId: "slack",
    ok,
    teamId,
    error,
  };
}

function SlackOauthCompleteContent() {
  const searchParams = useSearchParams();
  const sentRef = useRef(false);
  const result = buildResult(searchParams);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    if (!window.opener) return;
    window.opener.postMessage(result, window.location.origin);
    window.setTimeout(() => {
      window.close();
    }, 150);
  }, [result]);

  const title = result.ok ? "Slack connected" : "Slack connection failed";
  const description = result.ok
    ? "This window can close automatically. If it stays open, you can close it."
    : "This popup reported the OAuth result back to the dashboard. You can close it and try again.";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <p className="mb-3 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-neutral-400">
          Slack OAuth
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-neutral-300">{description}</p>
        {result.teamId ? (
          <p className="mt-4 text-xs font-mono uppercase tracking-[0.18em] text-neutral-500">
            Team {result.teamId}
          </p>
        ) : null}
        {result.error ? (
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-rose-300">
            Error: {result.error}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-full border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/15"
          >
            Close window
          </button>
          <Link
            href="/dashboard/agents"
            className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-5 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SlackOauthCompletePage() {
  return (
    <Suspense fallback={(
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Completing Slack connection</h1>
        </div>
      </main>
    )}>
      <SlackOauthCompleteContent />
    </Suspense>
  );
}
