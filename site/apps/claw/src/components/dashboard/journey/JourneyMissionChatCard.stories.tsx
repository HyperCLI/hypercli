import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { JOURNEY_DAYS } from "./journey-days";
import { JourneyMissionChatCard } from "./JourneyMissionChatCard";

const meta: Meta<typeof JourneyMissionChatCard> = {
  title: "Journey/JourneyMissionChatCard",
  component: JourneyMissionChatCard,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="min-h-[720px] w-[760px] bg-[#080809] p-8 text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof JourneyMissionChatCard>;

const baseArgs = {
  agentName: "Marlow",
  preferredName: "Ada",
  onSetPrompt: () => {},
  onRunDayAction: () => {},
  onRunCapabilityPrompt: () => {},
  onOpenCapability: () => {},
};

function day(id: string) {
  const journeyDay = JOURNEY_DAYS.find((entry) => entry.id === id);
  if (!journeyDay) throw new Error(`Missing Journey day: ${id}`);
  return journeyDay;
}

export const Mission1Brief: Story = {
  args: {
    ...baseArgs,
    day: day("brief"),
  },
};

export const Mission2Sources: Story = {
  args: {
    ...baseArgs,
    day: day("sources"),
    capabilityContext: {
      input: "I have a screenshot and a call recording that explain the current work.",
      hasImageAttachment: true,
      hasAudioAttachment: true,
      hasFileAttachment: true,
    },
  },
};

export const Mission3Rules: Story = {
  args: {
    ...baseArgs,
    day: day("rules"),
  },
};

export const Mission4RealWork: Story = {
  args: {
    ...baseArgs,
    day: day("real-work"),
    capabilityContext: {
      input: "Draft a spoken update and image direction for the design review.",
    },
  },
};

export const Mission5Understanding: Story = {
  args: {
    ...baseArgs,
    day: day("understanding"),
    capabilityContext: {
      input: "Use the meeting recording to review what changed.",
      hasAudioAttachment: true,
    },
  },
};

export const Mission6Connections: Story = {
  args: {
    ...baseArgs,
    day: day("connections"),
    capabilityContext: {
      input: "Draft a voice handoff after checking where the work lives.",
    },
  },
};

export const Mission7Repeatable: Story = {
  args: {
    ...baseArgs,
    day: day("repeatable"),
    capabilityContext: {
      input: "Make a weekly workflow visible with a short video concept and a 3D asset brief.",
    },
  },
};

export const EmptyFields: Story = {
  args: {
    ...baseArgs,
    day: day("brief"),
    defaultPreviewOpen: true,
  },
};

export const ExampleFilled: Story = {
  args: {
    ...baseArgs,
    day: day("real-work"),
    defaultPreviewOpen: true,
    defaultValues: {
      goal: "Prepare a status update for this project.",
      context: "The team needs progress, blockers, owners, and next steps.",
      output: "A concise update I can edit before sharing.",
      audience: "My project team.",
    },
  },
};

export const MissingFieldState: Story = {
  args: {
    ...baseArgs,
    day: day("sources"),
    defaultPreviewOpen: true,
    defaultValues: {
      source: "Latest decision note",
    },
  },
};

export const CapabilityPromptPreview: Story = {
  args: {
    ...baseArgs,
    day: day("real-work"),
    defaultPreviewOpen: true,
    defaultPreviewCapabilityId: "create-images",
    defaultValues: {
      goal: "Draft visual direction for the design review.",
      context: "Use the attached screenshot and current review goals.",
      output: "A visual brief with constraints and success criteria.",
      audience: "Design reviewers.",
    },
    capabilityContext: {
      input: "Draft visual direction from this screenshot.",
      hasImageAttachment: true,
      hasFileAttachment: true,
    },
  },
};

export const AllMissions: Story = {
  render: () => (
    <div className="grid gap-5">
      {JOURNEY_DAYS.map((journeyDay) => (
        <JourneyMissionChatCard
          key={journeyDay.id}
          {...baseArgs}
          day={journeyDay}
          capabilityContext={{
            input: "Screenshot, meeting recording, voice handoff, video workflow, and 3D asset brief.",
            hasImageAttachment: true,
            hasAudioAttachment: true,
            hasFileAttachment: true,
          }}
        />
      ))}
    </div>
  ),
};
