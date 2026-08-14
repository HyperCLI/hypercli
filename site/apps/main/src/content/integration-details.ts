import type { ChatMessage } from "@hypercli/shared-ui";
import type { IntegrationIconName } from "./integrations";

export interface IntegrationDetailCapability {
  icon: IntegrationIconName;
  title: string;
  body: string;
  emphasis?: string;
}

export interface IntegrationDetailStep {
  title: string;
  body: string;
}

export interface IntegrationDetailGuardrail {
  title: string;
  body: string;
}

export interface IntegrationDetailRelated {
  name: string;
  description: string;
  href: string;
  icon: IntegrationIconName;
  accent: string;
}

export interface IntegrationDetail {
  slug: "google-drive" | "google-docs" | "google-calendar";
  isPreview?: boolean;
  metadataTitle?: string;
  name: string;
  icon: IntegrationIconName;
  accent: string;
  tint: string;
  title: string;
  titleEmphasis?: string;
  description: string;
  previewNotice: string;
  capabilitiesTitle: string;
  capabilitiesAccent?: string;
  capabilitiesSubtitle: string;
  capabilities: IntegrationDetailCapability[];
  workflowTitle: string;
  workflowAccent?: string;
  workflowSubtitle: string;
  workflowActionLabel?: string;
  primaryActionLabel?: string;
  messages: ChatMessage[];
  messageEmphasis?: string[];
  setupTitle: string;
  setupAccent?: string;
  setupSubtitle: string;
  steps: IntegrationDetailStep[];
  guardrailsTitle: string;
  guardrails: IntegrationDetailGuardrail[];
  relatedSubtitle: string;
  related: IntegrationDetailRelated[];
  closerTitle: string;
  closerAccent?: string;
  closerDescription?: string;
  closerBrowseAction?: boolean;
  closerActionLabel?: string;
  closerFootnote?: string;
}

export const INTEGRATION_DETAILS: IntegrationDetail[] = [
  {
    slug: "google-drive",
    isPreview: false,
    metadataTitle: "Google Drive + HyperCLI — Your agent's filing cabinet",
    name: "Google Drive",
    icon: "drive",
    accent: "#0F9D58",
    tint: "#E6F4EC",
    title:
      "Your agent's filing cabinet. It finds files by what they are, not what you named them — and keeps the shared drive sane while you sleep.",
    titleEmphasis: "what they are",
    description:
      "Connect Google Drive to your HyperCLI agent. It finds files by what they are, keeps folders sane, and watches shared drives for changes.",
    previewNotice:
      "Native Google Drive availability, OAuth scopes, write controls, and setup timing are under review. This preview describes the intended experience, not a currently promised connection.",
    capabilitiesTitle: "What it does with your Drive",
    capabilitiesAccent: "with your Drive",
    capabilitiesSubtitle: "Not search. An actual filing clerk with perfect recall.",
    capabilities: [
      {
        icon: "brain",
        title: "Finds by meaning",
        body: '"The deck Sarah made for the Berlin pitch" — found. It\'s called final_v3_REAL.pptx and it\'s in a folder named "misc." Your agent doesn\'t care. It reads what\'s inside.',
        emphasis: "final_v3_REAL.pptx",
      },
      {
        icon: "folders",
        title: "Files like a person would",
        body: "Consistent names, duplicates flagged, shared drives organized to the structure you already meant to keep. It proposes the re-org first — you approve, it executes.",
        emphasis: "you approve, it executes.",
      },
      {
        icon: "eye",
        title: "Watches folders for you",
        body: 'New file lands in "Contracts"? Summarized overnight, key terms flagged, expiry dates on your calendar. You read the brief, not the PDF.',
        emphasis: "You read the brief, not the PDF.",
      },
      {
        icon: "file-search",
        title: "Summarizes the pile",
        body: '"What changed in the Q3 folder this week?" One paragraph, every change linked. Works across 4 files or 4,000 — the flat rate doesn\'t care either.',
        emphasis: "the flat rate doesn't care either.",
      },
    ],
    workflowTitle: "A Tuesday morning, with Drive connected",
    workflowAccent: "with Drive connected",
    workflowSubtitle: "The kind of thing you'll stop thinking about.",
    workflowActionLabel: "See it in a workflow",
    primaryActionLabel: "Connect Google Drive",
    messages: [
      {
        from: "user",
        author: "Jamie",
        time: "8:47 AM",
        text: "find the berlin pitch deck and update the pricing slide to the march rates",
      },
      {
        from: "agent",
        author: "Aria",
        time: "8:48 AM",
        text: "Found it — final_v3_REAL.pptx in Sales/Pitches/misc. Pricing slide updated to the March rates; I logged every change in the slide comments so you can sanity-check. Want the PDF version for the client too?",
      },
      {
        from: "user",
        author: "Jamie",
        time: "8:49 AM",
        text: "yes. and anything new in Contracts i should know about?",
      },
      {
        from: "agent",
        author: "Aria",
        time: "8:49 AM",
        text: "PDF's in the same folder. Contracts: two new MSAs overnight — one standard, one with an unusual liability cap in section 8. Summary of the cap attached, flagged for counsel. 📎 berlin-pitch-v4.pdf · msa-summary.pdf",
      },
    ],
    messageEmphasis: ["", "final_v3_REAL.pptx", "", "two new MSAs overnight"],
    setupTitle: "Connected in three steps",
    setupAccent: "three steps",
    setupSubtitle: "No IT ticket. No admin console safari.",
    steps: [
      {
        title: "Connect with Google",
        body: "Standard OAuth — you approve the scopes, we're in. About twenty seconds, most of it reading Google's consent screen.",
      },
      {
        title: "Pick what it can see",
        body: "Whole Drive, specific shared drives, or just the folders you choose. Read-only by default; write access is a per-folder opt-in.",
      },
      {
        title: "Tell it what to do",
        body: 'Plain English: "watch Contracts and brief me every morning." It writes itself a skill and runs it from then on.',
      },
    ],
    guardrailsTitle: "Initiative has rules here.",
    guardrails: [
      {
        title: "Read-only by default.",
        body: "Write access is opt-in, per folder, revocable per folder.",
      },
      {
        title: "It never deletes or moves anything without your yes.",
        body: "Proposals first, execution after approval.",
      },
      {
        title: "Every action in the audit log.",
        body: "What it read, what it changed, when, and why it said it did.",
      },
      {
        title: "Revoke anytime",
        body: "— from HyperCLI or straight from your Google account. The agent forgets it ever had access.",
      },
    ],
    relatedSubtitle: "Same agent, same memory — context flows between all three.",
    related: [
      {
        name: "Google Docs",
        description: "Files it finds become drafts it writes.",
        href: "/integrations/google-docs",
        icon: "docs",
        accent: "#1A73E8",
      },
      {
        name: "Google Calendar",
        description: "Meeting prep lands in Drive before the invite starts.",
        href: "/integrations/google-calendar",
        icon: "calendar",
        accent: "#D93025",
      },
      {
        name: "Slack",
        description: '"Found it" messages, straight into the thread.',
        href: "/slack",
        icon: "slack",
        accent: "#611F69",
      },
    ],
    closerTitle: "Your Drive has good stuff in it.",
    closerAccent: "Let something finally read it.",
    closerBrowseAction: false,
    closerActionLabel: "Connect Google Drive",
    closerFootnote: "7-day free trial · Ships on every plan · Read-only by default",
  },
  {
    slug: "google-docs",
    isPreview: false,
    metadataTitle: "Google Docs + HyperCLI — It writes in your voice",
    name: "Google Docs",
    icon: "docs",
    accent: "#1A73E8",
    tint: "#E8F0FE",
    title:
      "It drafts, rewrites, and summarizes in your voice — because it learned your voice from everything you've already written.",
    titleEmphasis: "in your voice",
    description:
      "Connect Google Docs to your HyperCLI agent. Drafts, rewrites, and summaries in your voice — learned from everything you've already written.",
    previewNotice:
      "Native Google Docs availability, OAuth scopes, editing modes, and setup timing are under review. This preview describes the intended experience, not a currently promised connection.",
    capabilitiesTitle: "What it does with your Docs",
    capabilitiesAccent: "with your Docs",
    capabilitiesSubtitle: "Not autocomplete. A ghostwriter who studied under you.",
    capabilities: [
      {
        icon: "pen-line",
        title: "Drafts from bullets",
        body: "Drop five rough bullets at midnight; wake up to a full doc in your tone, your structure, your favorite transitions. You edit, it doesn't take offense.",
        emphasis: "You edit, it doesn't take offense.",
      },
      {
        icon: "message-square",
        title: "Rewrites without the red pen",
        body: "Edits arrive as suggestions and comments — never silent changes to a published doc. Accept all, accept some, or tell it why it's wrong and watch it learn.",
        emphasis: "watch it learn.",
      },
      {
        icon: "zap",
        title: "Meetings to briefs in 90 seconds",
        body: "Raw notes, a transcript, a voice memo — becomes the one-pager with decisions, owners, and deadlines pulled out. In your usual format.",
        emphasis: "In your usual format.",
      },
      {
        icon: "library",
        title: "Reads the whole pile",
        body: '"What did we decide about pricing back in March, and why?" Answered from your own docs, with the paragraph linked. Your docs become a memory, not an attic.',
        emphasis: "Your docs become a memory, not an attic.",
      },
    ],
    workflowTitle: "A Wednesday night, with Docs connected",
    workflowAccent: "with Docs connected",
    workflowSubtitle: "The one-pager writes itself. You just make it yours.",
    workflowActionLabel: "See it in a workflow",
    primaryActionLabel: "Connect Google Docs",
    messages: [
      {
        from: "user",
        author: "Jamie",
        time: "10:31 PM",
        text: "turn today's investor call notes into the update one-pager. usual format, send-ready by morning",
      },
      {
        from: "agent",
        author: "Aria",
        time: "10:33 PM",
        text: "Drafted in Investor updates / June — three sections, your usual format, metrics table pulled from the tracker. Two claims I couldn't source are flagged in comments with question marks. I'll have the polished pass ready by 7.",
      },
      {
        from: "agent",
        author: "Aria",
        time: "7:00 AM",
        text: "Ready. Tightened the intro, moved the churn caveat up (you always move it up). Two comments still need your call — everything else is suggestion-mode for your pass. 📎 june-investor-update.gdoc",
      },
    ],
    messageEmphasis: ["", "Investor updates / June", "Ready."],
    setupTitle: "Connected in three steps",
    setupAccent: "three steps",
    setupSubtitle: "No style guide upload. It reads, it learns.",
    steps: [
      {
        title: "Connect with Google",
        body: "Standard OAuth — you approve the scopes, we're in. About twenty seconds, most of it reading Google's consent screen.",
      },
      {
        title: "Point it at your voice",
        body: "Pick the docs it should learn from — past updates, briefs, posts. The more it reads, the more the drafts sound like you and less like an AI.",
      },
      {
        title: "Set the ground rules",
        body: "Suggestion-mode only, comment-first, or trusted-doc free rein — per folder. It drafts where you say, how you say.",
      },
    ],
    guardrailsTitle: "Your name goes on it. Rules apply.",
    guardrails: [
      {
        title: "Suggestions, not silent edits.",
        body: "Nothing changes in a doc you share without a visible trail.",
      },
      {
        title: "Unsourced claims get flagged",
        body: "in comments — it tells you what it doesn't know.",
      },
      {
        title: "Every draft and edit in the audit log.",
        body: "What it wrote, where, and what you accepted.",
      },
      {
        title: "Revoke anytime",
        body: "— from HyperCLI or straight from your Google account.",
      },
    ],
    relatedSubtitle: "Same agent, same memory — context flows between all three.",
    related: [
      {
        name: "Google Drive",
        description: "Source material, found by meaning, cited in the draft.",
        href: "/integrations/google-drive",
        icon: "drive",
        accent: "#0F9D58",
      },
      {
        name: "Google Calendar",
        description: "Meeting at 10, prep doc in the invite by 9:45.",
        href: "/integrations/google-calendar",
        icon: "calendar",
        accent: "#D93025",
      },
      {
        name: "Slack",
        description: '"Draft\'s ready for your pass" — where you\'ll actually see it.',
        href: "/slack",
        icon: "slack",
        accent: "#611F69",
      },
    ],
    closerTitle: "Blank page, meet unfair advantage.",
    closerAccent: "Connect your Docs.",
    closerBrowseAction: false,
    closerActionLabel: "Connect Google Docs",
    closerFootnote: "7-day free trial · Ships on every plan · Suggestion-mode by default",
  },
  {
    slug: "google-calendar",
    isPreview: false,
    metadataTitle: "Google Calendar + HyperCLI — A chief of staff for your week",
    name: "Google Calendar",
    icon: "calendar",
    accent: "#D93025",
    tint: "#FCE8E6",
    title:
      "A chief of staff for your week. It guards your focus time, preps you before every meeting, and chases the follow-ups after.",
    titleEmphasis: "preps you before every meeting",
    description:
      "Connect Google Calendar to your HyperCLI agent. It schedules around your focus time, preps you before every meeting, and chases the follow-ups after.",
    previewNotice:
      "Native Google Calendar availability, OAuth scopes, scheduling authority, and setup timing are under review. This preview describes the intended experience, not a currently promised connection.",
    capabilitiesTitle: "What it does with your Calendar",
    capabilitiesAccent: "with your Calendar",
    capabilitiesSubtitle: "Not a booking link. Judgment about your time.",
    capabilities: [
      {
        icon: "shield",
        title: "Schedules like it knows you",
        body: "Focus blocks stay sacred. Meetings get batched. Your no-meeting Fridays stay no-meeting Fridays — it defends the week you meant to have.",
        emphasis: "it defends the week you meant to have.",
      },
      {
        icon: "clipboard",
        title: "Preps you before every meeting",
        body: "Fifteen minutes before: who's in the room, the last thread, what you promised them, and the one decision this meeting needs. You walk in already caught up.",
        emphasis: "You walk in already caught up.",
      },
      {
        icon: "shuffle",
        title: "Handles the back-and-forth",
        body: "Proposes slots, negotiates times with external guests, absorbs the reschedules. External emails always get your yes first — then you never think about them again.",
        emphasis: "then you never think about them again.",
      },
      {
        icon: "list-check",
        title: "Chases the follow-ups",
        body: "Action items from every meeting, extracted, assigned, and nagged — including yours. Thursday's “I'll send that over” actually gets sent over.",
        emphasis: "actually gets sent over.",
      },
    ],
    workflowTitle: "A Thursday, with Calendar connected",
    workflowAccent: "with Calendar connected",
    workflowSubtitle: "You asked once, in a DM, walking to coffee.",
    workflowActionLabel: "See it in a workflow",
    primaryActionLabel: "Connect Google Calendar",
    messages: [
      {
        from: "user",
        author: "Jamie",
        time: "9:02 AM",
        text: "clear my thursday afternoon, i need deep work on the launch",
      },
      {
        from: "agent",
        author: "Aria",
        time: "9:02 AM",
        text: "Done. Moved your 1:1 with Priya to Friday (she's free, note sent), declined the vendor call with two new slots for next week, and blocked 1–5 PM as Focus — launch. Prep for tomorrow's 10 AM board call is in your Drive whenever you want it.",
      },
      {
        from: "agent",
        author: "Aria",
        time: "6:15 PM",
        text: "Follow-up roundup: you owed Andre the pricing one-pager after Tuesday — sent at 4:40 with your sign-off. Three action items from this week's meetings are still open; two are theirs, one is yours, due Monday. Enjoy the evening.",
      },
    ],
    messageEmphasis: ["", "Done.", "sent at 4:40"],
    setupTitle: "Connected in three steps",
    setupAccent: "three steps",
    setupSubtitle: "Your calendar, your rules — it just enforces them.",
    steps: [
      {
        title: "Connect with Google",
        body: "Standard OAuth — you approve the scopes, we're in. About twenty seconds, most of it reading Google's consent screen.",
      },
      {
        title: "Set your rules once",
        body: "Focus hours, meeting-free days, how much notice you need, who can book over what. Ten answers, one time — it enforces them forever.",
      },
      {
        title: "Choose its manners",
        body: "Internal meetings it can move on its own. Anything external gets drafted for your approval first. You set where the line is.",
      },
    ],
    guardrailsTitle: "Your week, your rules. It just enforces them.",
    guardrails: [
      {
        title: "Internal moves within your rules happen automatically.",
        body: "Anything outside them gets asked first.",
      },
      {
        title: "External emails are always approved by you",
        body: "— drafted, queued, sent on your yes.",
      },
      {
        title: "Every move in the audit log.",
        body: "What changed, who was told, and why.",
      },
      {
        title: "Revoke anytime",
        body: "— from HyperCLI or straight from your Google account.",
      },
    ],
    relatedSubtitle: "Same agent, same memory — context flows between all three.",
    related: [
      {
        name: "Google Drive",
        description: "Prep docs pulled from the pile, attached to the invite.",
        href: "/integrations/google-drive",
        icon: "drive",
        accent: "#0F9D58",
      },
      {
        name: "Google Docs",
        description: "Meeting notes become the brief before you're back at your desk.",
        href: "/integrations/google-docs",
        icon: "docs",
        accent: "#1A73E8",
      },
      {
        name: "Slack",
        description: '"Your 2 PM moved" — where you\'ll actually see it.',
        href: "/slack",
        icon: "slack",
        accent: "#611F69",
      },
    ],
    closerTitle: "Your calendar is a promise.",
    closerAccent: "Give it a bodyguard.",
    closerBrowseAction: false,
    closerActionLabel: "Connect Google Calendar",
    closerFootnote: "7-day free trial · Ships on every plan · External emails always need your yes",
  },
];

export function getIntegrationDetail(slug: string) {
  return INTEGRATION_DETAILS.find((integration) => integration.slug === slug);
}
