"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Brain, Cat, Crown, Dog, Eye, Flame, Globe, Heart, Leaf,
  Moon, Rocket, Shield, Sparkles, Star, Zap,
  X, ChevronLeft, ChevronRight, Loader2, ChevronDown, ChevronUp, Upload, Check,
  type LucideIcon,
} from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";
import { formatCpu, formatMemory } from "@/lib/format";

// ── Types ──

interface AgentCreationWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  budget?: {
    max_agents: number;
    total_cpu: number;
    total_memory: number;
    used_agents: number;
    used_cpu: number;
    used_memory: number;
  } | null;
}

// ── Constants ──

const ICONS: { icon: LucideIcon; name: string }[] = [
  { icon: Bot, name: "Bot" },
  { icon: Brain, name: "Brain" },
  { icon: Cat, name: "Cat" },
  { icon: Crown, name: "Crown" },
  { icon: Dog, name: "Dog" },
  { icon: Eye, name: "Eye" },
  { icon: Flame, name: "Flame" },
  { icon: Globe, name: "Globe" },
  { icon: Heart, name: "Heart" },
  { icon: Leaf, name: "Leaf" },
  { icon: Moon, name: "Moon" },
  { icon: Rocket, name: "Rocket" },
  { icon: Shield, name: "Shield" },
  { icon: Sparkles, name: "Sparkles" },
  { icon: Star, name: "Star" },
  { icon: Zap, name: "Zap" },
];

const HUES = [157, 180, 210, 240, 260, 280, 310, 340, 10, 30, 50, 70, 90, 120, 140, 200];

const SIZES = [
  { label: "Small", tag: "Starter", desc: "1 CPU · 1 GiB", value: "small" },
  { label: "Medium", tag: "Recommended", desc: "2 CPU · 2 GiB", value: "medium" },
  { label: "Large", tag: "Pro", desc: "4 CPU · 4 GiB", value: "large" },
];

const TOTAL_STEPS = 3;

// ── Slide animation variants ──

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

const slideTransition = {
  x: { type: "spring" as const, stiffness: 300, damping: 30 },
  opacity: { duration: 0.2 },
};

// ── Component ──

export function AgentCreationWizard({ open, onClose, onCreated, budget }: AgentCreationWizardProps) {
  const { getToken } = useClawAuth();

  // Step navigation
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(0);

  // Step 1: Identity
  const [name, setName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState(0);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Configuration
  const [selectedSize, setSelectedSize] = useState(1); // Medium default
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customCpu, setCustomCpu] = useState("2000");
  const [customMem, setCustomMem] = useState("2048");
  const [startImmediately, setStartImmediately] = useState(true);

  // Step 3: Creating state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived
  const currentHue = HUES[selectedIcon];
  const CurrentIcon = ICONS[selectedIcon].icon;
  const customCpuCores = Math.max(1, Math.round(Number(customCpu) / 1000));
  const customMemGb = Math.max(1, Math.round(Number(customMem) / 1024));

  const budgetRemaining = budget
    ? {
        agents: budget.max_agents - budget.used_agents,
        cpu: budget.total_cpu - budget.used_cpu,
        memory: budget.total_memory - budget.used_memory,
      }
    : null;

  // ── Keyboard ──

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // ── Reset on open ──

  useEffect(() => {
    if (open) {
      setStep(0);
      setDirection(0);
      setName("");
      setSelectedIcon(0);
      setCustomAvatar(null);
      setDescription("");
      setSelectedSize(1);
      setShowAdvanced(false);
      setCustomCpu("2000");
      setCustomMem("2048");
      setStartImmediately(true);
      setCreating(false);
      setError(null);
    }
  }, [open]);

  // ── Navigation ──

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setDirection(1);
      setStep((s) => s + 1);
    }
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setDirection(-1);
      setStep((s) => s - 1);
    }
  }, [step]);

  // ── File upload ──

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be under 2MB");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setCustomAvatar(event.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Create agent ──

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const body: Record<string, unknown> = {
        name: name.trim() || null,
        start: startImmediately,
        config: {},
      };
      if (showAdvanced) {
        body.cpu = customCpuCores;
        body.memory = customMemGb;
      } else {
        body.size = SIZES[selectedSize].value;
      }
      await clawFetch("/agents", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  // ── Validation ──

  const canProceed = step === 0 ? true : step === 1 ? true : true;

  if (!open) return null;

  // ── Avatar render helper ──

  const renderAvatar = (size: "sm" | "lg") => {
    const dims = size === "sm" ? "w-10 h-10" : "w-20 h-20";
    const iconSize = size === "sm" ? 20 : 40;

    if (customAvatar) {
      return (
        <div
          className={`${dims} rounded-full overflow-hidden border-2 border-border-medium flex-shrink-0`}
        >
          <img src={customAvatar} alt="Custom avatar" className="w-full h-full object-cover" />
        </div>
      );
    }

    return (
      <div
        className={`${dims} rounded-full flex items-center justify-center flex-shrink-0`}
        style={{
          backgroundColor: `hsl(${currentHue} 60% 20%)`,
        }}
      >
        <CurrentIcon
          size={iconSize}
          style={{ color: `hsl(${currentHue} 70% 70%)` }}
        />
      </div>
    );
  };

  // ── Step renderers ──

  const renderStep0 = () => (
    <div className="space-y-6">
      {/* Name input */}
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-surface-low border border-border text-foreground text-base text-center focus:outline-none focus:border-border-strong placeholder:text-text-muted"
          placeholder="Name your agent (or leave blank to auto-generate)"
          autoFocus
        />
      </div>

      {/* Avatar picker */}
      <div>
        <label className="block text-sm text-text-secondary mb-3">Choose an avatar</label>
        <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
          {ICONS.map((item, i) => {
            const hue = HUES[i];
            const Icon = item.icon;
            const isSelected = selectedIcon === i && !customAvatar;
            return (
              <button
                key={item.name}
                onClick={() => {
                  setSelectedIcon(i);
                  setCustomAvatar(null);
                }}
                className={`w-full aspect-square rounded-full flex items-center justify-center transition-all ${
                  isSelected
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                    : "hover:ring-1 hover:ring-text-muted hover:ring-offset-1 hover:ring-offset-background"
                }`}
                style={{
                  backgroundColor: `hsl(${hue} 60% 20%)`,
                }}
                title={item.name}
              >
                <Icon
                  size={14}
                  style={{ color: `hsl(${hue} 70% 70%)` }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload custom */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-secondary border border-border hover:border-border-medium hover:text-foreground transition-all"
        >
          <Upload size={14} />
          Upload custom
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        {customAvatar && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border border-border-medium">
              <img src={customAvatar} alt="Custom" className="w-full h-full object-cover" />
            </div>
            <button
              onClick={() => setCustomAvatar(null)}
              className="text-xs text-text-muted hover:text-foreground"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong placeholder:text-text-muted resize-none"
          placeholder="What does this agent do? (optional)"
          rows={3}
        />
      </div>

      {/* Live preview */}
      <div className="border border-border rounded-xl p-4 bg-surface-low/50">
        <p className="text-[10px] uppercase tracking-wider text-text-muted mb-3">Preview</p>
        <div className="flex items-center gap-3">
          {renderAvatar("sm")}
          <div className="min-w-0">
            <p className="text-base font-medium text-foreground truncate">
              {name || "Unnamed Agent"}
            </p>
            {description && (
              <p className="text-xs text-text-secondary truncate mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-6">
      {/* Size picker */}
      <div>
        <label className="block text-sm text-text-secondary mb-3">Size</label>
        <div className="grid grid-cols-3 gap-3">
          {SIZES.map((s, i) => {
            const isSelected = selectedSize === i && !showAdvanced;
            return (
              <button
                key={s.label}
                onClick={() => {
                  setSelectedSize(i);
                  setShowAdvanced(false);
                }}
                className={`relative p-4 rounded-xl border text-center transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-surface-low text-text-secondary hover:border-text-muted"
                }`}
              >
                {s.tag === "Recommended" && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                    {s.tag}
                  </span>
                )}
                {s.tag !== "Recommended" && (
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">
                    {s.tag}
                  </span>
                )}
                <div className="text-sm font-semibold mt-1">{s.label}</div>
                <div className="text-xs text-text-muted mt-1">{s.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced toggle */}
      <div>
        {!showAdvanced ? (
          <button
            onClick={() => setShowAdvanced(true)}
            className="text-xs text-text-muted hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <ChevronDown size={14} /> Custom resources
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-text-secondary">Custom Resources</label>
              <button
                onClick={() => setShowAdvanced(false)}
                className="text-xs text-text-muted hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <ChevronUp size={14} /> Presets
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-muted mb-1.5">CPU (millicores)</label>
                <input
                  value={customCpu}
                  onChange={(e) => setCustomCpu(e.target.value)}
                  type="number"
                  min={500}
                  className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
                />
              </div>
              <div>
                <label className="block text-sm text-text-muted mb-1.5">Memory (MiB)</label>
                <input
                  value={customMem}
                  onChange={(e) => setCustomMem(e.target.value)}
                  type="number"
                  min={256}
                  className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Start immediately */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <button
          type="button"
          role="checkbox"
          aria-checked={startImmediately}
          onClick={() => setStartImmediately(!startImmediately)}
          className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${
            startImmediately
              ? "bg-primary border-primary"
              : "bg-surface-low border-border-medium group-hover:border-border-strong"
          }`}
        >
          {startImmediately && <Check size={14} className="text-primary-foreground" />}
        </button>
        <span className="text-sm text-text-secondary group-hover:text-foreground transition-colors">
          Start immediately after creation
        </span>
      </label>

      {/* Budget remaining */}
      {budgetRemaining && (
        <div className="border border-border rounded-xl p-3 bg-surface-low/50">
          <p className="text-xs text-text-muted">
            Budget remaining: {budgetRemaining.agents} agent{budgetRemaining.agents !== 1 ? "s" : ""}{" "}
            · {formatCpu(budgetRemaining.cpu)} · {formatMemory(budgetRemaining.memory)}
          </p>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="border border-border rounded-xl p-6 bg-surface-low/50">
        <div className="flex flex-col items-center text-center mb-6">
          {renderAvatar("lg")}
          <p className="text-base font-medium text-foreground mt-4">
            {name || "Unnamed Agent"}
          </p>
          {description && (
            <p className="text-sm text-text-secondary mt-1 max-w-xs">{description}</p>
          )}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Size</span>
            <span className="text-foreground">
              {showAdvanced
                ? `${customCpuCores} CPU · ${customMemGb} GiB`
                : `${SIZES[selectedSize].label} (${SIZES[selectedSize].desc})`}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Start on creation</span>
            <span className="text-foreground">{startImmediately ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-xl border border-[#d05f5f]/20 bg-[#d05f5f]/10 px-4 py-3">
          <p className="text-sm text-[#d05f5f]">{error}</p>
        </div>
      )}
    </div>
  );

  const stepContent = [renderStep0, renderStep1, renderStep2];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative glass-card max-w-lg w-full mx-auto p-4 sm:p-6 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-surface-high transition-all z-10"
        >
          <X size={18} />
        </button>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === step ? "bg-foreground w-6" : "bg-text-muted"
              }`}
            />
          ))}
        </div>

        {/* Step title */}
        <div className="text-center mb-6">
          <h2 className="text-lg font-semibold text-foreground">
            {step === 0 && "Identity & Personality"}
            {step === 1 && "Configuration"}
            {step === 2 && "Review & Launch"}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {step === 0 && "Give your agent a name and personality"}
            {step === 1 && "Choose how powerful your agent should be"}
            {step === 2 && "Everything look good? Let's go."}
          </p>
        </div>

        {/* Step content with animation */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
            >
              {stepContent[step]()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Error display (shown on steps 0 and 1 too if file upload error) */}
        {error && step !== 2 && (
          <div className="rounded-xl border border-[#d05f5f]/20 bg-[#d05f5f]/10 px-4 py-3 mt-4">
            <p className="text-sm text-[#d05f5f]">{error}</p>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <div>
            {step > 0 && (
              <button
                onClick={goBack}
                disabled={creating}
                className="btn-secondary px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
          <div>
            {step < TOTAL_STEPS - 1 ? (
              <button
                onClick={goNext}
                disabled={!canProceed}
                className="btn-primary px-5 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="btn-primary px-6 py-2 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Agent"
                )}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
