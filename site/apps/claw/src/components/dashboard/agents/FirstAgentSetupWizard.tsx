"use client";

import React, { type ComponentType } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Brain,
  Check,
  ChevronLeft,
  Circle,
  FileText,
  Rocket,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

interface FirstAgentSetupWizardProps {
  onCreateAgent: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
}

type WizardStepId = "identity" | "knowledge" | "plan";

const FIRST_AGENT_SETUP_DRAFT_KEY = "hypercli-first-agent-draft";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const helpCategories = ["General", "Research", "Support", "Sales", "Ops", "Dev", "Content", "Automation"];

const avatarOptions: Array<{
  iconIndex: number;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { iconIndex: 0, label: "Bot avatar", icon: Bot },
  { iconIndex: 1, label: "Brain avatar", icon: Brain },
  { iconIndex: 12, label: "Shield avatar", icon: Shield },
  { iconIndex: 11, label: "Rocket avatar", icon: Rocket },
  { iconIndex: 15, label: "Lightning avatar", icon: Zap },
];

const stepCopy: Record<WizardStepId, { title: string; subtitle: string }> = {
  identity: {
    title: "Create your first agent",
    subtitle: "Give it a name, a look, and a quick note on what it does. You can change anything later.",
  },
  knowledge: {
    title: "Give it something to know",
    subtitle: "Add a file so your agent has real context.",
  },
  plan: {
    title: "Choose your plan",
    subtitle: "Start where you are - Free, Simple or Pro. Upgrade or downgrade any time.",
  },
};

const steps: WizardStepId[] = ["identity", "knowledge", "plan"];
const agentNameFirstWords = [
  "bright",
  "clear",
  "fresh",
  "rapid",
  "solar",
  "quiet",
  "prime",
  "silver",
  "steady",
  "swift",
];
const agentNameSecondWords = [
  "atlas",
  "beam",
  "forge",
  "harbor",
  "matrix",
  "orbit",
  "pilot",
  "signal",
  "vector",
  "window",
];

const planOptions: Array<{
  id: "free" | "simple" | "pro";
  name: string;
  size: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  oldPrice?: string;
  price: string;
  priceNote: string;
  cta: string;
  accent?: boolean;
  features: string[];
}> = [
  {
    id: "free",
    name: "Free",
    size: "small",
    icon: Circle,
    description: "Explore HyperCLI at your own pace",
    price: "$0",
    priceNote: "USD/month",
    cta: "Continue",
    features: ["1 small agent", "Limited usage"],
  },
  {
    id: "simple",
    name: "Simple",
    size: "small",
    icon: Sparkles,
    description: "Advanced workflows and analytics",
    oldPrice: "$39",
    price: "$0",
    priceNote: "USD/month per agent",
    cta: "Try for free 7 days",
    accent: true,
    features: ["Text conversations", "1 chat channel", "Files up to 25 MB", "Standard tools", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    size: "medium",
    icon: Rocket,
    description: "Advanced workflows and analytics",
    oldPrice: "$79",
    price: "$0",
    priceNote: "USD/month per agent",
    cta: "Try for free 7 days",
    accent: true,
    features: ["Voice and audio", "Video understanding", "Browser actions", "10x token usage", "All chat channels", "Files up to 250 MB", "Priority support"],
  },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function randomIndex(max: number): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function generateAgentName(): string {
  const first = agentNameFirstWords[randomIndex(agentNameFirstWords.length)];
  const second = agentNameSecondWords[randomIndex(agentNameSecondWords.length)];
  return `${first}-${second}`;
}

function WizardButton({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center justify-center rounded-[10px] px-3.5 text-[14px] font-medium transition-colors sm:h-10 sm:px-4 sm:text-[15px]",
        variant === "primary"
          ? "bg-[#36c99b] text-[#06251c] hover:bg-[#43dbad]"
          : "border border-[#4a4a4d] bg-[#242424] text-foreground hover:bg-[#2b2b2b]",
      )}
    >
      {children}
    </button>
  );
}

export function FirstAgentSetupWizard({ onCreateAgent }: FirstAgentSetupWizardProps) {
  const [defaultAgentName, setDefaultAgentName] = React.useState("");
  const [stepIndex, setStepIndex] = React.useState(0);
  const [agentName, setAgentName] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("General");
  const [selectedIconIndex, setSelectedIconIndex] = React.useState(avatarOptions[0].iconIndex);
  const [selectedPlanId, setSelectedPlanId] = React.useState<(typeof planOptions)[number]["id"]>("free");
  const [files, setFiles] = React.useState<File[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const currentStep = steps[stepIndex];
  const currentCopy = stepCopy[currentStep];
  const selectedPlan = planOptions.find((plan) => plan.id === selectedPlanId) ?? planOptions[0];
  const selectedAvatar = avatarOptions.find((option) => option.iconIndex === selectedIconIndex) ?? avatarOptions[0];
  const SelectedAvatarIcon = selectedAvatar.icon;
  const displayName = agentName.trim() || defaultAgentName || "agent";

  React.useEffect(() => {
    const generatedName = generateAgentName();
    setDefaultAgentName(generatedName);
    setAgentName((currentName) => currentName.trim() ? currentName : generatedName);
  }, []);

  const goToStep = (nextStep: number) => {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, nextStep)));
  };

  const handleFileSelection = (fileList: FileList | null) => {
    if (!fileList) return;
    setFiles(Array.from(fileList).filter((file) => file.size <= MAX_FILE_SIZE).slice(0, 4));
  };

  const saveDraftAndCreate = async (planId = selectedPlanId) => {
    if (creating) return;
    const plan = planOptions.find((option) => option.id === planId) ?? selectedPlan;
    setCreating(true);
    setCreateError(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        FIRST_AGENT_SETUP_DRAFT_KEY,
        JSON.stringify({
          source: "first-agent-setup",
          name: displayName,
          description: `${displayName} helps with ${selectedCategory.toLowerCase()} workflows.`,
          size: plan.size,
          iconIndex: selectedIconIndex,
          category: selectedCategory,
          plan: plan.id,
          starterFiles: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      );
    }
    try {
      const createdId = await onCreateAgent({
        name: displayName,
        iconIndex: selectedIconIndex,
        size: plan.size,
      });
      if (!createdId) {
        setCreateError("Agent creation did not return an agent id.");
        setCreating(false);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create agent");
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex h-full max-h-[680px] min-h-0 w-full max-w-[980px] flex-col overflow-hidden rounded-[20px] border border-[#353535] bg-[#171717] text-foreground shadow-[0_20px_56px_rgba(0,0,0,0.46)]"
      >
        <header className="flex-shrink-0 border-b border-[#333333] px-5 py-4 sm:px-6 lg:px-7">
          <h2 className="text-[20px] font-medium leading-tight text-[#f3f3f3] sm:text-[24px]">{currentCopy.title}</h2>
          <p className="mt-2 text-[13px] leading-snug text-[#858585] sm:text-[15px] lg:text-[16px]">{currentCopy.subtitle}</p>
        </header>

        {currentStep === "identity" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              <div className="grid gap-5 md:grid-cols-[72px_minmax(0,1fr)] md:items-center lg:grid-cols-[80px_minmax(0,1fr)]">
                <div className="relative mx-auto h-[72px] w-[72px] md:mx-0 lg:h-20 lg:w-20">
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#22352f] text-[#74e5be] lg:h-20 lg:w-20">
                    <SelectedAvatarIcon className="h-7 w-7 lg:h-8 lg:w-8" />
                  </div>
                </div>

                <label className="block min-w-0">
                  <span className="mb-2 block text-[14px] font-semibold leading-none text-[#f5f5f5] sm:text-[16px]">Agent name</span>
                  <input
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    className="h-10 w-full rounded-[12px] border border-[#4a4a4d] bg-[#202020] px-3 text-[15px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#707070] focus:border-[#6a6a6d] sm:h-11 sm:text-[16px] lg:h-12"
                  />
                </label>
              </div>

              <div className="mt-7 lg:mt-8">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-[#f5f5f5] sm:text-[16px]">What does it help with?</p>
                <div className="flex flex-wrap gap-2">
                  {helpCategories.map((category) => {
                    const selected = selectedCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setSelectedCategory(category)}
                        className={cx(
                          "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors sm:text-[14px]",
                          selected
                            ? "border-[#5b5b5f] bg-[#252525] text-[#f6f6f6]"
                            : "border-[#444448] bg-[#202020] text-[#f0f0f0] hover:border-[#66666a]",
                        )}
                      >
                        {category}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <p className="mb-3 text-[14px] font-semibold leading-tight text-[#f5f5f5] sm:text-[16px]">Avatar</p>
                <div className="flex flex-wrap gap-2">
                  {avatarOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = selectedIconIndex === option.iconIndex;
                    return (
                      <button
                        key={option.iconIndex}
                        type="button"
                        aria-label={option.label}
                        aria-pressed={selected}
                        onClick={() => setSelectedIconIndex(option.iconIndex)}
                        className={cx(
                          "flex h-8 w-8 items-center justify-center rounded-[8px] border bg-[#222222] text-[#f1f1f1] transition-colors",
                          selected
                            ? "border-[#35c69a] shadow-[0_0_0_1px_rgba(53,198,154,0.28)]"
                            : "border-[#424245] hover:border-[#66666a] hover:bg-[#292929]",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-end border-t border-[#333333] bg-[#202020] px-5 sm:px-7">
              <WizardButton onClick={() => goToStep(1)}>Continue</WizardButton>
            </footer>
          </>
        )}

        {currentStep === "knowledge" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  handleFileSelection(event.dataTransfer.files);
                }}
                className="flex min-h-[190px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[#343434] bg-[#070707] px-5 text-center sm:min-h-[220px]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2f2f31] bg-[#111111] text-[#8b8b8f] sm:h-12 sm:w-12">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <p className="mt-5 text-[16px] font-semibold leading-tight text-[#f5f5f5] sm:text-[18px]">
                  Drop your files here, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="underline underline-offset-4 transition-colors hover:text-[#36c99b]"
                  >
                    click to browse
                  </button>
                </p>
                <p className="mt-2 text-[13px] leading-tight text-[#858585] sm:text-[14px]">PDF, DOCX, TXT, or CSV - up to 25 MB each</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.csv"
                  className="hidden"
                  onChange={(event) => handleFileSelection(event.target.files)}
                />

                {files.length > 0 && (
                  <div className="mt-7 flex max-w-full flex-wrap justify-center gap-3">
                    {files.map((file) => (
                      <span
                        key={`${file.name}-${file.size}`}
                        className="max-w-[260px] truncate rounded-full border border-[#3c3c3f] bg-[#191919] px-4 py-2 text-sm text-[#d8d8d8]"
                      >
                        {file.name} - {formatFileSize(file.size)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <footer className="flex h-[72px] flex-shrink-0 items-center justify-between border-t border-[#333333] bg-[#202020] px-5 sm:px-7">
              <WizardButton variant="secondary" onClick={() => goToStep(0)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </WizardButton>
              <WizardButton onClick={() => goToStep(2)}>Continue</WizardButton>
            </footer>
          </>
        )}

        {currentStep === "plan" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-7">
              {createError && (
                <div className="mb-4 rounded-[12px] border border-[#d05f5f]/40 bg-[#d05f5f]/10 px-4 py-3 text-sm text-[#ffb3b3]">
                  {createError}
                </div>
              )}
              <div className="grid min-h-0 gap-3 lg:grid-cols-3">
              {planOptions.map((plan) => {
                const Icon = plan.icon;
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPlanId(plan.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={cx(
                      "flex min-h-0 flex-col rounded-[12px] border border-[#333335] bg-[#171717] p-4 text-left transition-colors hover:border-[#4d4d50] sm:p-5",
                      selectedPlanId === plan.id && "border-[#47484b]",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#3d3e42] bg-[#2b2c30] text-[#f5f5f5]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <h3 className="text-[20px] font-semibold leading-none text-[#f5f5f5] sm:text-[22px]">{plan.name}</h3>
                    </div>

                    <p className="mt-4 min-h-[40px] max-w-[260px] text-[13px] leading-[1.35] text-[#858585] sm:text-[14px]">{plan.description}</p>

                    <div className="mt-3 flex min-h-[40px] items-center gap-2.5">
                      {plan.oldPrice && (
                        <span className="text-[24px] font-bold leading-none text-[#777777] line-through decoration-[2px] sm:text-[28px]">{plan.oldPrice}</span>
                      )}
                      <span className="text-[28px] font-bold leading-none text-[#f7f7f7] sm:text-[34px]">{plan.price}</span>
                      <span className="max-w-[96px] text-[11px] font-semibold leading-[1.08] text-[#f6f6f6] sm:text-[12px]">{plan.priceNote}</span>
                    </div>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPlanId(plan.id);
                        void saveDraftAndCreate(plan.id);
                      }}
                      disabled={creating}
                      className={cx(
                        "mt-4 h-10 rounded-[12px] text-[14px] font-medium leading-tight transition-colors disabled:cursor-wait disabled:opacity-70 sm:h-11 sm:text-[15px]",
                        plan.accent
                          ? "bg-[#3ed0a0] text-[#06251c] hover:bg-[#47deae]"
                          : "border border-[#444448] bg-[#202020] text-[#f5f5f5] hover:bg-[#262626]",
                      )}
                    >
                      {creating && selectedPlanId === plan.id ? "Creating..." : plan.cta}
                    </button>

                    <div className="mt-5 space-y-2.5">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-center gap-2.5 text-[13px] leading-tight text-[#f2f2f2] sm:text-[14px]">
                          <Check className="h-4 w-4 flex-shrink-0 text-[#7d7d7d]" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </motion.section>
    </div>
  );
}
