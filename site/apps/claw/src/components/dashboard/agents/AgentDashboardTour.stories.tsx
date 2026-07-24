import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AgentDashboardTour } from "./AgentDashboardTour";

const meta: Meta<typeof AgentDashboardTour> = {
  title: "Agents/AgentDashboardTour",
  component: AgentDashboardTour,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof AgentDashboardTour>;

function TourPreview() {
  const [open, setOpen] = useState(true);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-foreground)]"
      >
        Open agent tour
      </button>
      <AgentDashboardTour
        open={open}
        onOpenChange={setOpen}
        onStartCreating={() => setOpen(false)}
      />
    </main>
  );
}

export const Default: Story = {
  render: () => <TourPreview />,
};
