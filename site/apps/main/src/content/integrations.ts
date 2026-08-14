export type IntegrationCategory =
  | "google"
  | "files"
  | "productivity"
  | "developer"
  | "messaging";

export type IntegrationStatus = "available" | "preview" | "planned";

export type IntegrationIconName =
  | "api"
  | "brain"
  | "calendar"
  | "clipboard"
  | "discord"
  | "docs"
  | "drive"
  | "dropbox"
  | "eye"
  | "figma"
  | "file-search"
  | "folders"
  | "github"
  | "gitlab"
  | "gmail"
  | "library"
  | "linear"
  | "list-check"
  | "message-square"
  | "notion"
  | "pen-line"
  | "salesforce"
  | "sheets"
  | "shield"
  | "shuffle"
  | "slack"
  | "stripe"
  | "teams"
  | "telegram"
  | "whatsapp"
  | "zap";

export interface IntegrationCatalogItem {
  slug: string;
  name: string;
  summary: string;
  categoryLabel: string;
  categories: IntegrationCategory[];
  status: IntegrationStatus;
  icon: IntegrationIconName;
  accent: string;
  tint: string;
  href?: string;
  featured?: boolean;
  linkLabel?: string;
  summaryEmphasis?: string;
  actionAccent?: string;
  actionAccentDark?: string;
}

export const INTEGRATION_CATEGORIES: Array<{
  id: "all" | IntegrationCategory;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "google", label: "Google" },
  { id: "files", label: "Files & storage" },
  { id: "productivity", label: "Productivity" },
  { id: "developer", label: "Developer" },
  { id: "messaging", label: "Messaging" },
];

export const INTEGRATIONS: IntegrationCatalogItem[] = [
  {
    slug: "google-drive",
    name: "Google Drive",
    summary:
      "Your agent's filing cabinet. It finds files by what they are, not what you named them, keeps folders sane, and watches shared drives for changes while you sleep.",
    summaryEmphasis: "what they are",
    categoryLabel: "Google Workspace",
    categories: ["google", "files"],
    status: "available",
    icon: "drive",
    accent: "#0F9D58",
    actionAccent: "#087443",
    actionAccentDark: "#4BB582",
    tint: "#E6F4EC",
    href: "/integrations/google-drive",
    featured: true,
    linkLabel: "See what it does with Drive →",
  },
  {
    slug: "google-docs",
    name: "Google Docs",
    summary:
      "Drafts, rewrites, and summarizes docs in your voice — learned from everything you've already written. Meeting notes to brief in ninety seconds.",
    summaryEmphasis: "in your voice",
    categoryLabel: "Google Workspace",
    categories: ["google", "productivity"],
    status: "available",
    icon: "docs",
    accent: "#1A73E8",
    actionAccent: "#155CB5",
    actionAccentDark: "#5396EE",
    tint: "#E8F0FE",
    href: "/integrations/google-docs",
    featured: true,
    linkLabel: "See what it does with Docs →",
  },
  {
    slug: "google-calendar",
    name: "Google Calendar",
    summary:
      "It guards your week like a chief of staff: schedules around your focus time, preps you before every meeting, and chases the follow-ups after.",
    summaryEmphasis: "preps you before every meeting",
    categoryLabel: "Google Workspace",
    categories: ["google", "productivity"],
    status: "available",
    icon: "calendar",
    accent: "#D93025",
    actionAccent: "#B3261E",
    actionAccentDark: "#E3645C",
    tint: "#FCE8E6",
    href: "/integrations/google-calendar",
    featured: true,
    linkLabel: "See what it does with Calendar →",
  },
  {
    slug: "slack",
    name: "Slack",
    summary: "Hand your agent work in plain English from a channel or direct message.",
    categoryLabel: "Messaging",
    categories: ["messaging"],
    status: "available",
    icon: "slack",
    accent: "#7C3AED",
    tint: "#F3E8FF",
    href: "/slack",
    linkLabel: "See HyperCLI for Slack",
  },
  {
    slug: "microsoft-teams",
    name: "Microsoft Teams",
    summary: "Bring the same agent into your tenant's chats and team conversations.",
    categoryLabel: "Messaging",
    categories: ["messaging"],
    status: "available",
    icon: "teams",
    accent: "#5B5FC7",
    tint: "#ECECFF",
    href: "/teams",
    linkLabel: "See HyperCLI for Teams",
  },
  {
    slug: "telegram",
    name: "Telegram",
    summary: "Continue an agent task from your phone, wherever you happen to be.",
    categoryLabel: "Messaging",
    categories: ["messaging"],
    status: "available",
    icon: "telegram",
    accent: "#229ED9",
    tint: "#E6F6FC",
    href: "/telegram",
    linkLabel: "See HyperCLI for Telegram",
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    summary: "Reach your agent from the messaging app already used throughout your day.",
    categoryLabel: "Messaging",
    categories: ["messaging"],
    status: "available",
    icon: "whatsapp",
    accent: "#128C54",
    tint: "#E5F8EE",
    href: "/whatsapp",
    linkLabel: "See HyperCLI for WhatsApp",
  },
  {
    slug: "discord",
    name: "Discord",
    summary: "Support community operations and answer questions across servers and DMs.",
    categoryLabel: "Messaging",
    categories: ["messaging"],
    status: "available",
    icon: "discord",
    accent: "#5865F2",
    tint: "#ECEEFF",
    href: "/discord",
    linkLabel: "See HyperCLI for Discord",
  },
  {
    slug: "gmail",
    name: "Gmail",
    summary: "Triage the inbox, draft replies in context, and keep important threads moving.",
    categoryLabel: "Google",
    categories: ["google", "productivity"],
    status: "planned",
    icon: "gmail",
    accent: "#D93025",
    tint: "#FCE8E6",
  },
  {
    slug: "google-sheets",
    name: "Google Sheets",
    summary: "Keep trackers current and turn raw exports into decisions your team can use.",
    categoryLabel: "Google",
    categories: ["google", "productivity"],
    status: "planned",
    icon: "sheets",
    accent: "#0F9D58",
    tint: "#E6F4EC",
  },
  {
    slug: "dropbox",
    name: "Dropbox",
    summary: "Find, file, and summarize material across shared Dropbox folders.",
    categoryLabel: "Files & storage",
    categories: ["files"],
    status: "planned",
    icon: "dropbox",
    accent: "#0061FF",
    tint: "#E8F0FF",
  },
  {
    slug: "notion",
    name: "Notion",
    summary: "Draft specs, update wikis, and keep the knowledge base aligned with the work.",
    categoryLabel: "Productivity",
    categories: ["productivity"],
    status: "planned",
    icon: "notion",
    accent: "#475569",
    tint: "#EEF2F7",
  },
  {
    slug: "linear",
    name: "Linear",
    summary: "File issues with context, groom the backlog, and close loops after work ships.",
    categoryLabel: "Productivity",
    categories: ["productivity"],
    status: "planned",
    icon: "linear",
    accent: "#5E6AD2",
    tint: "#EEEEFF",
  },
  {
    slug: "github",
    name: "GitHub",
    summary: "Work with repositories, issues, and pull requests from the agent workspace.",
    categoryLabel: "Developer",
    categories: ["developer"],
    status: "available",
    icon: "github",
    accent: "#475569",
    tint: "#EEF2F7",
  },
  {
    slug: "gitlab",
    name: "GitLab",
    summary: "Watch pipelines, review merge requests, and prepare release notes.",
    categoryLabel: "Developer",
    categories: ["developer"],
    status: "planned",
    icon: "gitlab",
    accent: "#FC6D26",
    tint: "#FFF0E8",
  },
  {
    slug: "figma",
    name: "Figma",
    summary: "Pull design context into implementation notes and flag drift from agreed work.",
    categoryLabel: "Developer",
    categories: ["developer"],
    status: "planned",
    icon: "figma",
    accent: "#A259FF",
    tint: "#F3E8FF",
  },
  {
    slug: "stripe",
    name: "Stripe",
    summary: "Monitor revenue signals, investigate payment failures, and prepare regular briefs.",
    categoryLabel: "Productivity",
    categories: ["productivity"],
    status: "planned",
    icon: "stripe",
    accent: "#635BFF",
    tint: "#EFEEFF",
  },
  {
    slug: "salesforce",
    name: "Salesforce",
    summary: "Keep records current after customer work and surface gaps in the pipeline.",
    categoryLabel: "Productivity",
    categories: ["productivity"],
    status: "planned",
    icon: "salesforce",
    accent: "#0077A8",
    tint: "#E5F7FD",
  },
  {
    slug: "any-api",
    name: "Any API",
    summary: "Describe an API, webhook, or service and guide your agent through a custom connection.",
    categoryLabel: "Developer",
    categories: ["developer"],
    status: "available",
    icon: "api",
    accent: "#4F7CFF",
    tint: "#EEF2FF",
  },
];

export function getIntegration(slug: string) {
  return INTEGRATIONS.find((integration) => integration.slug === slug);
}
