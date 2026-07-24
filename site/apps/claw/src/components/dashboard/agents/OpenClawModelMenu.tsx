"use client";

import React from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import {
  Button,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hypercli/shared-ui";

import {
  buildOpenClawModelUpsertPatch,
  getOpenClawDefaultModel,
  normalizeOpenClawConfiguredProviders,
  normalizeOpenClawModelOptions,
} from "@/lib/openclaw-models";

interface OpenClawModelMenuSession {
  activeSessionModel: string | null;
  activeSessionThinkingLevel: string | null;
  activeSessionThinkingLevels: Array<{ id: string; label: string }>;
  activeSessionThinkingDefault: string | null;
  config: Record<string, unknown> | null;
  models: Array<Record<string, unknown>>;
  saveConfig: (patch: Record<string, unknown>) => Promise<void>;
  setActiveSessionModel: (model: string) => Promise<void>;
  setActiveSessionThinkingLevel: (thinkingLevel: string) => Promise<void>;
}

interface OpenClawModelMenuProps {
  chat: OpenClawModelMenuSession;
  disabled?: boolean;
  onOpenSettings?: () => void;
  onSelectionComplete?: () => void;
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

export function OpenClawModelMenu({ chat, disabled = false, onOpenSettings, onSelectionComplete }: OpenClawModelMenuProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [providerValue, setProviderValue] = React.useState("");
  const [modelValue, setModelValue] = React.useState("");
  const [selectingModel, setSelectingModel] = React.useState<string | null>(null);
  const [selectingVariant, setSelectingVariant] = React.useState<string | null>(null);
  const [addingModel, setAddingModel] = React.useState(false);
  const [selectionError, setSelectionError] = React.useState<string | null>(null);
  const [addError, setAddError] = React.useState<string | null>(null);

  const defaultModel = getOpenClawDefaultModel(chat.config);
  const currentModel = chat.activeSessionModel || defaultModel;
  const modelOptions = React.useMemo(
    () => normalizeOpenClawModelOptions(chat.config, chat.models, currentModel),
    [chat.config, chat.models, currentModel],
  );
  const providerOptions = React.useMemo(
    () => normalizeOpenClawConfiguredProviders(chat.config),
    [chat.config],
  );
  const resolvedProviderValue = providerOptions.some((provider) => provider.value === providerValue)
    ? providerValue
    : providerOptions[0]?.value ?? "";
  const currentOption = modelOptions.find((option) => option.value === currentModel);
  const triggerLabel = currentOption ? displayModelName(currentOption) : currentModel || "Choose model";
  const activeVariantId = chat.activeSessionThinkingLevel || chat.activeSessionThinkingDefault || "";
  const activeVariant = chat.activeSessionThinkingLevels.find((option) => option.id === activeVariantId);
  const triggerVariant = thinkingLevelLabel(activeVariant, activeVariantId);

  const selectModel = async (model: string) => {
    if (selectingModel || selectingVariant || addingModel) return;
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
    if (selectingModel || selectingVariant || addingModel) return;
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

  const openAddDialog = () => {
    setMenuOpen(false);
    setSelectionError(null);
    setAddError(null);
    setModelValue("");
    setProviderValue((current) => providerOptions.some((provider) => provider.value === current)
      ? current
      : providerOptions[0]?.value ?? "");
    setAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    if (addingModel) return;
    setAddDialogOpen(false);
    setAddError(null);
  };

  const addModel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (addingModel) return;
    setAddingModel(true);
    setAddError(null);

    const providerId = resolvedProviderValue.trim();
    const modelId = modelValue.trim();
    let configuredModel = "";
    try {
      const patch = buildOpenClawModelUpsertPatch(chat.config, providerId, modelId);
      configuredModel = `${providerId}/${modelId}`;
      await chat.saveConfig(patch);
    } catch (cause) {
      setAddError(errorMessage(cause, "Unable to add the model."));
      setAddingModel(false);
      return;
    }

    try {
      await chat.setActiveSessionModel(configuredModel);
      setAddDialogOpen(false);
      setModelValue("");
      onSelectionComplete?.();
    } catch (cause) {
      setAddDialogOpen(false);
      setSelectionError(`Model added, but it could not be selected: ${errorMessage(cause, "Unknown error")}`);
      setMenuOpen(true);
    } finally {
      setAddingModel(false);
    }
  };

  const openProviderSettings = () => {
    setAddDialogOpen(false);
    onOpenSettings?.();
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
            aria-label={triggerVariant ? `Model: ${triggerLabel}, ${triggerVariant}` : `Model: ${triggerLabel}`}
            className="flex h-8 max-w-24 items-center justify-start gap-1.5 rounded-lg px-2 text-left transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-40 sm:max-w-40"
          >
            <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{triggerLabel}</span>
            {triggerVariant ? <span className="hidden shrink-0 text-[12px] font-medium text-text-muted sm:inline">{triggerVariant}</span> : null}
            <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent
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
                          disabled={Boolean(selectingModel || selectingVariant || addingModel)}
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
                      disabled={Boolean(selectingModel || selectingVariant || addingModel)}
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
              <CommandSeparator className="my-1" />
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value="add new model"
                  onSelect={openAddDialog}
                  className="rounded-lg px-2.5 py-2 text-xs font-medium text-foreground"
                >
                  <Plus className="h-3.5 w-3.5 text-text-muted" />
                  Add new model
                </CommandItem>
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

      <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) closeAddDialog(); }}>
        <DialogContent
          closeLabel="Close add model"
          overlayClassName="z-[79] bg-background/70 backdrop-blur-sm"
          className="z-[80] gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[500px]"
        >
          <DialogHeader className="gap-0 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-base text-foreground">Add model</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-relaxed text-text-muted">
              Add a model to a configured provider and use it in this conversation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(event) => { void addModel(event); }}>
            <div className="space-y-4 px-5 py-5">
              {providerOptions.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Model ID</span>
                    <input
                      autoFocus
                      value={modelValue}
                      onChange={(event) => setModelValue(event.target.value)}
                      disabled={addingModel}
                      placeholder="claude-sonnet-4-5"
                      spellCheck={false}
                      className="h-10 w-full rounded-xl border border-border bg-surface-low/35 px-3 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-text-muted focus:border-foreground/50 disabled:opacity-55"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Provider</span>
                    <Select value={resolvedProviderValue} onValueChange={setProviderValue} disabled={addingModel}>
                      <SelectTrigger aria-label="Model provider" className="h-10 w-full rounded-xl border-border bg-surface-low/35 text-xs">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providerOptions.map((provider) => (
                          <SelectItem key={provider.value} value={provider.value} className="text-xs">
                            {provider.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-surface-low/35 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">No model provider configured</p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">Configure a provider before adding custom models.</p>
                  {onOpenSettings ? (
                    <button type="button" onClick={openProviderSettings} className="mt-3 text-xs font-semibold text-foreground hover:underline">
                      Open model provider settings
                    </button>
                  ) : null}
                </div>
              )}

              {addError ? (
                <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                  {addError}
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-t border-border px-5 py-4">
              <Button type="button" variant="outline" size="sm" onClick={closeAddDialog} disabled={addingModel}>Cancel</Button>
              <Button type="submit" size="sm" disabled={providerOptions.length === 0 || !resolvedProviderValue || !modelValue.trim() || addingModel}>
                {addingModel ? <Loader2 className="animate-spin" /> : <Plus />}
                Add model
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
