"use client";

import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  Clapperboard,
  Database,
  FileCheck,
  ListChecks,
  Megaphone,
  Mic,
  Rocket,
  Search,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@hypercli/shared-ui";

interface TabPanel {
  label: string;
  title: string;
  icon: LucideIcon;
  lead: string;
  asks: React.ReactNode[];
  back: string;
}

function TabPanelGroup({ panels, autoRotate = false }: { panels: TabPanel[]; autoRotate?: boolean }) {
  const [active, setActive] = useState(0);
  const userSelected = useRef(false);

  useEffect(() => {
    if (!autoRotate) return;
    const id = setInterval(() => {
      if (!userSelected.current) {
        setActive((current) => (current + 1) % panels.length);
      }
    }, 4500);
    return () => clearInterval(id);
  }, [autoRotate, panels.length]);

  const panel = panels[active];
  return (
    <div>
      <div role="tablist" className="mb-6 flex flex-wrap justify-center gap-2.5">
        {panels.map((p, index) => (
          <button
            key={p.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => {
              userSelected.current = true;
              setActive(index);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-4.5 py-2 text-sm font-medium transition-all",
              index === active
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-border-medium/40 bg-surface text-text-secondary hover:border-border-medium hover:text-foreground",
            )}
          >
            <p.icon className="h-4 w-4" aria-hidden="true" />
            {p.label}
          </button>
        ))}
      </div>
      <div className="glass-card mx-auto max-w-2xl p-8 text-left">
        <h3 className="mb-4 flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground">
          <panel.icon className="h-5 w-5 text-primary" aria-hidden="true" />
          {panel.title}
        </h3>
        <p className="mb-5 text-base leading-relaxed text-text-secondary">{panel.lead}</p>
        <div className="mb-5 grid gap-2.5">
          {panel.asks.map((ask, index) => (
            <p
              key={index}
              className="w-fit max-w-full rounded-2xl rounded-bl-sm border border-border bg-surface px-4.5 py-3 text-sm text-foreground"
            >
              <span className="text-text-muted">&ldquo;</span>
              {ask}
              <span className="text-text-muted">&rdquo;</span>
            </p>
          ))}
        </div>
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <FileCheck className="h-4 w-4 flex-shrink-0 text-success" aria-hidden="true" />
          {panel.back}
        </p>
      </div>
    </div>
  );
}

const CAPABILITY_PANELS: TabPanel[] = [
  {
    label: "Research",
    title: "Research and reports",
    icon: Search,
    lead: "It has its own browser and reads the web the way you do — then hands you a document, not forty links.",
    asks: [
      "Build a comparison of the top 5 tools our customers keep mentioning — pricing, gaps, and where we win",
      "Research this prospect before my 2pm — company, funding, recent news, who I'm talking to",
    ],
    back: "Finished docs, tables, and one-pagers — in the thread where you asked.",
  },
  {
    label: "Content",
    title: "Content and media",
    icon: Clapperboard,
    lead: "It makes images, videos, and voiceovers in-house — your product shots become demo clips, your scripts become talking-head videos.",
    asks: [
      "Make 3 image options for Thursday's launch post — same style as last month's",
      "Turn this changelog into a 30-second demo video with a voiceover",
    ],
    back: "Finished assets, on brand — because it remembers what your brand looks and sounds like.",
  },
  {
    label: "Voice",
    title: "Talk instead of type",
    icon: Mic,
    lead: "Send it voice notes; it transcribes and acts. Ask it to speak; it reads your digest aloud — in a voice you picked or designed.",
    asks: [
      <em key="v1" className="text-text-secondary">
        [voice note from the car] — three things, don&apos;t let me forget any of them
      </em>,
      "Read me the morning summary while I make coffee",
    ],
    back: "Both directions, any device — your commute becomes a working meeting with one attendee.",
  },
  {
    label: "Ops",
    title: "Ops and paperwork",
    icon: ListChecks,
    lead: "The work nobody loves: forms, follow-ups, spreadsheets, portals. Handled, with a paper trail.",
    asks: [
      "Chase the three unpaid invoices from May — politely, cc me",
      "Fill out the vendor onboarding form on their portal — everything's in the shared drive",
    ],
    back: "Done, with a receipt — it reports what it did and flags anything it wasn't sure about.",
  },
  {
    label: "Watching",
    title: "Watching and alerts",
    icon: BellRing,
    lead: "It's always on — so standing orders actually stand. It checks, every day, forever, and only speaks when something matters.",
    asks: [
      "Watch our competitors' pricing pages and tell me the day anything changes",
      "Every Friday at 4, post this week's numbers in #general",
    ],
    back: "Say it once. It sets its own schedule — you never re-ask.",
  },
  {
    label: "Memory",
    title: "Remembering everything",
    icon: Database,
    lead: "It keeps a real memory of your business — decisions, docs, preferences. The longer it works with you, the less you have to explain.",
    asks: [
      "What did we decide about annual pricing back in March?",
      "Get the new hire up to speed on how we run launches",
    ],
    back: "Answers with sources — from your own docs and history, not the internet's.",
  },
];

const ROLE_PANELS: TabPanel[] = [
  {
    label: "Founder",
    title: "Founder",
    icon: Rocket,
    lead: "The stuff that eats your evenings:",
    asks: [
      "Prep the board update — pull the numbers, draft the narrative",
      "Research the two companies that just entered our space",
      "Draft replies to everything in my inbox older than 2 days",
      "Every Sunday night: my week ahead, with prep notes per meeting",
    ],
    back: "You review and send. The thinking's done before you sit down.",
  },
  {
    label: "Marketing",
    title: "Marketing",
    icon: Megaphone,
    lead: "A content teammate that never runs out:",
    asks: [
      "Draft next week's posts from the launch notes — images included",
      "Turn Tuesday's webinar into a recap post, 3 clips, and an email",
      "Watch our brand mentions and flag anything spicy",
      "Refresh the comparison page — competitor X changed pricing",
    ],
    back: "On-brand every time, because it remembers the brand.",
  },
  {
    label: "Ops",
    title: "Ops",
    icon: Settings,
    lead: "The pipeline runs itself:",
    asks: [
      "Reconcile this month's invoices against the spreadsheet",
      "Onboard the new vendor — forms, W-9, add them to the system",
      "Chase every unsigned contract, weekly, until they sign",
      "Book travel for the offsite within the budget doc",
    ],
    back: "Every step logged. Nothing falls through.",
  },
  {
    label: "Sales",
    title: "Sales",
    icon: Target,
    lead: "Show up knowing everything:",
    asks: [
      "Brief me on every meeting on tomorrow's calendar",
      "Update the CRM from my call notes — voice memo attached",
      "Draft follow-ups for today's three demos, personalized",
      "Tell me the moment a target account posts a job or raises",
    ],
    back: "Pipeline stays current without the Friday data-entry hour.",
  },
];

export function CapabilityTabs() {
  return <TabPanelGroup panels={CAPABILITY_PANELS} autoRotate />;
}

export function RoleTabs() {
  return <TabPanelGroup panels={ROLE_PANELS} />;
}
