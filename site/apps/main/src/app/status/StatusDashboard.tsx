"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  RefreshCw,
  Server,
} from "lucide-react";

type StatusLevel =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

type StatusItem = {
  id: string;
  name: string;
  status: StatusLevel;
  message?: string;
};

type PublicStatusResponse = {
  status?: StatusLevel;
  updated_at?: string;
  services?: Array<Partial<StatusItem> & { name?: string }>;
  models?: Array<Partial<StatusItem> & { name?: string }>;
};

type LoadState =
  | { phase: "loading"; data: null; error: null }
  | { phase: "ready"; data: NormalizedStatus; error: null }
  | { phase: "error"; data: NormalizedStatus; error: string };

type NormalizedStatus = {
  overall: StatusLevel;
  updatedAt: string | null;
  services: StatusItem[];
  models: StatusItem[];
};

const DEFAULT_SERVICES: StatusItem[] = [
  {
    id: "api",
    name: "API",
    status: "unknown",
    message: "Live status has not loaded.",
  },
  {
    id: "agents",
    name: "Agents",
    status: "unknown",
    message: "Live status has not loaded.",
  },
  {
    id: "billing-auth",
    name: "Billing and auth",
    status: "unknown",
    message: "Live status has not loaded.",
  },
];

const DEFAULT_MODELS: StatusItem[] = [
  {
    id: "chat-models",
    name: "Chat models",
    status: "unknown",
    message: "Live status has not loaded.",
  },
  {
    id: "embedding-models",
    name: "Embedding models",
    status: "unknown",
    message: "Live status has not loaded.",
  },
  {
    id: "voice-models",
    name: "Voice models",
    status: "unknown",
    message: "Live status has not loaded.",
  },
];

const STATUS_LABELS: Record<StatusLevel, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Maintenance",
  unknown: "Unknown",
};

const STATUS_ORDER: StatusLevel[] = [
  "major_outage",
  "partial_outage",
  "degraded",
  "maintenance",
  "unknown",
  "operational",
];

function isStatusLevel(value: unknown): value is StatusLevel {
  return (
    value === "operational" ||
    value === "degraded" ||
    value === "partial_outage" ||
    value === "major_outage" ||
    value === "maintenance" ||
    value === "unknown"
  );
}

function cleanStatus(value: unknown): StatusLevel {
  return isStatusLevel(value) ? value : "unknown";
}

function worstStatus(items: StatusItem[]): StatusLevel {
  return items.reduce<StatusLevel>((worst, item) => {
    return STATUS_ORDER.indexOf(item.status) < STATUS_ORDER.indexOf(worst)
      ? item.status
      : worst;
  }, "operational");
}

function normalizeItems(
  rawItems: PublicStatusResponse["services"],
  defaults: StatusItem[],
): StatusItem[] {
  if (!rawItems?.length) {
    return defaults;
  }

  return rawItems
    .filter((item): item is Partial<StatusItem> & { name: string } =>
      Boolean(item?.name),
    )
    .map((item, index) => ({
      id:
        item.id ||
        item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
        `item-${index}`,
      name: item.name,
      status: cleanStatus(item.status),
      message: item.message,
    }));
}

function normalizeStatus(payload: PublicStatusResponse): NormalizedStatus {
  const services = normalizeItems(payload.services, DEFAULT_SERVICES);
  const models = normalizeItems(payload.models, DEFAULT_MODELS);
  const computedOverall = worstStatus([...services, ...models]);

  return {
    overall: isStatusLevel(payload.status) ? payload.status : computedOverall,
    updatedAt: payload.updated_at || null,
    services,
    models,
  };
}

function fallbackStatus(): NormalizedStatus {
  return {
    overall: "unknown",
    updatedAt: null,
    services: DEFAULT_SERVICES,
    models: DEFAULT_MODELS,
  };
}

function statusTone(status: StatusLevel) {
  switch (status) {
    case "operational":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "degraded":
    case "maintenance":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "partial_outage":
    case "major_outage":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-border-medium bg-surface-low text-text-secondary";
  }
}

function StatusIcon({ status }: { status: StatusLevel }) {
  if (status === "operational") {
    return <CheckCircle2 className="h-5 w-5" aria-hidden="true" />;
  }
  if (status === "degraded" || status === "maintenance") {
    return <Clock3 className="h-5 w-5" aria-hidden="true" />;
  }
  if (status === "partial_outage" || status === "major_outage") {
    return <AlertTriangle className="h-5 w-5" aria-hidden="true" />;
  }
  return <CircleHelp className="h-5 w-5" aria-hidden="true" />;
}

function StatusPill({ status }: { status: StatusLevel }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${statusTone(
        status,
      )}`}
    >
      <StatusIcon status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function ItemList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: StatusItem[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-lg border border-border bg-surface-low p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-foreground">
                  {item.name}
                </h3>
                {item.message ? (
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {item.message}
                  </p>
                ) : null}
              </div>
              <StatusPill status={item.status} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function StatusDashboard() {
  const [loadState, setLoadState] = useState<LoadState>({
    phase: "loading",
    data: null,
    error: null,
  });

  const statusUrl = useMemo(() => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBaseUrl) {
      return null;
    }
    return `${apiBaseUrl.replace(/\/$/, "")}/agents/status`;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (!statusUrl) {
        setLoadState({
          phase: "error",
          data: fallbackStatus(),
          error: "Status API is not configured for this build.",
        });
        return;
      }

      try {
        const response = await fetch(statusUrl, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`Status API returned ${response.status}`);
        }

        const payload = (await response.json()) as PublicStatusResponse;
        if (!cancelled) {
          setLoadState({
            phase: "ready",
            data: normalizeStatus(payload),
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            phase: "error",
            data: fallbackStatus(),
            error:
              error instanceof Error
                ? error.message
                : "Status API request failed.",
          });
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [statusUrl]);

  const data = loadState.data ?? fallbackStatus();
  const updatedAt = data.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.updatedAt))
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-6 border-b border-border pb-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface-low px-3 py-1 text-xs font-medium text-text-secondary">
            <Server className="h-4 w-4" aria-hidden="true" />
            Public service status
          </div>
          <h1 className="text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
            HyperCLI Status
          </h1>
          <p className="mt-4 text-base leading-7 text-text-muted sm:text-lg">
            Current coarse-grained health for HyperCLI APIs, agents, and model
            access.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 md:items-end">
          <StatusPill status={data.overall} />
          <p className="text-sm text-text-muted">
            {loadState.phase === "loading"
              ? "Checking live status..."
              : updatedAt
                ? `Updated ${updatedAt}`
                : "Live update time unavailable"}
          </p>
        </div>
      </section>

      {loadState.phase === "error" ? (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">Live status could not be loaded.</p>
              <p className="mt-1 text-amber-100/80">{loadState.error}</p>
            </div>
          </div>
        </section>
      ) : null}

      <ItemList
        title="Services"
        description="Product surfaces and control-plane availability."
        items={data.services}
      />

      <ItemList
        title="Models"
        description="Overall model access health without exposing internal capacity."
        items={data.models}
      />

      <section className="flex items-center gap-2 border-t border-border pt-6 text-sm text-text-muted">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Refresh this page for the latest public status.
      </section>
    </div>
  );
}
