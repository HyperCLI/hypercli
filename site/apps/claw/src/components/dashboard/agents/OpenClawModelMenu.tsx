"use client";

import React from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@hypercli/shared-ui";

import {
  getOpenClawDefaultModel,
  normalizeOpenClawModelOptions,
} from "@/lib/openclaw-models";

interface OpenClawModelMenuSession {
  activeSessionModel: string | null;
  activeSessionThinkingLevel: string | null;
  activeSessionThinkingLevels: Array<{ id: string; label: string }>;
  activeSessionThinkingDefault: string | null;
  config: Record<string, unknown> | null;
  models: Array<Record<string, unknown>>;
  setActiveSessionModel: (model: string) => Promise<void>;
  setActiveSessionThinkingLevel: (thinkingLevel: string) => Promise<void>;
}

interface OpenClawModelMenuProps {
  chat: OpenClawModelMenuSession;
  disabled?: boolean;
  compactTrigger?: boolean;
  onSelectionComplete?: () => void;
  onRequestProductUse?: () => boolean;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function titleizeVariant(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayModelName(option: ReturnType<typeof normalizeOpenClawModelOptions>[number]): string {
  const providerSuffix = option.detail ? ` (${option.detail})` : "";
  return providerSuffix && option.label.endsWith(providerSuffix)
    ? option.label.slice(0, -providerSuffix.length)
    : option.label;
}

function thinkingLevelLabel(option: { id: string; label: string } | undefined, fallback: string): string {
  return option?.label.trim() || (fallback ? titleizeVariant(fallback) : "");
}

export function OpenClawModelMenu({ chat, disabled = false, compactTrigger = false, onSelectionComplete, onRequestProductUse }: OpenClawModelMenuProps) {
  const menuContentId = React.useId();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [selectingModel, setSelectingModel] = React.useState<string | null>(null);
  const [selectingVariant, setSelectingVariant] = React.useState<string | null>(null);
  const [selectionError, setSelectionError] = React.useState<string | null>(null);

  const defaultModel = getOpenClawDefaultModel(chat.config);
  const currentModel = chat.activeSessionModel || defaultModel;
  const modelOptions = React.useMemo(
    () => normalizeOpenClawModelOptions(chat.config, chat.models, currentModel),
    [chat.config, chat.models, currentModel],
  );
  const currentOption = modelOptions.find((option) => option.value === currentModel);
  const triggerLabel = currentOption ? displayModelName(currentOption) : currentModel || "Choose model";
  const activeVariantId = chat.activeSessionThinkingLevel || chat.activeSessionThinkingDefault || "";
  const activeVariant = chat.activeSessionThinkingLevels.find((option) => option.id === activeVariantId);
  const triggerVariant = thinkingLevelLabel(activeVariant, activeVariantId);
  const compactTriggerLabel = triggerVariant || "Variant";
  const triggerAriaLabel = compactTrigger
    ? triggerVariant
      ? `Variant: ${triggerVariant}, model: ${triggerLabel}`
      : `Choose variant, model: ${triggerLabel}`
    : `Model: ${triggerLabel}`;

  const selectModel = async (model: string) => {
    if (selectingModel || selectingVariant) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSelectingModel(model);
    setSelectionError(null);
    try {
      await chat.setActiveSessionModel(model);
      setMenuOpen(false);
      onSelectionComplete?.();
    } catch (cause) {
      setSelectionError(errorMessage(cause, "Unable to change the conversation model."));
    } finally {
      setSelectingModel(null);
    }
  };

  const selectVariant = async (thinkingLevel: string) => {
    if (selectingModel || selectingVariant) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSelectingVariant(thinkingLevel);
    setSelectionError(null);
    try {
      await chat.setActiveSessionThinkingLevel(thinkingLevel);
      setMenuOpen(false);
      onSelectionComplete?.();
    } catch (cause) {
      setSelectionError(errorMessage(cause, "Unable to change the conversation variant."));
    } finally {
      setSelectingVariant(null);
    }
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) setSelectionError(null);
      }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={triggerAriaLabel}
            aria-controls={menuOpen ? menuContentId : undefined}
            title={compactTrigger
              ? triggerVariant ? `${triggerVariant} variant, ${triggerLabel}` : `Choose variant for ${triggerLabel}`
              : triggerLabel}
            className={`flex h-8 items-center justify-start gap-1.5 rounded-lg px-2 text-left transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-40 ${compactTrigger ? "max-w-20 bg-surface-high" : "max-w-24"}`}
          >
            <span className={`min-w-0 truncate text-[12px] font-semibold ${compactTrigger && triggerVariant ? "text-text-secondary" : "text-foreground"}`}>
              {compactTrigger ? compactTriggerLabel : triggerLabel}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          id={menuContentId}
          side="top"
          align="start"
          sideOffset={8}
          aria-label="Choose conversation model"
          className="z-[70] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border-border bg-popover p-0 shadow-2xl"
        >
          <Command label="Choose conversation model">
            <CommandList className="max-h-72 p-1.5">
              {chat.activeSessionThinkingLevels.length > 0 ? (
                <>
                  <CommandGroup heading="Variants" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em]">
                    {chat.activeSessionThinkingLevels.map((option) => {
                      const selected = option.id === activeVariantId;
                      const pending = option.id === selectingVariant;
                      const label = thinkingLevelLabel(option, option.id);
                      return (
                        <CommandItem
                          key={option.id}
                          aria-label={`Variant: ${label}${selected ? ", current" : ""}`}
                          value={`variant ${label} ${option.id}`}
                      disabled={Boolean(selectingModel || selectingVariant)}
                      onSelect={() => { void selectVariant(option.id); }}
                          className={`rounded-lg px-2.5 py-2 data-[selected=true]:!bg-surface-high data-[selected=true]:!text-foreground ${selected ? "bg-surface-low ring-1 ring-inset ring-border" : ""}`}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-muted">{label}</span>
                          {pending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" /> : null}
                          {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-foreground" /> : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandSeparator className="my-1" />
                </>
              ) : null}
              <CommandGroup heading="Models" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em]">
                {modelOptions.map((option) => {
                  const selected = option.value === currentModel;
                  const pending = option.value === selectingModel;
                  const optionLabel = displayModelName(option);
                  return (
                    <CommandItem
                      key={option.value}
                      aria-label={`${option.label}${selected ? ", current" : ""}`}
                      value={`${optionLabel} ${option.label} ${option.value} ${option.detail ?? ""}`}
                      disabled={Boolean(selectingModel || selectingVariant)}
                      onSelect={() => { void selectModel(option.value); }}
                      className={`items-start rounded-lg px-2.5 py-2.5 data-[selected=true]:!bg-surface-high data-[selected=true]:!text-foreground ${selected ? "bg-surface-low ring-1 ring-inset ring-border" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-semibold ${selected ? "text-foreground" : "text-text-secondary"}`}>{optionLabel}</span>
                        <span className="block truncate font-mono text-[10px] leading-4 text-text-muted">{option.value}</span>
                      </span>
                      {pending ? <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" /> : null}
                      {selected ? <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {selectionError ? (
            <div role="alert" className="border-t border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] leading-4 text-destructive">
              {selectionError}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}
