import { X } from "lucide-react";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Agents",
    body: "The left sidebar lists your agents. Green dot means running. Click an agent to open its chat. Use the play/stop buttons to control power — changes like desktop and routes apply on the next start.",
  },
  {
    title: "Chat",
    body: "The center pane is the conversation. Tool calls, thinking, and replies stream in live. The header shows what the agent is doing right now.",
  },
  {
    title: "Sessions",
    body: "Below the agents list, past sessions are grouped per agent. Click one to resume it, or start a new session with the + on the agent row.",
  },
  {
    title: "Activity",
    body: "The right pane's Activity tab shows the agent's live desktop preview (click it to interact), plus a feed of everything it does: tools, thinking, replies, token usage.",
  },
  {
    title: "Files",
    body: "Browse the agent's workspace, preview files, and open them while the agent runs.",
  },
  {
    title: "Advanced",
    body: "Logs and an interactive shell live under Advanced. Logs stream the runtime output; the shell is a full terminal inside the agent pod.",
  },
  {
    title: "Desktop",
    body: "Enable the desktop with the switch on the Activity tab, then stop and start the agent. A live preview appears — click it to take over mouse and keyboard.",
  },
];

export function TutorialModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[14px] font-semibold">Getting around</div>
          <button onClick={onClose} className="ui-icon-button-sm" title="Close">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {STEPS.map((step) => (
            <div key={step.title}>
              <div className="text-[12.5px] font-medium">{step.title}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-text-secondary">{step.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
