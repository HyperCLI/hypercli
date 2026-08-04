import type { Metadata } from "next";
import { ChannelPage, type ChannelPageData } from "@/components/channel-page";

export const metadata: Metadata = {
  title: "HyperCLI for WhatsApp — Your agents, where you work",
  description:
    "The agent your business runs on, in the app you already use for everything else. Text it, voice-note it, send it a photo — it handles the rest.",
};

const DATA: ChannelPageData = {
  label: "WhatsApp",
  eyebrow: "HyperCLI for WhatsApp",
  heroSub:
    "The agent your business runs on, in the app you already use for everything else. Text it, voice-note it, send it a photo — it handles the rest.",
  ctaLabel: "Connect on WhatsApp",
  notes: ["Scan a QR to connect", "Voice notes and photos welcome", "Your personal chats stay yours"],
  behaviorsTitle: (
    <>
      Your back office, <span className="text-primary">in a chat.</span>
    </>
  ),
  behaviorsSub: "For the businesses that run on WhatsApp already — which is most of them.",
  behaviors: [
    {
      tag: "chat",
      title: "Message it like a contact",
      body: "Same app your customers and suppliers use — now with one contact who works for you.",
    },
    {
      tag: "photo",
      title: "Photos in, work out",
      body: "Snap an invoice, a receipt, a form — it reads, files, logs, and acts on what's in the frame.",
    },
    {
      tag: "voice",
      title: "Voice notes welcome",
      body: "Rattle off five things between meetings; it catches all five.",
    },
    {
      tag: "proactive",
      title: "It messages first",
      body: "Payment cleared, delivery landed, competitor moved — you hear about it without asking.",
    },
  ],
  demoTitle: (
    <>
      Running the shop <span className="text-primary">from your phone.</span>
    </>
  ),
  demoChannel: "WhatsApp",
  demoAgentName: "Aria",
  messages: [
    {
      from: "user",
      author: "You",
      time: "9:22 AM",
      text: "[photo: supplier invoice] log this and schedule payment for Thursday",
    },
    {
      from: "agent",
      author: "Aria",
      time: "9:22 AM",
      text: "Logged — $1,240, due Aug 14, filed against Meridian Supply. Payment scheduled Thursday; I'll confirm when it clears.",
    },
    {
      from: "agent",
      author: "Aria",
      time: "Thu 10:02 AM",
      text: "Paid, receipt filed. Heads up: this supplier's prices are up 8% since May — want a comparison of alternatives?",
    },
  ],
  permsTitle: (
    <>
      Separate from <span className="text-primary">your life.</span>
    </>
  ),
  permsSub: "Business agent, business boundaries:",
  perms: [
    {
      title: "Its own number.",
      body: "Your agent lives on its own business line — your personal chats and contacts are untouched.",
    },
    {
      title: "Only what you send it.",
      body: "It sees the conversation you have with it. Photos and documents you share are processed by your agent alone.",
    },
    {
      title: "Your data isn't training data.",
      body: "Invoices, voice notes, photos — none of it trains anything.",
    },
    {
      title: "Unlink anytime.",
      body: "Disconnect from your dashboard and the number goes quiet immediately.",
    },
  ],
  setupTitle: (
    <>
      Connected before your <span className="text-primary">coffee's poured.</span>
    </>
  ),
  steps: [
    { title: "Scan the QR from your dashboard.", body: "Your agent's number lands in your contacts." },
    { title: "Send a hello.", body: "Text, voice, or a photo of the thing on your desk right now." },
    {
      title: "Run the business from anywhere.",
      body: "The stockroom, the van, the beach you said you'd stop working on.",
    },
  ],
  faqTitle: (
    <>
      Quick <span className="text-primary">questions.</span>
    </>
  ),
  faq: [
    {
      q: "Is this my personal WhatsApp?",
      a: "No — your agent operates its own business number through the WhatsApp Business API. Your account is untouched.",
    },
    {
      q: "What happens to photos I send?",
      a: "Your agent reads them on its own machine, does the work, and files them in its memory — searchable later, shared with no one.",
    },
    {
      q: "How do I disconnect?",
      a: "Unlink from your dashboard. Access ends immediately; the chat history on your phone is yours to keep or delete.",
    },
  ],
  closerTitle: "Your business already runs on WhatsApp. Now it runs itself.",
  closerSub: "Connect in a minute, send one photo, and watch the paperwork do itself.",
  alsoAvailable: [
    { label: "Slack", href: "/slack" },
    { label: "Teams", href: "/teams" },
    { label: "Telegram", href: "/telegram" },
    { label: "Discord", href: "/discord" },
    { label: "buzz", href: "/buzz" },
  ],
};

export default function WhatsAppPage() {
  return <ChannelPage data={DATA} />;
}
