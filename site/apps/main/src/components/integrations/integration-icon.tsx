import type { LucideIcon } from "lucide-react";
import {
  Box,
  Braces,
  Brain,
  CalendarDays,
  ClipboardList,
  Cloud,
  CreditCard,
  FileSearch,
  FileText,
  Folders,
  GitBranch,
  Github,
  HardDrive,
  Hash,
  Library,
  ListChecks,
  ListTodo,
  Mail,
  MessageCircle,
  MessageSquare,
  NotebookText,
  PenLine,
  PenTool,
  Send,
  ShieldCheck,
  Shuffle,
  Slack,
  Table2,
  Users,
  Zap,
  Eye,
} from "lucide-react";
import type { IntegrationIconName } from "@/content/integrations";

const INTEGRATION_ICONS: Record<IntegrationIconName, LucideIcon> = {
  api: Braces,
  brain: Brain,
  calendar: CalendarDays,
  clipboard: ClipboardList,
  discord: Hash,
  docs: FileText,
  drive: HardDrive,
  dropbox: Box,
  eye: Eye,
  figma: PenTool,
  "file-search": FileSearch,
  folders: Folders,
  github: Github,
  gitlab: GitBranch,
  gmail: Mail,
  library: Library,
  linear: ListTodo,
  "list-check": ListChecks,
  "message-square": MessageSquare,
  notion: NotebookText,
  "pen-line": PenLine,
  salesforce: Cloud,
  sheets: Table2,
  shield: ShieldCheck,
  shuffle: Shuffle,
  slack: Slack,
  stripe: CreditCard,
  teams: Users,
  telegram: Send,
  whatsapp: MessageCircle,
  zap: Zap,
};

export interface IntegrationIconProps {
  name: IntegrationIconName;
  className?: string;
  decorative?: boolean;
}

export function IntegrationIcon({ name, className, decorative = true }: IntegrationIconProps) {
  if (name === "drive") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={decorative ? "true" : undefined}
      >
        <path d="M12 10 6 20l-3-5L9 5l3 5" />
        <path d="M9 15h12l-3 5H6" />
        <path d="M15 15 9 5h6l6 10h-6" />
      </svg>
    );
  }

  const Icon = INTEGRATION_ICONS[name];
  return <Icon className={className} aria-hidden={decorative ? "true" : undefined} />;
}
