"use client";

import type { ReactNode } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  describeOpenClawConfigNode,
  normalizeOpenClawConfigSchemaNode,
  type OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";

import type { JsonObject } from "@/app/dashboard/agents/types";
import {
  getOpenClawUiHint,
  getPathValue,
  humanizeKey,
  sortOpenClawEntries,
} from "@/lib/openclaw-config";

export const INITIAL_DYNAMIC_ENTRY_LIMIT = 20;

interface RendererControls {
  schemaBundle: OpenClawConfigSchemaResponse | null;
  draft: JsonObject;
  disabled: boolean;
  jsonDrafts: Record<string, string>;
  jsonDraftErrors: Record<string, string>;
  mapDraftKeys: Record<string, string>;
  expandedMaps: Set<string>;
  expandedDynamicEntries: Set<string>;
  visibleDynamicCounts: Record<string, number>;
  onUpdatePath: (path: string[], value: unknown) => void;
  onUpdateJsonDraft: (path: string[], raw: string) => void;
  onRemovePath: (path: string[]) => void;
  onMapDraftKeyChange: (pathKey: string, value: string) => void;
  onAddMapEntry: (path: string[], schemaRaw: unknown) => void;
  onToggleMap: (pathKey: string) => void;
  onToggleDynamicEntry: (entryKey: string) => void;
  onShowMoreDynamicEntries: (pathKey: string, total: number) => void;
}

export interface OpenClawFieldRendererProps extends RendererControls {
  schemaRaw: unknown;
  path: string[];
  depth?: number;
}

function firstNonNullType(typeRaw: unknown): string | undefined {
  if (Array.isArray(typeRaw)) {
    return typeRaw.find((entry) => entry !== "null") as string | undefined;
  }
  return typeof typeRaw === "string" ? typeRaw : undefined;
}

function dynamicEntrySchema(schemaRaw: unknown, title: string): unknown {
  if (schemaRaw && typeof schemaRaw === "object" && !Array.isArray(schemaRaw)) {
    return { ...(schemaRaw as Record<string, unknown>), title };
  }
  return { title, type: "object" };
}

function FieldBadges({ sensitive, advanced }: { sensitive?: boolean; advanced?: boolean }) {
  return (
    <>
      {sensitive && (
        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-destructive">
          sensitive
        </span>
      )}
      {advanced && (
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
          advanced
        </span>
      )}
    </>
  );
}

function JsonTextareaField({
  path,
  pathKey,
  title,
  description,
  placeholder,
  value,
  error,
  disabled,
  onUpdateJsonDraft,
}: {
  path: string[];
  pathKey: string;
  title: string;
  description: string;
  placeholder?: string;
  value: string;
  error?: string;
  disabled: boolean;
  onUpdateJsonDraft: (path: string[], raw: string) => void;
}) {
  return (
    <div key={pathKey} className="space-y-1">
      <label className="block text-sm text-text-secondary">{title}</label>
      {description && <p className="text-xs text-text-muted">{description}</p>}
      <textarea
        value={value}
        onChange={(e) => onUpdateJsonDraft(path, e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-secondary focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DynamicMapEntries({
  path,
  pathKey,
  title,
  depth,
  dynamicEntries,
  additionalSchema,
  controls,
}: {
  path: string[];
  pathKey: string;
  title: string;
  depth: number;
  dynamicEntries: Array<[string, unknown]>;
  additionalSchema: unknown;
  controls: RendererControls;
}) {
  const mapExpanded = controls.expandedMaps.has(pathKey);
  const visibleCount = controls.visibleDynamicCounts[pathKey] ?? INITIAL_DYNAMIC_ENTRY_LIMIT;
  const visibleDynamicEntries = dynamicEntries.slice(0, visibleCount);
  const hiddenDynamicCount = Math.max(dynamicEntries.length - visibleDynamicEntries.length, 0);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-surface-low/20 p-3">
      <button
        type="button"
        onClick={() => controls.onToggleMap(pathKey)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Entries</span>
          <span className="block truncate text-[11px] text-text-muted/80">
            {dynamicEntries.length === 0 ? "No entries yet" : `${dynamicEntries.length} configured`}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${mapExpanded ? "" : "-rotate-90"}`} />
      </button>

      {mapExpanded && (
        <div className="space-y-3">
          {visibleDynamicEntries.map(([childKey]) => {
            const entryPath = [...path, childKey];
            const entryKey = entryPath.join(".");
            const entryExpanded = controls.expandedDynamicEntries.has(entryKey);
            return (
              <div key={`${pathKey}-dynamic-${childKey}`} className="rounded-lg border border-border/70 bg-background/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => controls.onToggleDynamicEntry(entryKey)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${entryExpanded ? "" : "-rotate-90"}`} />
                    <p className="truncate text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{childKey}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => controls.onRemovePath(entryPath)}
                    disabled={controls.disabled}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
                {entryExpanded && (
                  <OpenClawFieldRenderer
                    schemaRaw={dynamicEntrySchema(additionalSchema, childKey)}
                    path={entryPath}
                    depth={depth + 1}
                    {...controls}
                  />
                )}
              </div>
            );
          })}
          {hiddenDynamicCount > 0 && (
            <button
              type="button"
              onClick={() => controls.onShowMoreDynamicEntries(pathKey, dynamicEntries.length)}
              className="w-full rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground"
            >
              Show {Math.min(INITIAL_DYNAMIC_ENTRY_LIMIT, hiddenDynamicCount)} more entries
            </button>
          )}
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-3 md:flex-row md:items-center">
            <input
              type="text"
              value={controls.mapDraftKeys[pathKey] ?? ""}
              onChange={(e) => controls.onMapDraftKeyChange(pathKey, e.target.value)}
              placeholder={`Add ${title.toLowerCase()} key`}
              disabled={controls.disabled}
              className="flex-1 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => controls.onAddMapEntry(path, additionalSchema ?? { type: "object" })}
              disabled={controls.disabled}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Add Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ObjectField({
  path,
  depth,
  pathKey,
  title,
  description,
  placeholder,
  advanced,
  currentValue,
  propertyKeys,
  hasAdditionalProperties,
  additionalSchema,
  controls,
}: {
  path: string[];
  depth: number;
  pathKey: string;
  title: string;
  description: string;
  placeholder?: string;
  advanced?: boolean;
  currentValue: unknown;
  propertyKeys: Record<string, unknown>;
  hasAdditionalProperties: boolean;
  additionalSchema: unknown;
  controls: RendererControls;
}) {
  const entries = Object.keys(propertyKeys).length > 0
    ? sortOpenClawEntries(Object.entries(propertyKeys), controls.schemaBundle, path)
    : [];
  const dynamicEntries = hasAdditionalProperties && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
    ? Object.entries(currentValue as JsonObject).filter(([childKey]) => !(childKey in propertyKeys))
    : [];

  if (entries.length === 0 && dynamicEntries.length === 0 && !hasAdditionalProperties) {
    const fallbackValue = controls.jsonDrafts[pathKey] ??
      (typeof currentValue === "undefined" || currentValue === null ? "{}" : JSON.stringify(currentValue, null, 2));
    return (
      <JsonTextareaField
        path={path}
        pathKey={pathKey}
        title={title}
        description={description}
        placeholder={placeholder}
        value={fallbackValue}
        error={controls.jsonDraftErrors[pathKey]}
        disabled={controls.disabled}
        onUpdateJsonDraft={controls.onUpdateJsonDraft}
      />
    );
  }

  return (
    <div key={pathKey} className={depth > 0 ? "rounded-lg border border-border p-3 space-y-3" : "space-y-3"}>
      {depth > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <FieldBadges advanced={advanced} />
          </div>
          {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
        </div>
      )}

      {entries.map(([childKey, childSchema]) => (
        <OpenClawFieldRenderer
          key={`${pathKey}.${childKey}`}
          schemaRaw={childSchema}
          path={[...path, childKey]}
          depth={depth + 1}
          {...controls}
        />
      ))}

      {hasAdditionalProperties && (
        <DynamicMapEntries
          path={path}
          pathKey={pathKey}
          title={title}
          depth={depth}
          dynamicEntries={dynamicEntries}
          additionalSchema={additionalSchema}
          controls={controls}
        />
      )}
    </div>
  );
}

function ScalarField({
  path,
  pathKey,
  title,
  description,
  placeholder,
  type,
  enumValues,
  currentValue,
  sensitive,
  advanced,
  controls,
}: {
  path: string[];
  pathKey: string;
  title: string;
  description: string;
  placeholder?: string;
  type?: string;
  enumValues: unknown[];
  currentValue: unknown;
  sensitive?: boolean;
  advanced?: boolean;
  controls: RendererControls;
}) {
  const jsonValue = controls.jsonDrafts[pathKey] ??
    (typeof currentValue === "undefined"
      ? (type === "array" ? "[]" : type === "object" ? "{}" : "")
      : JSON.stringify(currentValue, null, 2));

  return (
    <div key={pathKey} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="block text-sm text-text-secondary">{title}</label>
        <FieldBadges sensitive={sensitive} advanced={advanced} />
      </div>
      {description && <p className="text-xs text-text-muted">{description}</p>}
      {enumValues.length > 0 ? (
        <select
          value={currentValue == null ? "" : JSON.stringify(currentValue)}
          onChange={(e) => {
            if (!e.target.value) {
              controls.onUpdatePath(path, null);
              return;
            }
            const nextValue = enumValues.find((value) => JSON.stringify(value) === e.target.value);
            controls.onUpdatePath(path, nextValue ?? e.target.value);
          }}
          disabled={controls.disabled}
          className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">(unset)</option>
          {enumValues.map((value) => (
            <option key={`${pathKey}-enum-${JSON.stringify(value)}`} value={JSON.stringify(value)}>
              {String(value)}
            </option>
          ))}
        </select>
      ) : type === "boolean" ? (
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(e) => controls.onUpdatePath(path, e.target.checked)}
            disabled={controls.disabled}
            className="rounded border-border bg-surface-low disabled:cursor-not-allowed disabled:opacity-60"
          />
          Enabled
        </label>
      ) : type === "number" || type === "integer" ? (
        <input
          type="number"
          value={typeof currentValue === "number" ? String(currentValue) : ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              controls.onUpdatePath(path, null);
              return;
            }
            const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
            if (!Number.isNaN(parsed)) controls.onUpdatePath(path, parsed);
          }}
          placeholder={placeholder}
          disabled={controls.disabled}
          className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
        />
      ) : type === "array" || type === "object" ? (
        <>
          <textarea
            value={jsonValue}
            onChange={(e) => controls.onUpdateJsonDraft(path, e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={placeholder}
            disabled={controls.disabled}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-secondary focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          {controls.jsonDraftErrors[pathKey] && <p className="text-xs text-destructive">{controls.jsonDraftErrors[pathKey]}</p>}
        </>
      ) : (
        <input
          type={sensitive ? "password" : "text"}
          value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
          onChange={(e) => controls.onUpdatePath(path, e.target.value)}
          placeholder={placeholder}
          disabled={controls.disabled}
          className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-60"
        />
      )}
    </div>
  );
}

export function OpenClawFieldRenderer({
  schemaRaw,
  path,
  depth = 0,
  schemaBundle,
  draft,
  disabled,
  jsonDrafts,
  jsonDraftErrors,
  mapDraftKeys,
  expandedMaps,
  expandedDynamicEntries,
  visibleDynamicCounts,
  onUpdatePath,
  onUpdateJsonDraft,
  onRemovePath,
  onMapDraftKeyChange,
  onAddMapEntry,
  onToggleMap,
  onToggleDynamicEntry,
  onShowMoreDynamicEntries,
}: OpenClawFieldRendererProps): ReactNode {
  const schema = normalizeOpenClawConfigSchemaNode(schemaRaw);
  const descriptor = describeOpenClawConfigNode(schemaRaw);
  const hint = getOpenClawUiHint(schemaBundle, path);
  const title =
    hint?.label?.trim() ||
    (typeof schema.title === "string" ? schema.title : "") ||
    humanizeKey(path[path.length - 1] || "setting");
  const description =
    hint?.help?.trim() ||
    (typeof schema.description === "string" ? schema.description : "");
  const placeholder = hint?.placeholder && hint.placeholder.trim() ? hint.placeholder : undefined;
  const type = firstNonNullType(schema.type);
  const enumValues: unknown[] = Array.isArray(schema.enum) ? schema.enum : [];
  const currentValue = getPathValue(draft, path);
  const pathKey = path.join(".");
  const propertyKeys = descriptor.properties;
  const hasAdditionalProperties = Boolean(descriptor.additionalProperties);
  const controls: RendererControls = {
    schemaBundle,
    draft,
    disabled,
    jsonDrafts,
    jsonDraftErrors,
    mapDraftKeys,
    expandedMaps,
    expandedDynamicEntries,
    visibleDynamicCounts,
    onUpdatePath,
    onUpdateJsonDraft,
    onRemovePath,
    onMapDraftKeyChange,
    onAddMapEntry,
    onToggleMap,
    onToggleDynamicEntry,
    onShowMoreDynamicEntries,
  };

  if (type === "object" || Object.keys(propertyKeys).length > 0 || hasAdditionalProperties) {
    return (
      <ObjectField
        path={path}
        depth={depth}
        pathKey={pathKey}
        title={title}
        description={description}
        placeholder={placeholder}
        advanced={hint?.advanced}
        currentValue={currentValue}
        propertyKeys={propertyKeys}
        hasAdditionalProperties={hasAdditionalProperties}
        additionalSchema={descriptor.additionalPropertySchema}
        controls={controls}
      />
    );
  }

  return (
    <ScalarField
      path={path}
      pathKey={pathKey}
      title={title}
      description={description}
      placeholder={placeholder}
      type={type}
      enumValues={enumValues}
      currentValue={currentValue}
      sensitive={hint?.sensitive}
      advanced={hint?.advanced}
      controls={controls}
    />
  );
}
