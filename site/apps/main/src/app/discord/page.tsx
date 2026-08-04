import type { Metadata } from "next";
import { ChannelPage, type ChannelPageData } from "@/components/channel-page";

// CONFIRM: Discord support is not yet in the capability file. Verify before publishing.

export const metadata: Metadata = {
  title: "HyperCLI for Discord — Your agents, where you work",
  description:
    "A member of the server that never sleeps — answering, organizing, and shipping in the channels your community already lives in.",
};

const DATA: ChannelPageData = {
  label: "Discord",
  eyebrow: "HyperCLI for Discord",
  heroSub:
    "A member of the server that never sleeps — answering, organizing, and shipping in the channels your community already lives in.",
  ctaLabel: "Add to Discord",
  notes: ["Standard OAuth install", "Role-scoped permissions", "Only channels you allow"],
  behaviorsTitle: (
    <>
      It knows how <span className="text-primary">servers work.</span>
    </>
  ),
  behaviorsSub: "Communities have culture. Your agent respects it.",
  behaviors: [
    {
      tag: "@agent",
      title: "Answers in channel",
      body: "Mention it and it answers from your server's docs, pins, and history — not generic internet guesses.",
    },
    {
      tag: "DM",
      title: "Takes DMs",
      body: "Members can go one-on-one for longer help without clogging #general.",
    },
    {
      tag: "digest",
      title: "Posts on schedule",
      body: "Weekly digests, event reminders, changelog posts — the drumbeat that keeps a server alive.",
    },
    {
      tag: "watching",
      title: "Flags what matters",
      body: "Unanswered questions, mod-worthy moments, trending threads — surfaced to the people who need to see them.",
    },
  ],
  demoTitle: (
    <>
      <span className="text-primary">#help,</span> handled.
    </>
  ),
  demoChannel: "Discord",
  demoAgentName: "Aria",
  messages: [
    {
      from: "user",
      author: "member_042",
      time: "4:15 PM",
      text: "@agent how do I set up the webhook integration?",
    },
    {
      from: "agent",
      author: "Aria",
      time: "4:15 PM",
      text: "For your setup: create the endpoint in settings, paste the URL from your dashboard, send the test event. Full walkthrough's pinned in #docs — I updated it last week when the API changed.",
    },
    {
      from: "user",
      author: "mod_kara",
      time: "6:00 PM",
      text: "@agent weekly digest when you're ready",
    },
    {
      from: "agent",
      author: "Aria",
      time: "6:01 PM",
      text: "Posted to #announcements — 214 new members, the plugin contest was the top thread, and 3 unanswered questions just moved to #help.",
    },
  ],
  permsTitle: (
    <>
      Scoped like <span className="text-primary">any member.</span>
    </>
  ),
  permsSub: "It has a role, and the role is the boundary:",
  perms: [
    {
      title: "Role-scoped sight.",
      body: "It sees only the channels its role allows — configure it exactly like you'd configure a moderator.",
    },
    {
      title: "Server-scoped memory.",
      body: "What it learns in your server stays in your server — no cross-server bleed.",
    },
    {
      title: "Suggests, doesn't swing.",
      body: "Mod-adjacent actions are flagged to humans; it reports, your mods decide.",
    },
    {
      title: "Kick = revoke.",
      body: "Remove it like any member, or revoke the OAuth grant. Either ends everything.",
    },
  ],
  setupTitle: (
    <>
      In the server <span className="text-primary">tonight.</span>
    </>
  ),
  steps: [
    {
      title: "Add via OAuth.",
      body: "Pick the server, approve the scopes — the same flow as every bot your mods have vetted.",
    },
    {
      title: "Give it a role.",
      body: "Choose its channels like you would for any new member. Start narrow.",
    },
    {
      title: "Introduce it.",
      body: "Pin a “meet the agent” post and let the community discover what it can do.",
    },
  ],
  faqTitle: (
    <>
      Server owner <span className="text-primary">questions.</span>
    </>
  ),
  faq: [
    {
      q: "What can it read?",
      a: "Channels its role can see — the same permission model you already use for members and bots. Nothing else.",
    },
    {
      q: "Can it moderate?",
      a: "It flags and reports; actions stay with your human mods. You can widen its remit later — that's your call, made in your settings.",
    },
    {
      q: "How do we remove it?",
      a: "Kick it like a member or revoke the OAuth grant. Its server memory can be deleted on request.",
    },
  ],
  closerTitle: "The member who's always online.",
  closerSub: "Add it to one channel, pin an intro, and watch #help start answering itself.",
  alsoAvailable: [
    { label: "Slack", href: "/slack" },
    { label: "Teams", href: "/teams" },
    { label: "Telegram", href: "/telegram" },
    { label: "WhatsApp", href: "/whatsapp" },
    { label: "buzz", href: "/buzz" },
  ],
};

export default function DiscordPage() {
  return <ChannelPage data={DATA} />;
}
