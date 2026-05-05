"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import {
  Bot, Brain, Cat, Crown, Dog, Eye, Flame, Globe, Heart, Leaf,
  Moon, Rocket, Shield, Sparkles, Star, Zap,
  X, ChevronLeft, ChevronRight, Loader2, Upload, Check,
  type LucideIcon,
} from "lucide-react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient, createOpenClawAgent } from "@/lib/agent-client";
import { formatTokens, type SlotInventory } from "@/lib/format";

// ── Types ──

interface AgentCreationWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: (agentId?: string) => void;
  initialStep?: number;
  preferredTypeId?: string | null;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
}

interface AgentTypePreset {
  id: string;
  name: string;
  cpu: number;
  memory: number;
  cpu_limit: number;
  memory_limit: number;
}

interface AgentTypePlan {
  id: string;
  name: string;
  price: number;
  agents: number;
  agent_type: string;
  highlighted: boolean;
}

interface AgentTypeCatalogResponse {
  types: AgentTypePreset[];
  plans: AgentTypePlan[];
}

interface LaunchSourceOption {
  id: string;
  label: string;
  planName: string;
  tierIds: string[];
  slotSummary: string;
  inferenceOnly: boolean;
  availableCount: number;
  statusLabel: string;
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

const FALLBACK_TYPES: AgentTypePreset[] = [
  { id: "small", name: "Small", cpu: 1, memory: 1, cpu_limit: 1, memory_limit: 1 },
  { id: "medium", name: "Medium", cpu: 2, memory: 2, cpu_limit: 2, memory_limit: 2 },
  { id: "large", name: "Large", cpu: 4, memory: 4, cpu_limit: 4, memory_limit: 4 },
];
const TYPE_ORDER = ["small", "medium", "large"];

const TOTAL_STEPS = 3;
const FIRST_AGENT_SETUP_DRAFT_KEY = "hypercli-first-agent-draft";

interface FirstAgentSetupDraft {
  name?: unknown;
  description?: unknown;
  size?: unknown;
  iconIndex?: unknown;
}

function readFirstAgentSetupDraft(): FirstAgentSetupDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FIRST_AGENT_SETUP_DRAFT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(FIRST_AGENT_SETUP_DRAFT_KEY);
    const parsed = JSON.parse(raw) as FirstAgentSetupDraft;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

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

export function AgentCreationWizard({
  open,
  onClose,
  onCreated,
  initialStep = 0,
  preferredTypeId = null,
  budget,
  subscriptionSummary = null,
}: AgentCreationWizardProps) {
  const { getToken } = useAgentAuth();

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
  const [selectedTypeId, setSelectedTypeId] = useState("large");
  const [selectedLaunchSourceId, setSelectedLaunchSourceId] = useState<string | null>(null);
  const [startImmediately, setStartImmediately] = useState(true);
  const [typeCatalog, setTypeCatalog] = useState<AgentTypeCatalogResponse | null>(null);

  // Step 3: Creating state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived
  const currentHue = HUES[selectedIcon];
  const CurrentIcon = ICONS[selectedIcon].icon;
  const sizeOptions = [...(typeCatalog?.types || FALLBACK_TYPES)].sort((a, b) => {
    const aIndex = TYPE_ORDER.indexOf(a.id);
    const bIndex = TYPE_ORDER.indexOf(b.id);
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
  const selectedType = sizeOptions.find((option) => option.id === selectedTypeId) || sizeOptions[0] || FALLBACK_TYPES[2];
  const slotInventory = budget?.slots ?? {};
  const selectedAvailability = slotInventory[selectedType.id]?.available ?? 0;
  const totalAvailableSlots = Object.values(slotInventory).reduce((sum, entry) => sum + Math.max(0, entry.available), 0);
  const activeSubscriptions = subscriptionSummary?.activeSubscriptions ?? [];
  const launchSources: LaunchSourceOption[] = activeSubscriptions.map((subscription) => {
    const slotGrants = subscription.slotGrants ?? {};
    const tierIds = Object.entries(slotGrants)
      .filter(([, granted]) => Math.max(Number(granted || 0), 0) > 0)
      .map(([tier]) => tier)
      .sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
    const slotSummary = tierIds.length > 0
      ? tierIds
          .map((tier) => `${Math.max(Number(slotGrants[tier] || 0), 0)} ${tier}`)
          .join(" + ")
      : "No launchable slots";
    const inferenceOnly = tierIds.length === 0;
    const availableCount = tierIds.reduce((sum, tier) => sum + Math.max(slotInventory[tier]?.available ?? 0, 0), 0);
    const statusLabel = inferenceOnly
      ? "Inference only"
      : availableCount > 0
        ? `${availableCount} launchable slot${availableCount === 1 ? "" : "s"}`
        : "No free slots";
    return {
      id: subscription.id,
      label: subscription.planName || subscription.planId,
      planName: subscription.planName || subscription.planId,
      tierIds,
      slotSummary,
      inferenceOnly,
      availableCount,
      statusLabel,
    };
  });
  const launchableSources = launchSources.filter((source) => !source.inferenceOnly);
  const selectedLaunchSource = launchSources.find((source) => source.id === selectedLaunchSourceId) ?? null;

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
      const draft = readFirstAgentSetupDraft();
      const safeInitialStep = Math.max(0, Math.min(TOTAL_STEPS - 1, initialStep));
      setStep(safeInitialStep);
      setDirection(0);
      setName(typeof draft?.name === "string" ? draft.name : "");
      setSelectedIcon(
        typeof draft?.iconIndex === "number"
          ? Math.max(0, Math.min(ICONS.length - 1, draft.iconIndex))
          : 0,
      );
      setCustomAvatar(null);
      setDescription(typeof draft?.description === "string" ? draft.description : "");
      setSelectedTypeId(
        preferredTypeId ||
        (typeof draft?.size === "string" ? draft.size : null) ||
        "large",
      );
      setSelectedLaunchSourceId(null);
      setStartImmediately(true);
      setCreating(false);
      setError(null);
    }
  }, [open, initialStep, preferredTypeId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadTypeCatalog = async () => {
      try {
        const token = await getToken();
        const catalogResponse = await createHyperAgentClient(token).agentTypes();
        if (cancelled) return;
        setTypeCatalog(catalogResponse as unknown as AgentTypeCatalogResponse);
      } catch {
        if (!cancelled) {
          setTypeCatalog(null);
        }
      }
    };

    void loadTypeCatalog();
    return () => {
      cancelled = true;
    };
  }, [getToken, open]);

  useEffect(() => {
    if (!open || sizeOptions.length === 0) return;
    if ((slotInventory[selectedTypeId]?.available ?? 0) > 0) return;
    const nextAvailable = sizeOptions.find((option) => (slotInventory[option.id]?.available ?? 0) > 0);
    if (nextAvailable) {
      setSelectedTypeId(nextAvailable.id);
    } else if (sizeOptions[0]) {
      setSelectedTypeId(sizeOptions[0].id);
    }
  }, [open, selectedTypeId, sizeOptions, slotInventory]);

  useEffect(() => {
    if (!open) return;
    if (launchSources.length === 0) {
      setSelectedLaunchSourceId(null);
      return;
    }
    const existing = launchSources.find((source) => source.id === selectedLaunchSourceId);
    if (existing && (existing.inferenceOnly || existing.tierIds.includes(selectedTypeId))) {
      return;
    }
    const preferredSource =
      launchableSources.find((source) => source.tierIds.includes(selectedTypeId)) ||
      launchableSources[0] ||
      launchSources[0];
    setSelectedLaunchSourceId(preferredSource?.id ?? null);
  }, [launchSources, launchableSources, open, selectedLaunchSourceId, selectedTypeId]);

  useEffect(() => {
    if (!open || !selectedLaunchSource || selectedLaunchSource.inferenceOnly) return;
    if (selectedLaunchSource.tierIds.includes(selectedTypeId) && (slotInventory[selectedTypeId]?.available ?? 0) > 0) {
      return;
    }
    const matchingTier = selectedLaunchSource.tierIds.find((tier) => (slotInventory[tier]?.available ?? 0) > 0);
    if (matchingTier) {
      setSelectedTypeId(matchingTier);
    }
  }, [open, selectedLaunchSource, selectedTypeId, slotInventory]);

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
      const created = await createOpenClawAgent(token, {
        name: name.trim() || undefined,
        start: startImmediately,
        size: selectedType.id,
        meta: {
          ui: {
            avatar: {
              image: customAvatar,
              icon_index: selectedIcon,
            },
          },
        },
      });
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  // ── Validation ──

  const canProceed = step === 1 ? !budget || selectedAvailability > 0 : true;

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
      {launchSources.length > 0 && (
        <div>
          <label className="block text-sm text-text-secondary mb-3">Launch from existing plan</label>
          <div className="space-y-2">
            {launchSources.map((source) => {
              const isSelected = source.id === selectedLaunchSourceId;
              const isSelectable = !source.inferenceOnly;
              return (
                <button
                  key={source.id}
                  type="button"
                  disabled={!isSelectable}
                  onClick={() => {
                    if (!isSelectable) return;
                    setSelectedLaunchSourceId(source.id);
                    const nextTier = source.tierIds.find((tier) => (slotInventory[tier]?.available ?? 0) > 0) || source.tierIds[0];
                    if (nextTier) setSelectedTypeId(nextTier);
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    !isSelectable
                      ? "opacity-50 cursor-not-allowed border-border bg-surface-low text-text-secondary"
                      : isSelected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-surface-low text-text-secondary hover:border-text-muted"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{source.label}</div>
                      <div className="mt-1 text-xs text-text-muted">{source.slotSummary}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-secondary">
                      {source.statusLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Legacy plans without slot grants still add inference capacity, but only slot-backed plans can launch agents here.
          </p>
        </div>
      )}

      {/* Size picker */}
      <div>
        <label className="block text-sm text-text-secondary mb-3">Size</label>
        <div className="grid grid-cols-3 gap-3">
          {sizeOptions.map((option) => {
            const availability = slotInventory[option.id]?.available ?? 0;
            const granted = slotInventory[option.id]?.granted ?? 0;
            const sourceAllowsTier = !selectedLaunchSource || selectedLaunchSource.inferenceOnly || selectedLaunchSource.tierIds.length === 0
              ? true
              : selectedLaunchSource.tierIds.includes(option.id);
            const isSelectable = (!budget || availability > 0) && sourceAllowsTier;
            const isSelected = selectedType.id === option.id;
            return (
              <button
                key={option.id}
                disabled={!isSelectable}
                onClick={() => {
                  if (!isSelectable) return;
                  setSelectedTypeId(option.id);
                }}
                className={`relative p-4 rounded-xl border text-center transition-all ${
                  !isSelectable
                    ? "opacity-40 cursor-not-allowed border-border bg-surface-low text-text-secondary"
                    : isSelected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-surface-low text-text-secondary hover:border-text-muted"
                }`}
              >
                <div className="text-sm font-semibold">{option.name}</div>
                <div className="text-xs text-text-muted mt-1">
                  {option.cpu} vCPU · {option.memory} GiB
                </div>
                {selectedLaunchSource && !selectedLaunchSource.inferenceOnly && !selectedLaunchSource.tierIds.includes(option.id) && (
                  <div className="text-[11px] text-text-muted mt-2">Not granted by selected plan</div>
                )}
                {budget && (
                  <div className="text-[11px] text-text-muted mt-2">
                    {availability} free / {granted} total
                  </div>
                )}
              </button>
            );
          })}
        </div>
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

      {budget && (
        <div className="border border-border rounded-xl p-3 bg-surface-low/50">
          <p className="text-xs text-text-muted mb-2">
            Pooled inference: {formatTokens(budget.pooled_tpd)} tokens/day
          </p>
          <div className="space-y-1.5">
            {sizeOptions.map((option) => {
              const entry = slotInventory[option.id];
              return (
                <div key={option.id} className="flex items-center justify-between text-xs text-text-secondary">
                  <span>{option.name}</span>
                  <span>
                    {(entry?.available ?? 0)} free / {(entry?.granted ?? 0)} total
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {budget && totalAvailableSlots === 0 && (
        <div className="border border-[#d05f5f]/20 rounded-xl p-3 bg-[#d05f5f]/10">
          <p className="text-sm text-[#d05f5f] mb-2">No agent slots are available right now.</p>
          <button
            type="button"
            onClick={() => window.location.assign("/plans")}
            className="text-xs text-foreground underline underline-offset-4"
          >
            Buy another agent bundle
          </button>
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
              {selectedType.name} ({selectedType.cpu} vCPU · {selectedType.memory} GiB)
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Start on creation</span>
            <span className="text-foreground">{startImmediately ? "Yes" : "No"}</span>
          </div>
          {budget && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Slots remaining</span>
              <span className="text-foreground">{selectedAvailability}</span>
            </div>
          )}
          {selectedLaunchSource && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Launch source</span>
              <span className="text-foreground">{selectedLaunchSource.planName}</span>
            </div>
          )}
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
