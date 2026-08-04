import type { Metadata } from "next";
import { ChannelPage, type ChannelPageData } from "@/components/channel-page";

// CONFIRM: Microsoft Teams support is not yet in the capability file. Verify before publishing.

export const metadata: Metadata = {
  title: "HyperCLI for Teams — Your agents, where you work",
  description:
    "Not another tab. Your agent lives in Microsoft Teams — in channels, in chats, in threads — doing real work where your company already talks.",
};

const DATA: ChannelPageData = {
  label: "Teams",
  eyebrow: "HyperCLI for Teams",
  heroSub:
    "Not another tab. Your agent lives in Microsoft Teams — in channels, in chats, in threads — doing real work where your company already talks.",
  ctaLabel: "Add to Teams",
  notes: ["From the Teams store", "Governed by your M365 admin", "Only sees teams you add it to"],
  behaviorsTitle: (
    <>
      It knows how <span className="text-primary">Teams works.</span>
    </>
  ),
  behaviorsSub: "A good teammate follows the org chart's etiquette. So does your agent.",
  behaviors: [
    {
      tag: "@agent",
      title: "Mention it in any channel",
      body: "Tag it mid-conversation and it picks up the full thread context — no re-explaining the meeting everyone just left.",
    },
    {
      tag: "chat",
      title: "Or keep it one-on-one",
      body: "A private chat for personal delegation — drafts, research, prep for your next call.",
    },
    {
      tag: "threads",
      title: "Replies stay threaded",
      body: "Long tasks live in their reply chain — progress and delivery without flooding the channel.",
    },
    {
      tag: "proactive",
      title: "It speaks first",
      body: "When something it's watching changes — a metric, a deadline, a document — it posts before anyone asks.",
    },
  ],
  demoTitle: (
    <>
      What it looks like in <span className="text-primary">the Ops team.</span>
    </>
  ),
  demoChannel: "Teams",
  demoAgentName: "Aria",
  messages: [
    {
      from: "user",
      author: "Dana",
      time: "11:04 AM",
      text: "@agent reconcile this month's vendor invoices against the PO list — flag anything that doesn't match",
    },
    {
      from: "agent",
      author: "Aria",
      time: "11:04 AM",
      text: "On it — pulling both from the shared drive. Report in this thread by 3pm.",
    },
    {
      from: "agent",
      author: "Aria",
      time: "2:31 PM",
      text: "Done — 42 matched, 3 mismatches flagged with detail. Also: two invoices reference a vendor that isn't in the PO system. Want me to chase that down?",
    },
  ],
  permsTitle: (
    <>
      It only sees what <span className="text-primary">you add it to.</span>
    </>
  ),
  permsSub: "Built to pass your IT review, not dodge it:",
  perms: [
    {
      title: "Added teams only.",
      body: "No access to teams or channels it hasn't been added to. Remove it and access ends immediately.",
    },
    {
      title: "Governed centrally.",
      body: "Deployed through the Microsoft 365 admin center — app permission policies decide who can use it and where.",
    },
    {
      title: "Your data isn't training data.",
      body: "Conversations stay between your org and your agent.",
    },
    {
      title: "Clean uninstall.",
      body: "Removing the app revokes all access. The audit trail of what it did stays in your logs.",
    },
  ],
  setupTitle: (
    <>
      Live in your tenant in <span className="text-primary">minutes.</span>
    </>
  ),
  steps: [
    {
      title: "Add from the Teams store.",
      body: "Or push it through your org's app catalog — standard admin flow, no custom infrastructure.",
    },
    { title: "Add it to a team.", body: "Start with one team, expand when it earns more." },
    {
      title: "Hand it something real.",
      body: "@mention it with a task you'd give a new hire. Check the thread after lunch.",
    },
  ],
  faqTitle: (
    <>
      IT admin <span className="text-primary">questions.</span>
    </>
  ),
  faq: [
    {
      q: "What can it read?",
      a: "Messages in channels of teams it's been added to, chats sent directly to it, and files shared with it. No tenant-wide access, no private channels it isn't in.",
    },
    {
      q: "Where does the work happen?",
      a: "On the agent's own cloud machine, not inside Teams. Teams is the conversation; the work happens on its machine and is delivered back to the thread.",
    },
    {
      q: "How do we control rollout?",
      a: "App permission policies in the M365 admin center — scope it to a pilot group first, expand by policy. Uninstalling revokes everything.",
    },
  ],
  closerTitle: "Your org already lives in Teams. Now its agent does too.",
  closerSub: "Add it to one team, hand it something real, and see what comes back.",
  alsoAvailable: [
    { label: "Slack", href: "/slack" },
    { label: "Telegram", href: "/telegram" },
    { label: "WhatsApp", href: "/whatsapp" },
    { label: "Discord", href: "/discord" },
    { label: "buzz", href: "/buzz" },
  ],
};

export default function TeamsPage() {
  return <ChannelPage data={DATA} />;
}
