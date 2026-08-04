import type { Metadata } from "next";
import { ChannelPage, type ChannelPageData } from "@/components/channel-page";

export const metadata: Metadata = {
  title: "HyperCLI for Slack — Your agents, where you work",
  description:
    "Not another tab. Your agent lives in Slack — in channels, in DMs, in threads — doing real work where the conversation already is.",
};

const DATA: ChannelPageData = {
  label: "Slack",
  eyebrow: "HyperCLI for Slack",
  heroSub:
    "Not another tab. Your agent lives in Slack — in channels, in DMs, in threads — doing real work where the conversation already is.",
  ctaLabel: "Add to Slack",
  notes: ["Two clicks", "No IT ticket", "Only sees channels you invite it to"],
  behaviorsTitle: (
    <>
      It knows how <span className="text-primary">Slack works.</span>
    </>
  ),
  behaviorsSub: "A good teammate has channel manners. So does your agent.",
  behaviors: [
    {
      tag: "@agent",
      title: "Mention it in any channel",
      body: "Tag it mid-conversation and it picks up the thread's full context — no re-explaining what everyone just said.",
    },
    {
      tag: "DM",
      title: "Or keep it one-on-one",
      body: "Direct message for personal delegation — your drafts, your research, your follow-ups.",
    },
    {
      tag: "threads",
      title: "It works in threads",
      body: "Long tasks stay in their thread — progress updates and the final delivery, without flooding the channel.",
    },
    {
      tag: "proactive",
      title: "It speaks first",
      body: "When something it's watching changes — a competitor, a metric, a deadline — it posts. You don't have to ask twice.",
    },
  ],
  demoTitle: (
    <>
      What it looks like in <span className="text-primary">#marketing.</span>
    </>
  ),
  demoChannel: "Slack",
  demoAgentName: "Aria",
  messages: [
    {
      from: "user",
      author: "Priya",
      time: "2:14 PM",
      text: "@agent we're launching thursday — can you draft the announcement thread and make 3 image options?",
    },
    {
      from: "agent",
      author: "Aria",
      time: "2:14 PM",
      text: "On it — I'll use the positioning from Monday's doc. Drafts in this thread within the hour.",
    },
    {
      from: "agent",
      author: "Aria",
      time: "3:02 PM",
      text: "Done — thread draft (2 versions) + 3 images. Also: your competitor teased something for Wednesday. Want me to prep a response angle just in case?",
    },
  ],
  permsTitle: (
    <>
      It only sees what <span className="text-primary">you invite it to.</span>
    </>
  ),
  permsSub: "Most AI apps are vague about permissions. Here's exactly how yours behaves:",
  perms: [
    {
      title: "Invited channels only.",
      body: "No access to channels it hasn't been added to — ever. Remove it from a channel and it forgets the room exists.",
    },
    {
      title: "Minimal scopes, listed openly.",
      body: "Every permission it requests is documented, with why. No wildcard access.",
    },
    {
      title: "Your data isn't training data.",
      body: "Conversations stay between you, your team, and your agent.",
    },
    {
      title: "Admin-friendly plumbing.",
      body: "Socket mode, relay, or HTTP — your workspace admin picks the connection model. Uninstall removes everything.",
    },
  ],
  setupTitle: (
    <>
      Live in your workspace in <span className="text-primary">two minutes.</span>
    </>
  ),
  steps: [
    { title: "Add to Slack.", body: "Standard OAuth install — approve the scopes, done." },
    {
      title: "Invite it to a channel.",
      body: (
        <>
          <code className="rounded bg-surface-low px-1.5 py-0.5 font-mono text-xs">/invite @agent</code> — start with
          one channel, add more when it earns them.
        </>
      ),
    },
    {
      title: "Hand it something real.",
      body: "@mention it with a task you'd give a new hire. Check the thread in an hour.",
    },
  ],
  faqTitle: (
    <>
      Workspace admin <span className="text-primary">questions.</span>
    </>
  ),
  faq: [
    {
      q: "What can it read?",
      a: "Messages in channels it's been invited to, DMs sent to it, and files shared with it directly. Nothing else — no workspace-wide history, no private channels it isn't in.",
    },
    {
      q: "Where does the work happen?",
      a: "On the agent's own cloud machine, not inside Slack. Slack is the conversation; the browsing, documents, and media generation happen on its machine and get delivered back to the thread.",
    },
    {
      q: "How do we remove it?",
      a: "Remove it from a channel like any member, or uninstall the app to disconnect it from the workspace entirely. Uninstalling revokes all access immediately.",
    },
  ],
  closerTitle: "Already in Slack all day? So is your agent.",
  closerSub: "Add it, invite it to one channel, and hand it something real.",
  alsoAvailable: [
    { label: "Teams", href: "/teams" },
    { label: "Telegram", href: "/telegram" },
    { label: "WhatsApp", href: "/whatsapp" },
    { label: "Discord", href: "/discord" },
    { label: "buzz", href: "/buzz" },
  ],
};

export default function SlackPage() {
  return <ChannelPage data={DATA} />;
}
