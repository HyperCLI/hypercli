"use client";

import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import { Ban, CircleAlert, Ellipsis, KeyRound, ListFilter, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { cn } from "./ui/utils";
import { EmptyState, LoadingState } from "./patterns/feedback";
import { SlideOver } from "./patterns/slide-over";
import { formatDateTime } from "../utils/datetime";

const API_KEY_BASELINE_FAMILIES = [
  { key: "api", label: "API Keys", allowed: ["none", "self", "*"] },
  { key: "user", label: "Profile", allowed: ["none", "self", "*"] },
  { key: "agents", label: "Agents", allowed: ["none", "self", "*"] },
  { key: "flows", label: "Flows", allowed: ["none", "self", "*"] },
  { key: "jobs", label: "Jobs", allowed: ["none", "self", "*"] },
  { key: "files", label: "Files", allowed: ["none", "self", "*"] },
  { key: "renders", label: "Renders", allowed: ["none", "self", "*"] },
  { key: "models", label: "Models", allowed: ["none", "*"] },
  { key: "voice", label: "Voice", allowed: ["none", "*"] },
] as const;

type FamilyKey = (typeof API_KEY_BASELINE_FAMILIES)[number]["key"];
type BaselineValue = "none" | "self" | "*";
type AccessPreset = "full" | "scoped";
type ApiKeySourceFilter = "manual" | "agent" | "integration" | "system";
type ApiKeyUsageFilter = "today" | "seven-days" | "thirty-days" | "never";
type ApiKeyStatusFilter = "active" | "inactive" | "expired";
type ApiKeyPermissionFilter = "full" | "scoped";

const API_KEY_SOURCE_FILTERS: ReadonlyArray<{ value: ApiKeySourceFilter; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
  { value: "integration", label: "Integration" },
  { value: "system", label: "System" },
];

const API_KEY_USAGE_FILTERS: ReadonlyArray<{ value: ApiKeyUsageFilter; label: string }> = [
  { value: "today", label: "Used today" },
  { value: "seven-days", label: "Used in last 7 days" },
  { value: "thirty-days", label: "Used in last 30 days" },
  { value: "never", label: "Never used" },
];

const API_KEY_STATUS_FILTERS: ReadonlyArray<{ value: ApiKeyStatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
];

const API_KEY_PERMISSION_FILTERS: ReadonlyArray<{ value: ApiKeyPermissionFilter; label: string }> = [
  { value: "full", label: "Full access" },
  { value: "scoped", label: "Scoped access" },
];

const API_KEY_SCOPE_GROUPS: ReadonlyArray<{ label: string; keys: readonly FamilyKey[] }> = [
  { label: "Admin", keys: ["api", "user"] },
  { label: "Automation", keys: ["agents", "flows", "jobs"] },
  { label: "Assets", keys: ["files", "renders"] },
  { label: "AI", keys: ["models", "voice"] },
];

const BASELINE_LABELS: Record<BaselineValue, string> = {
  none: "None",
  self: "Self",
  "*": "All",
};

const FULL_ACCESS_TAG = "*:*";
const API_KEY_FILTER_INITIAL_REFERENCE_TIME = Date.now();

const SELECTOR_TAG_RE = /^[A-Za-z0-9_+-]+=[A-Za-z0-9_+-]+$/;
const RESERVED_RESOURCE_SCOPE_RE = /^(resource|job|render|flow|file|agent):[A-Za-z0-9_.+/-]+$/;

const DEFAULT_BASELINES = Object.fromEntries(
  API_KEY_BASELINE_FAMILIES.map(({ key }) => [key, "none"])
) as Record<FamilyKey, BaselineValue>;

export interface ApiKeysManagerProps {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  cardClassName?: string;
  createButtonClassName?: string;
  previewState?: "empty";
  onRequestProductUse?: () => boolean;
}

type ManagedApiKey = Awaited<ReturnType<BrowserHyperCLI["keys"]["get"]>>;

function normalizeApiUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  if (trimmed === "/api") return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

async function writeClipboardText(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall back below for browsers or contexts that expose the API but reject writes.
    }
  }

  return copyTextWithTextArea(text);
}

function copyTextWithTextArea(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function" || !document.body) {
    return false;
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const savedRanges: Range[] = [];

  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      savedRanges.forEach((range) => selection.addRange(range));
    }
    activeElement?.focus();
  }
}

function splitTagInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function validateSelectorTags(tags: string[]): string[] {
  const seenKeys = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    if (RESERVED_RESOURCE_SCOPE_RE.test(tag)) {
      const key = tag.split(":")[0]!;
      if (seenKeys.has(key)) {
        throw new Error(`Duplicate tag key '${key}'.`);
      }
      seenKeys.add(key);
      normalized.push(tag);
      continue;
    }

    if (!SELECTOR_TAG_RE.test(tag)) {
      throw new Error(
        `Invalid tag '${tag}'. Use key=value for your own tags or reserved exact scopes like agent:<uuid>.`
      );
    }
    const key = tag.split("=")[0]!;
    if (API_KEY_BASELINE_FAMILIES.some((family) => family.key === key)) {
      throw new Error(`Reserved family key '${key}' must use family:value baselines.`);
    }
    if (["resource", "job", "render", "flow", "file", "agent"].includes(key)) {
      throw new Error(`Reserved resource key '${key}' must use the reserved key:value scope format.`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate tag key '${key}'.`);
    }
    seenKeys.add(key);
    normalized.push(tag);
  }

  return normalized.sort();
}

function buildTags(
  accessPreset: AccessPreset,
  baselines: Record<FamilyKey, BaselineValue>,
  selectorInput: string
): string[] {
  if (accessPreset === "full") {
    return [FULL_ACCESS_TAG];
  }
  const tags = API_KEY_BASELINE_FAMILIES.flatMap(({ key }) =>
    baselines[key] === "none" ? [] : [`${key}:${baselines[key]}`]
  );
  const selectors = validateSelectorTags(splitTagInput(selectorInput));
  return [...tags, ...selectors];
}

function statusLabel(key: ManagedApiKey): string {
  return key.isActive ? "Active" : "Inactive";
}

function accessLabel(key: ManagedApiKey): string {
  if (key.tags.includes(FULL_ACCESS_TAG)) return "Full access";
  if (key.tags.length === 0) return "No access";
  return `${key.tags.length} permission${key.tags.length === 1 ? "" : "s"}`;
}

function keyPreview(key: ManagedApiKey): string {
  if (key.apiKeyPreview) return key.apiKeyPreview;
  if (key.last4) return `••••••••••••${key.last4}`;
  return key.keyId;
}

function keySource(key: ManagedApiKey): ApiKeySourceFilter {
  const metadata = key as ManagedApiKey & {
    source?: unknown;
    keySource?: unknown;
    createdVia?: unknown;
  };
  const candidate = [metadata.source, metadata.keySource, metadata.createdVia]
    .find((value): value is string => typeof value === "string")
    ?.trim()
    .toLowerCase();
  return API_KEY_SOURCE_FILTERS.some(({ value }) => value === candidate)
    ? candidate as ApiKeySourceFilter
    : "manual";
}

function keySourceLabel(key: ManagedApiKey): string {
  const source = keySource(key);
  return API_KEY_SOURCE_FILTERS.find(({ value }) => value === source)?.label ?? "Manual";
}

function keyIsExpired(key: ManagedApiKey, referenceTime: number): boolean {
  if (!key.expiresAt) return false;
  const expiresAt = new Date(key.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= referenceTime;
}

function keyLifecycleStatus(key: ManagedApiKey, referenceTime: number): ApiKeyStatusFilter {
  if (keyIsExpired(key, referenceTime)) return "expired";
  return key.isActive ? "active" : "inactive";
}

function keyMatchesUsage(key: ManagedApiKey, filter: ApiKeyUsageFilter, referenceTime: number): boolean {
  if (filter === "never") return !key.lastUsedAt;
  if (!key.lastUsedAt) return false;
  const lastUsedAt = new Date(key.lastUsedAt).getTime();
  if (!Number.isFinite(lastUsedAt)) return false;
  if (filter === "today") {
    const lastUsedDate = new Date(lastUsedAt);
    const referenceDate = new Date(referenceTime);
    return lastUsedDate.getFullYear() === referenceDate.getFullYear()
      && lastUsedDate.getMonth() === referenceDate.getMonth()
      && lastUsedDate.getDate() === referenceDate.getDate();
  }
  const elapsed = referenceTime - lastUsedAt;
  const windowDays = filter === "seven-days" ? 7 : 30;
  return elapsed >= 0 && elapsed <= windowDays * 24 * 60 * 60 * 1000;
}

function toggleFilterValue<T extends string>(current: T[], value: T, checked: boolean): T[] {
  if (checked) return current.includes(value) ? current : [...current, value];
  return current.filter((item) => item !== value);
}

export function ApiKeysManager({
  apiBaseUrl,
  getToken,
  emptyTitle = "Connect HyperCLI to your tools",
  emptyDescription = "API keys let apps, scripts, and integrations securely access HyperCLI. Create separate keys with scoped permissions for different use cases.",
  className,
  cardClassName = "overflow-hidden",
  createButtonClassName,
  previewState,
  onRequestProductUse,
}: ApiKeysManagerProps) {
  const [keys, setKeys] = useState<ManagedApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [accessPreset, setAccessPreset] = useState<AccessPreset>("full");
  const [baselines, setBaselines] = useState<Record<FamilyKey, BaselineValue>>(DEFAULT_BASELINES);
  const [createdKey, setCreatedKey] = useState<ManagedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [disableKeyId, setDisableKeyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterReferenceTime, setFilterReferenceTime] = useState(API_KEY_FILTER_INITIAL_REFERENCE_TIME);
  const [sourceFilters, setSourceFilters] = useState<ApiKeySourceFilter[]>([]);
  const [usageFilters, setUsageFilters] = useState<ApiKeyUsageFilter[]>([]);
  const [statusFilters, setStatusFilters] = useState<ApiKeyStatusFilter[]>([]);
  const [permissionFilters, setPermissionFilters] = useState<ApiKeyPermissionFilter[]>([]);
  const createFormId = useId();
  const keyNameInputId = useId();
  const scopedAccessId = useId();
  const createdKeyInputId = useId();
  const renameFormId = useId();
  const renameInputId = useId();
  const searchInputId = useId();

  const clientFactory = useCallback(async () => {
    const token = await getToken();
    return new BrowserHyperCLI({
      apiUrl: normalizeApiUrl(apiBaseUrl),
      token,
    });
  }, [apiBaseUrl, getToken]);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await clientFactory();
      setKeys(await client.keys.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [clientFactory]);

  useEffect(() => {
    if (previewState === "empty") return;
    void fetchKeys();
  }, [fetchKeys, previewState]);

  const resetCreateState = () => {
    setNewKeyName("");
    setAccessPreset("full");
    setBaselines(DEFAULT_BASELINES);
  };

  const openCreate = () => {
    setError(null);
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setError(null);
    resetCreateState();
  };

  const closeCreatedKey = () => {
    setCreatedKey(null);
    setCopied(false);
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setError("Please enter a key name.");
      return;
    }

    let tags: string[];
    try {
      tags = buildTags(accessPreset, baselines, "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid tag configuration");
      return;
    }

    if (tags.length === 0) {
      setError("Add at least one permission baseline or selector tag.");
      return;
    }
    if (onRequestProductUse && !onRequestProductUse()) return;

    setCreating(true);
    setError(null);
    try {
      const client = await clientFactory();
      const key = await client.keys.create(newKeyName.trim(), tags);
      setCreatedKey(key);
      setCopied(false);
      setShowCreate(false);
      resetCreateState();
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleDisable = async (keyId: string) => {
    setRevokingKeyId(keyId);
    setError(null);
    try {
      const client = await clientFactory();
      await client.keys.disable(keyId);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable API key");
    } finally {
      setRevokingKeyId(null);
      setDisableKeyId(null);
    }
  };

  const handleRename = async (keyId: string) => {
    if (!editName.trim()) {
      setError("Please enter a key name.");
      return;
    }
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSavingName(true);
    setError(null);
    try {
      const client = await clientFactory();
      await client.keys.rename(keyId, editName.trim());
      setEditingKeyId(null);
      setEditName("");
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename API key");
    } finally {
      setSavingName(false);
    }
  };

  const handleCopy = async (text: string) => {
    if (!text.trim()) {
      setError("No API key value is available to copy.");
      return;
    }

    const copiedToClipboard = await writeClipboardText(text);
    if (!copiedToClipboard) {
      setError("Could not copy the API key. Select the key and copy it manually.");
      return;
    }

    setError(null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const createdKeySecret = createdKey?.apiKey?.trim() || null;
  const showEmptyState = previewState === "empty" || (!loading && !error && keys.length === 0);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const selectedFilterCount = sourceFilters.length + usageFilters.length + statusFilters.length + permissionFilters.length;
  const visibleKeys = keys.filter((key) => {
    const status = keyLifecycleStatus(key, filterReferenceTime);
    const permission: ApiKeyPermissionFilter = key.tags.includes(FULL_ACCESS_TAG) ? "full" : "scoped";
    const matchesSource = sourceFilters.length === 0 || sourceFilters.includes(keySource(key));
    const matchesUsage = usageFilters.length === 0
      || usageFilters.some((filter) => keyMatchesUsage(key, filter, filterReferenceTime));
    const matchesStatus = statusFilters.length === 0 || statusFilters.includes(status);
    const matchesPermission = permissionFilters.length === 0 || permissionFilters.includes(permission);
    const matchesSearch = !normalizedSearch || [key.name, key.keyId, keyPreview(key), keySourceLabel(key), ...key.tags]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
    return matchesSource && matchesUsage && matchesStatus && matchesPermission && matchesSearch;
  });
  const showKeysList = !loading && !showEmptyState && keys.length > 0;

  return (
    <div className={cn("@container/api-keys min-w-0 w-full", className)}>
      {showKeysList ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Popover
              open={filterOpen}
              onOpenChange={(open) => {
                setFilterOpen(open);
                if (open) setFilterReferenceTime(Date.now());
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Filter API keys${selectedFilterCount > 0 ? `, ${selectedFilterCount} selected` : ""}`}
                  className="h-9 rounded-xl bg-surface-low px-2.5"
                >
                  <ListFilter className="size-4" />
                  {selectedFilterCount > 0 ? <span>({selectedFilterCount})</span> : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={8} className="w-64 overflow-hidden rounded-xl border-border bg-popover p-0">
                <div className="flex items-center justify-between px-4 pb-2 pt-4">
                  <h2 className="text-base font-medium text-foreground">Filter</h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Close filters"
                    onClick={() => setFilterOpen(false)}
                    className="size-7 rounded-lg text-text-muted"
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                <div className="max-h-[min(32rem,var(--radix-popover-content-available-height))] space-y-5 overflow-y-auto px-4 py-3">
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs text-text-muted">Source</legend>
                    {API_KEY_SOURCE_FILTERS.map((option) => {
                      const id = `${searchInputId}-source-${option.value}`;
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            checked={sourceFilters.includes(option.value)}
                            onCheckedChange={(checked) => setSourceFilters((current) => (
                              toggleFilterValue(current, option.value, checked === true)
                            ))}
                          />
                          <Label htmlFor={id} className="font-normal text-foreground">{option.label}</Label>
                        </div>
                      );
                    })}
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs text-text-muted">Usage</legend>
                    {API_KEY_USAGE_FILTERS.map((option) => {
                      const id = `${searchInputId}-usage-${option.value}`;
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            checked={usageFilters.includes(option.value)}
                            onCheckedChange={(checked) => setUsageFilters((current) => (
                              toggleFilterValue(current, option.value, checked === true)
                            ))}
                          />
                          <Label htmlFor={id} className="font-normal text-foreground">{option.label}</Label>
                        </div>
                      );
                    })}
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs text-text-muted">Status</legend>
                    {API_KEY_STATUS_FILTERS.map((option) => {
                      const id = `${searchInputId}-status-${option.value}`;
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            checked={statusFilters.includes(option.value)}
                            onCheckedChange={(checked) => setStatusFilters((current) => (
                              toggleFilterValue(current, option.value, checked === true)
                            ))}
                          />
                          <Label htmlFor={id} className="font-normal text-foreground">{option.label}</Label>
                        </div>
                      );
                    })}
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs text-text-muted">Permissions</legend>
                    {API_KEY_PERMISSION_FILTERS.map((option) => {
                      const id = `${searchInputId}-permission-${option.value}`;
                      return (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            checked={permissionFilters.includes(option.value)}
                            onCheckedChange={(checked) => setPermissionFilters((current) => (
                              toggleFilterValue(current, option.value, checked === true)
                            ))}
                          />
                          <Label htmlFor={id} className="font-normal text-foreground">{option.label}</Label>
                        </div>
                      );
                    })}
                  </fieldset>
                </div>

                <Separator />
                <div className="flex items-center justify-between bg-surface-low px-3 py-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selectedFilterCount === 0}
                    onClick={() => {
                      setSourceFilters([]);
                      setUsageFilters([]);
                      setStatusFilters([]);
                      setPermissionFilters([]);
                    }}
                  >
                    Clear all
                  </Button>
                  <Button type="button" size="sm" onClick={() => setFilterOpen(false)}>Done</Button>
                </div>
              </PopoverContent>
            </Popover>
            <Label htmlFor={searchInputId} className="sr-only">Search API keys</Label>
            <Input
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search key..."
              className="h-9 max-w-sm rounded-xl border-border bg-surface-low"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openCreate} className={cn("shrink-0", createButtonClassName)}>
            Create key
            <Plus className="size-4" />
          </Button>
        </div>
      ) : null}

      {error
        && previewState !== "empty"
        && !showCreate
        && editingKeyId === null
        && createdKey === null
        && disableKeyId === null ? (
        <Alert variant="destructive" className="mb-4 rounded-xl border-destructive/25 bg-destructive/10">
          <CircleAlert />
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className={cn(cardClassName, showKeysList && "bg-background")}>
        {showEmptyState ? (
          <EmptyState
            icon={KeyRound}
            title={emptyTitle}
            description={emptyDescription}
            actionLabel="Create API key"
            actionIcon={Plus}
            actionIconPosition="end"
            onAction={openCreate}
            presentation="prominent"
          />
        ) : loading ? (
          <LoadingState title="Loading API keys" className="min-h-72 flex-1" />
        ) : (
          <Table className="min-w-[40rem] table-fixed @min-[60rem]/api-keys:min-w-[60rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 px-4 text-xs font-medium text-foreground">Key ID</TableHead>
                <TableHead className="h-12 px-4 text-xs font-medium text-foreground">Name</TableHead>
                <TableHead className="hidden h-12 px-4 text-xs font-medium text-foreground @min-[60rem]/api-keys:table-cell">Source</TableHead>
                <TableHead className="h-12 px-4 text-xs font-medium text-foreground">Access</TableHead>
                <TableHead className="h-12 px-4 text-xs font-medium text-foreground">Status</TableHead>
                <TableHead className="hidden h-12 px-4 text-xs font-medium text-foreground @min-[60rem]/api-keys:table-cell">Created</TableHead>
                <TableHead className="h-12 px-4 text-xs font-medium text-foreground">Last Used</TableHead>
                <TableHead className="h-12 w-16 px-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleKeys.length > 0 ? visibleKeys.map((key) => {
                const lifecycleStatus = keyLifecycleStatus(key, filterReferenceTime);
                const lifecycleLabel = lifecycleStatus === "expired" ? "Expired" : statusLabel(key);
                const sourceLabel = keySourceLabel(key);
                const createdAtLabel = formatDateTime(key.createdAt);
                const lastUsedAtLabel = formatDateTime(key.lastUsedAt);
                return (
                  <TableRow key={key.keyId}>
                    <TableCell
                      title={keyPreview(key)}
                      className="max-w-52 truncate px-4 py-4 font-mono text-xs text-text-secondary"
                    >
                      {keyPreview(key)}
                    </TableCell>
                    <TableCell className="min-w-0 px-4 py-4 text-sm text-foreground">
                      <span className="block truncate" title={key.name}>{key.name}</span>
                      <span className="mt-1 block truncate text-xs text-text-muted @min-[60rem]/api-keys:hidden">
                        Source: {sourceLabel}
                      </span>
                    </TableCell>
                    <TableCell
                      title={sourceLabel}
                      className="hidden truncate px-4 py-4 text-sm text-text-secondary @min-[60rem]/api-keys:table-cell"
                    >
                      {sourceLabel}
                    </TableCell>
                    <TableCell className="overflow-hidden px-4 py-4">
                      <Badge variant="outline" className="max-w-full rounded-full bg-surface-low text-text-secondary">
                        {accessLabel(key)}
                      </Badge>
                    </TableCell>
                    <TableCell className="overflow-hidden px-4 py-4">
                      <Badge
                        variant={lifecycleStatus === "active" ? "active" : lifecycleStatus === "expired" ? "destructive" : "secondary"}
                        className="max-w-full rounded-full"
                      >
                        {lifecycleLabel}
                      </Badge>
                    </TableCell>
                    <TableCell
                      title={createdAtLabel}
                      className="hidden truncate px-4 py-4 text-sm text-text-secondary @min-[60rem]/api-keys:table-cell"
                    >
                      {createdAtLabel}
                    </TableCell>
                    <TableCell className="min-w-0 px-4 py-4 text-sm text-text-secondary">
                      <span className="block truncate" title={lastUsedAtLabel}>{lastUsedAtLabel}</span>
                      <span
                        title={`Created ${createdAtLabel}`}
                        className="mt-1 block truncate text-xs text-text-muted @min-[60rem]/api-keys:hidden"
                      >
                        Created {createdAtLabel}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`Actions for ${key.name}`}
                            className="size-8 rounded-xl bg-surface-low"
                          >
                            <Ellipsis className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-border">
                          <DropdownMenuItem
                            onSelect={() => {
                              setError(null);
                              setEditingKeyId(key.keyId);
                              setEditName(key.name);
                            }}
                          >
                            <Pencil />
                            Rename
                          </DropdownMenuItem>
                          {key.isActive ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={revokingKeyId === key.keyId}
                                onSelect={() => {
                                  setError(null);
                                  setDisableKeyId(key.keyId);
                                }}
                              >
                                <Ban />
                                Disable
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-24 px-4 text-center text-sm text-text-muted">
                    No API keys match your search and filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <SlideOver
        open={showCreate}
        onClose={closeCreate}
        title="Create API Key"
        icon={KeyRound}
        className="sm:max-w-[400px]"
        footer={(
          <>
            <Button type="button" variant="outline" size="sm" onClick={closeCreate} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" size="sm" form={createFormId} disabled={creating}>
              {creating ? "Creating..." : "Create Key"}
            </Button>
          </>
        )}
      >
        <form
          id={createFormId}
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={keyNameInputId} className="text-base text-foreground">Key Name</Label>
            <Input
              id={keyNameInputId}
              value={newKeyName}
              onChange={(event) => setNewKeyName(event.target.value)}
              placeholder="Enter key name"
              autoComplete="off"
              className="h-10 rounded-xl border-border bg-surface-low"
              disabled={creating}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between gap-4 py-1">
            <Label htmlFor={scopedAccessId} className="text-base text-foreground">Scoped Access</Label>
            <Switch
              id={scopedAccessId}
              checked={accessPreset === "scoped"}
              onCheckedChange={(checked) => setAccessPreset(checked ? "scoped" : "full")}
              disabled={creating}
            />
          </div>

          {error ? (
            <Alert variant="destructive" className="rounded-xl border-destructive/25 bg-destructive/10 px-4 py-4">
              <CircleAlert />
              <AlertDescription className="text-sm font-medium leading-5 text-destructive">{error}</AlertDescription>
            </Alert>
          ) : null}

          {accessPreset === "full" ? (
            <Alert variant="destructive" className="rounded-xl border-destructive/25 bg-destructive/10 px-4 py-4">
              <CircleAlert />
              <AlertDescription className="text-sm font-medium leading-5 text-destructive">
                This key can access everything your account can. Limit permissions to reduce risk if the key is exposed.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-7 pt-1">
              {API_KEY_SCOPE_GROUPS.map((group) => (
                <section key={group.label}>
                  <h3 className="text-xs font-medium text-text-muted">{group.label}</h3>
                  <div className="mt-2 space-y-1">
                    {API_KEY_BASELINE_FAMILIES.filter(({ key }) => group.keys.includes(key)).map(({ key, label, allowed }) => (
                      <div key={key} className="flex min-h-10 items-center justify-between gap-4">
                        <span className="text-base text-foreground">{label}</span>
                        <ToggleGroup
                          type="single"
                          value={baselines[key]}
                          onValueChange={(value) => {
                            if (!value) return;
                            setBaselines((current) => ({ ...current, [key]: value as BaselineValue }));
                          }}
                          disabled={creating}
                          aria-label={`${label} access`}
                          className="rounded-xl bg-surface-high p-1"
                        >
                          {allowed.map((value) => (
                            <ToggleGroupItem
                              key={value}
                              value={value}
                              aria-label={`${label}: ${BASELINE_LABELS[value]}`}
                              className="h-6 min-w-14 rounded-lg px-3 text-sm text-text-muted hover:bg-transparent hover:text-foreground data-[state=on]:border data-[state=on]:border-border-strong data-[state=on]:bg-surface-medium data-[state=on]:text-foreground"
                            >
                              {BASELINE_LABELS[value]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </form>
      </SlideOver>

      <Dialog open={createdKey !== null} onOpenChange={(open) => !open && closeCreatedKey()}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 sm:max-w-lg">
          <div className="px-4 pb-4 pt-5 sm:px-5 sm:pb-5">
            <DialogHeader>
              <DialogTitle className="text-2xl font-medium leading-tight text-foreground">API key created</DialogTitle>
              <DialogDescription className="sr-only">
                Copy this API key before closing the window.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor={createdKeyInputId} className="text-base text-foreground">API key</Label>
                <Input
                  id={createdKeyInputId}
                  value={createdKeySecret ?? ""}
                  readOnly
                  aria-invalid={!createdKeySecret}
                  className="h-10 select-all rounded-xl border-border bg-surface-low text-base"
                />
                <p className="text-sm leading-5 text-text-muted">
                  {createdKeySecret
                    ? "Store this key somewhere secure. Treat it like a password."
                    : "The key was created, but the secret was not returned."}
                </p>
              </div>

              <Alert
                variant={createdKeySecret ? "default" : "destructive"}
                className="rounded-xl border-border bg-transparent px-4 py-4"
              >
                <CircleAlert />
                <AlertDescription className="text-sm font-medium leading-5 text-foreground">
                  {createdKeySecret
                    ? "Copy your API key now. You won’t be able to view it again after closing this window."
                    : "Disable this key and create a new one before continuing."}
                </AlertDescription>
              </Alert>
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-surface-low px-4 py-4 sm:px-5">
            <Button type="button" variant="outline" size="sm" onClick={closeCreatedKey}>Close</Button>
            <Button
              type="button"
              size="sm"
              onClick={() => createdKeySecret && void handleCopy(createdKeySecret)}
              disabled={!createdKeySecret}
            >
              {copied ? "Copied" : "Copy API key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingKeyId !== null}
        onOpenChange={(open) => {
          if (!open && !savingName) {
            setEditingKeyId(null);
            setEditName("");
            setError(null);
          }
        }}
      >
        <DialogContent className="rounded-2xl border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename API key</DialogTitle>
            <DialogDescription>Choose a name that identifies where this key is used.</DialogDescription>
          </DialogHeader>
          <form
            id={renameFormId}
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (editingKeyId) void handleRename(editingKeyId);
            }}
          >
            <Label htmlFor={renameInputId}>Key name</Label>
            <Input
              id={renameInputId}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              disabled={savingName}
              autoFocus
            />
          </form>
          {error ? (
            <Alert variant="destructive" className="rounded-xl border-destructive/25 bg-destructive/10">
              <CircleAlert />
              <AlertDescription className="text-destructive">{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingKeyId(null);
                setEditName("");
                setError(null);
              }}
              disabled={savingName}
            >
              Cancel
            </Button>
            <Button type="submit" form={renameFormId} disabled={savingName}>
              {savingName ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableKeyId !== null}
        onOpenChange={(open) => {
          if (!open && !revokingKeyId) setDisableKeyId(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-border bg-card sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This key will stop working immediately and cannot be enabled again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(revokingKeyId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disableKeyId && void handleDisable(disableKeyId)}
              disabled={Boolean(revokingKeyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokingKeyId ? "Disabling..." : "Disable key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ApiKeysManager;
