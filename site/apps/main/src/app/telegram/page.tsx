import type { Metadata } from "next";
import { ChannelPage, type ChannelPageData } from "@/components/channel-page";

export const metadata: Metadata = {
  title: "HyperCLI for Telegram — Your agents, where you work",
  description:
    "Your agent in your pocket. Message it like a contact — text or voice — and it gets to work while you get on with your day.",
};

const DATA: ChannelPageData = {
  label: "Telegram",
  eyebrow: "HyperCLI for Telegram",
  heroSub:
    "Your agent in your pocket. Message it like a contact — text or voice — and it gets to work while you get on with your day.",
  ctaLabel: "Open in Telegram",
  notes: ["Start a chat in seconds", "Voice notes welcome", "Works in groups too"],
  behaviorsTitle: (
    <>
      Built for how you <span className="text-primary">actually use Telegram.</span>
    </>
  ),
  behaviorsSub: "Fast, informal, from anywhere — your agent keeps up.",
  behaviors: [
    {
      tag: "DM",
      title: "Message it like a contact",
      body: "No app to open, no dashboard. It's a chat in your list that happens to get things done.",
    },
    {
      tag: "voice",
      title: "Voice notes in, work out",
      body: "Talk while you walk — it transcribes, extracts every task, and starts on all of them.",
    },
    {
      tag: "groups",
      title: "Add it to a group",
      body: "Mention it in a family or team group — it helps without reading what it shouldn't.",
    },
    {
      tag: "proactive",
      title: "It pings you first",
      body: "Watched things change, reminders land, updates arrive — wherever you are.",
    },
  ],
  demoTitle: (
    <>
      A Tuesday, <span className="text-primary">on the move.</span>
    </>
  ),
  demoChannel: "Telegram",
  demoAgentName: "Aria",
  messages: [
    {
      from: "user",
      author: "You",
      time: "1:47 PM",
      text: "[voice note · 0:41] — “…book the two flights we discussed, forward me the confirmation, and remind me about Dana's contract tonight”",
    },
    {
      from: "agent",
      author: "Aria",
      time: "1:47 PM",
      text: "Got all three. Booking flights from the options in your notes — confirmation to follow. Contract reminder set for 8pm.",
    },
    {
      from: "agent",
      author: "Aria",
      time: "2:12 PM",
      text: "Flights booked, confirmation forwarded. Found the earlier departure $140 cheaper — took it.",
    },
  ],
  permsTitle: (
    <>
      Private <span className="text-primary">by default.</span>
    </>
  ),
  permsSub: "A personal channel deserves personal boundaries:",
  perms: [
    {
      title: "Your chats only.",
      body: "It sees the conversation you have with it and groups you've added it to — nothing else on your account.",
    },
    {
      title: "Group manners.",
      body: "In groups it responds to mentions and replies; it doesn't hoover the whole chat.",
    },
    {
      title: "Voice stays in-house.",
      body: "Voice notes are transcribed by your agent on its own machine — not shipped to a third party.",
    },
    {
      title: "Leave anytime.",
      body: "Remove it from a group or delete the chat — and revoke the pairing from your dashboard for good measure.",
    },
  ],
  setupTitle: (
    <>
      Connected in <span className="text-primary">under a minute.</span>
    </>
  ),
  steps: [
    { title: "Open the link, tap start.", body: "Your agent appears as a chat like any other contact." },
    {
      title: "Say hello — or send a voice note.",
      body: "It introduces itself and asks what you'd like off your plate.",
    },
    {
      title: "Delegate from anywhere.",
      body: "The commute, the queue, the school run. Say it once; it's handled.",
    },
  ],
  faqTitle: (
    <>
      Quick <span className="text-primary">questions.</span>
    </>
  ),
  faq: [
    {
      q: "What does it read in groups?",
      a: "Mentions of it and replies to its messages. It's a participant, not a listener.",
    },
    {
      q: "Do voice notes leave the platform?",
      a: "No — transcription runs on your agent's own machine, and the audio is handled like any other file you've shared with it.",
    },
    {
      q: "How do I disconnect?",
      a: "Remove it from groups, delete the chat, or revoke the connection from your dashboard. Any one of those ends access from that surface.",
    },
  ],
  closerTitle: "The most useful chat in your list.",
  closerSub: "Open the chat, send one voice note, and see what's done by the time you're home.",
  alsoAvailable: [
    { label: "Slack", href: "/slack" },
    { label: "Teams", href: "/teams" },
    { label: "WhatsApp", href: "/whatsapp" },
    { label: "Discord", href: "/discord" },
    { label: "buzz", href: "/buzz" },
  ],
};

export default function TelegramPage() {
  return <ChannelPage data={DATA} />;
}
