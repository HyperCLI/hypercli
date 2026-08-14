"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { NAV_URLS, cn } from "@hypercli/shared-ui";
import { ArrowRight } from "lucide-react";
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCatalogItem,
  type IntegrationCategory,
} from "@/content/integrations";
import { IntegrationIcon } from "./integration-icon";

type IntegrationFilter = "all" | IntegrationCategory;

const STATUS_LABELS = {
  available: "Available now",
  preview: "Preview",
  planned: "Coming soon",
} as const;

const STATUS_CLASSES = {
  available: "border-success/25 bg-[#E4FAF2] text-[#1F2937] dark:bg-[#17352F] dark:text-[#E8EDF4]",
  preview: "border-primary/25 bg-[#EEF2FF] text-[#1F2937] dark:bg-[#1E2B4F] dark:text-[#E8EDF4]",
  planned: "border-border-medium bg-[#F7F9FC] text-[#1F2937] dark:bg-[#1A2230] dark:text-[#E8EDF4]",
} as const;

function IntegrationStatus({
  status,
  className,
}: Pick<IntegrationCatalogItem, "status"> & { className?: string }) {
  return (
    <span
      data-slot="integration-status"
      className={cn(
        "inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em]",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function cardHref(integration: IntegrationCatalogItem) {
  if (integration.href) return integration.href;
  if (integration.status === "available") return NAV_URLS.agents;
  return null;
}

function FeaturedIntegrationCard({ integration }: { integration: IntegrationCatalogItem }) {
  const href = cardHref(integration);
  const summaryParts = integration.summaryEmphasis
    ? integration.summary.split(integration.summaryEmphasis)
    : null;
  const content = (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ backgroundColor: integration.accent }}
      />
      <IntegrationStatus status={integration.status} className="absolute right-5 top-[18px]" />
      <span
        className="flex h-14 w-14 items-center justify-center rounded-[17px]"
        style={{ backgroundColor: integration.tint, color: integration.accent }}
      >
        <IntegrationIcon name={integration.icon} className="h-7 w-7" />
      </span>
      <div className="mt-[18px] flex flex-1 flex-col">
        <h3 className="text-[22px] font-bold tracking-[-0.02em] text-foreground">{integration.name}</h3>
        <p className="mt-2 flex-1 text-[14.5px] leading-relaxed text-text-secondary">
          {summaryParts && integration.summaryEmphasis ? (
            <>
              {summaryParts[0]}
              <strong className="font-semibold text-foreground">{integration.summaryEmphasis}</strong>
              {summaryParts[1]}
            </>
          ) : (
            integration.summary
          )}
        </p>
        {href ? (
          <span
            data-slot="integration-card-action"
            className="integration-featured-action mt-5 inline-flex items-center text-[15px] font-semibold"
            style={
              {
                "--integration-action-accent": integration.actionAccent ?? integration.accent,
                "--integration-action-accent-dark": integration.actionAccentDark ?? integration.accent,
              } as CSSProperties
            }
          >
            {integration.linkLabel ?? `Launch an agent for ${integration.name}`}
          </span>
        ) : null}
      </div>
    </>
  );

  const className =
    "group relative flex flex-col overflow-hidden rounded-[26px] border border-border bg-surface px-[30px] pb-7 pt-8 shadow-[var(--elevation-shadow-soft)] transition-[transform,box-shadow,border-color] hover:-translate-y-1 hover:border-border-strong hover:shadow-[var(--elevation-shadow-medium)]";

  if (href) {
    return (
      <Link
        href={href}
        data-integration={integration.slug}
        className={className}
        aria-label={integration.linkLabel ?? integration.name}
      >
        {content}
      </Link>
    );
  }

  return <article data-integration={integration.slug} className={className}>{content}</article>;
}

function IntegrationCard({ integration }: { integration: IntegrationCatalogItem }) {
  const href = cardHref(integration);
  const content = (
    <>
      <div className="flex items-start gap-3.5">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: integration.tint, color: integration.accent }}
        >
          <IntegrationIcon name={integration.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight text-foreground">{integration.name}</h3>
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
            {integration.categoryLabel}
          </p>
        </div>
      </div>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-text-secondary">{integration.summary}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <IntegrationStatus status={integration.status} />
        {href ? (
          <ArrowRight
            className="h-4 w-4 text-text-muted transition-all group-hover:translate-x-1 group-hover:text-primary"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </>
  );

  const className =
    "group flex min-h-[238px] flex-col rounded-[20px] border border-border bg-surface p-5 shadow-[var(--elevation-shadow-soft)] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--elevation-shadow-medium)]";

  if (href) {
    return (
      <Link
        href={href}
        data-integration={integration.slug}
        className={className}
        aria-label={integration.linkLabel ?? `${integration.name}, ${STATUS_LABELS[integration.status]}`}
      >
        {content}
      </Link>
    );
  }

  return <article data-integration={integration.slug} className={className}>{content}</article>;
}

export function IntegrationCatalog({ integrations }: { integrations: IntegrationCatalogItem[] }) {
  const [filter, setFilter] = useState<IntegrationFilter>("all");
  const visible =
    filter === "all"
      ? integrations
      : integrations.filter((integration) => integration.categories.includes(filter));
  const featured = visible.filter((integration) => integration.featured);
  const remaining = visible.filter((integration) => !integration.featured);

  return (
    <div>
      <div
        role="group"
        aria-label="Filter integrations"
        className="flex max-w-full flex-wrap justify-center gap-[9px]"
      >
        {INTEGRATION_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={filter === category.id}
            onClick={() => setFilter(category.id)}
            className={cn(
              "rounded-full border px-[19px] py-[9px] text-sm font-semibold transition-colors",
              filter === category.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border-medium bg-surface text-text-secondary hover:border-primary hover:text-primary",
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        Showing {visible.length} {visible.length === 1 ? "integration" : "integrations"}
      </p>

      {featured.length > 0 ? (
        <section className="mt-[81px]" aria-labelledby="featured-integrations-heading">
          <h2
            id="featured-integrations-heading"
            className="mb-[13px] text-xs font-bold uppercase tracking-[0.1em] text-text-muted"
          >
            Featured — Google Workspace
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-stretch gap-5">
            {featured.map((integration) => (
              <FeaturedIntegrationCard key={integration.slug} integration={integration} />
            ))}
          </div>
        </section>
      ) : null}

      {remaining.length > 0 ? (
        <section
          className={featured.length > 0 ? "mt-14" : "mt-[74px]"}
          aria-labelledby="integration-directory-heading"
        >
          <h2
            id="integration-directory-heading"
            className="mb-4 text-xs font-bold uppercase tracking-[0.1em] text-text-muted"
          >
            {featured.length > 0 ? "Everything else" : "Integration directory"}
          </h2>
          <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {remaining.map((integration) => (
              <IntegrationCard key={integration.slug} integration={integration} />
            ))}
          </div>
        </section>
      ) : null}

      {visible.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-border bg-surface-low px-6 py-12 text-center">
          <h2 className="text-lg font-bold text-foreground">No integrations in this category yet.</h2>
          <p className="mt-2 text-sm text-text-secondary">Choose another category to keep browsing.</p>
        </div>
      ) : null}
    </div>
  );
}
