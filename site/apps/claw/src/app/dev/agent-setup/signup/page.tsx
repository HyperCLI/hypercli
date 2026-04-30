"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type SignupState = "idle" | "submitting" | "complete";

export default function DevAgentSetupSignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("sam@hypercli.com");
  const [state, setState] = useState<SignupState>("idle");

  const completeSignup = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;
    setState("submitting");
    window.setTimeout(() => {
      window.sessionStorage.setItem("dev-agent-setup-email", normalizedEmail);
      window.dispatchEvent(new Event("dev-agent-setup-email-change"));
      setState("complete");
      window.setTimeout(() => {
        router.push("/dev/agent-setup");
      }, 450);
    }, 650);
  };

  return (
    <div className="min-h-full pb-10">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section
          className="overflow-hidden rounded-xl border border-primary/20 bg-surface-low/80"
          style={{
            background:
              "radial-gradient(140% 90% at 0% 0%, rgba(56,211,159,0.10) 0%, rgba(20,20,22,0.85) 55%, rgba(13,13,15,0.9) 100%)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 36px rgba(0,0,0,0.28)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
            <div className="text-base font-bold">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">Claw</span>
            </div>
            <nav className="hidden items-center gap-6 text-sm font-medium text-text-tertiary md:flex">
              <span>Features</span>
              <span>Pricing</span>
              <span>Docs</span>
            </nav>
          </div>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Welcome in</p>
              <h2 className="mt-3 max-w-xl text-2xl font-bold leading-tight text-foreground sm:text-3xl">
                Let us get your first agent set up together.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-text-secondary">
                This guided flow mirrors the real sign-in path, then brings you into a calm setup where every step is previewed before anything important happens.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <ProcessStep icon={UserRound} label="Start" active={state === "idle"} complete={state !== "idle"} />
                <ProcessStep icon={ShieldCheck} label="Sign in" active={state === "submitting"} complete={state === "complete"} />
                <ProcessStep icon={ChevronRight} label="Begin setup" active={state === "complete"} complete={state === "complete"} />
              </div>
            </div>

            <div className="border-t border-white/8 p-5 lg:border-l lg:border-t-0">
              <div className="rounded-xl border border-white/8 bg-background/60 p-4 backdrop-blur-sm">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">Session ready</p>
                <div className="space-y-3 text-sm">
                  <SessionRow label="Signed in as" value={email || "pending"} complete={state === "complete"} />
                  <SessionRow label="Session mode" value="cookie mode" complete={state === "complete"} />
                  <SessionRow label="Next stop" value="/dev/agent-setup" complete={state === "complete"} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside
          className="overflow-hidden rounded-xl border border-primary/25 bg-surface-low/80 p-6"
          style={{
            background:
              "radial-gradient(120% 90% at 0% 0%, rgba(56,211,159,0.14) 0%, rgba(20,20,22,0.9) 55%, rgba(13,13,15,0.92) 100%)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset, 0 14px 40px rgba(56,211,159,0.10)",
          }}
        >
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground ring-1 ring-white/15">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Welcome to HyperClaw</h2>
            <p className="mt-1 text-sm text-text-secondary">Use an email and we will open your guided setup.</p>
          </div>

          <label className="mb-2 block text-sm font-medium text-foreground">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-lg border border-white/8 bg-background/60 pl-10 pr-3 text-sm text-foreground placeholder:text-text-muted transition-all focus:border-primary/60 focus:bg-background focus:outline-none focus:shadow-[0_0_0_3px_rgba(56,211,159,0.12)]"
              placeholder="you@company.com"
            />
          </div>

          <button
            type="button"
            onClick={completeSignup}
            disabled={state === "submitting" || !email.trim()}
            className="btn-primary mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {state === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {state === "complete" ? "Opening setup" : state === "submitting" ? "Getting things ready" : "Continue with email"}
          </button>

          <div className="mt-5 space-y-2 border-t border-white/8 pt-5 text-xs text-text-tertiary">
            <AuthEvent done={state !== "idle"} label="Email accepted" />
            <AuthEvent done={state === "complete"} label="HyperClaw session ready" />
            <AuthEvent done={state === "complete"} label="Setup is waiting for you" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function ProcessStep({
  icon: Icon,
  label,
  active,
  complete,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-3 transition-all duration-300 ease-out ${
        active || complete
          ? "border-primary/35 bg-primary/[0.08]"
          : "border-white/8 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 transition-colors ${
            complete
              ? "bg-primary text-primary-foreground ring-white/15"
              : active
                ? "bg-primary/15 text-primary ring-primary/30"
                : "bg-white/[0.04] text-text-muted ring-white/8"
          }`}
        >
          {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </div>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
    </div>
  );
}

function SessionRow({
  label,
  value,
  complete,
}: {
  label: string;
  value: string;
  complete: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${
        complete ? "border-primary/25 bg-primary/[0.08]" : "border-white/8 bg-white/[0.02]"
      }`}
    >
      <span className="text-text-muted">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-2 text-right font-medium text-foreground">
        {complete ? <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" /> : null}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function AuthEvent({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${done ? "bg-primary/[0.08] text-text-secondary" : ""}`}>
      <span className={`h-2 w-2 rounded-full transition-all ${done ? "bg-primary shadow-[0_0_10px_rgba(56,211,159,0.5)]" : "bg-text-muted/60"}`} />
      <span className={done ? "text-text-secondary" : undefined}>{label}</span>
    </div>
  );
}
