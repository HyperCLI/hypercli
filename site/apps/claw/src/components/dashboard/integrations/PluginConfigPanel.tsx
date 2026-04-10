"use client";

import { useState } from "react";
import { ExternalLink, Check, Key, Globe, Loader2 } from "lucide-react";
import type { PluginMeta } from "./plugin-registry";
import { isPluginEnabled } from "./plugin-registry";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/gateway";

const REDACTED_KEY = "__OPENCLAW_REDACTED__";

interface PluginConfigPanelProps {
  plugin: PluginMeta;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

/** Read the current provider credentials from config.models.providers.<id> */
export function getProviderCredentials(
  pluginId: string,
  config: Record<string, unknown> | null,
): { apiKey: string; baseUrl: string; hasExistingKey: boolean } {
  if (!config) return { apiKey: "", baseUrl: "", hasExistingKey: false };
  const providers = (config as any)?.models?.providers ?? {};
  const prov = providers[pluginId] ?? {};
  const rawKey = prov.apiKey ?? "";
  return {
    apiKey: rawKey === REDACTED_KEY ? "" : rawKey,
    baseUrl: prov.baseUrl ?? "",
    hasExistingKey: !!rawKey,
  };
}

interface FieldDef {
  key: string;
  type: string;
  title: string;
  description?: string;
  sensitive?: boolean;
  enumValues?: string[];
  defaultValue?: unknown;
  placeholder?: string;
}

function getPluginConfigFields(
  pluginId: string,
  configSchema: OpenClawConfigSchemaResponse | null,
): FieldDef[] {
  if (!configSchema) return [];
  const entries = (configSchema.schema as any)?.properties?.plugins?.properties?.entries?.properties;
  if (!entries) return [];
  const pluginSchema = entries[pluginId];
  if (!pluginSchema) return [];
  const configProps = pluginSchema?.properties?.config?.properties;
  if (!configProps) return [];

  const uiHints = configSchema.uiHints ?? {};
  const fields: FieldDef[] = [];

  for (const [key, schema] of Object.entries(configProps) as [string, any][]) {
    const rawType = schema.type;
    const type = Array.isArray(rawType)
      ? (rawType.find((t: string) => t !== "null") ?? "string")
      : (rawType ?? "string");

    if (type === "array") continue;

    if (type === "object" && schema.properties) {
      // Flatten one level of nested object properties (e.g. webSearch.apiKey)
      for (const [childKey, childSchema] of Object.entries(schema.properties) as [string, any][]) {
        const childRawType = childSchema.type;
        const childType = Array.isArray(childRawType)
          ? (childRawType.find((t: string) => t !== "null") ?? "string")
          : (childRawType ?? "string");
        if (childType === "object" || childType === "array") continue;

        const hintKey = `plugins.entries.${pluginId}.config.${key}.${childKey}`;
        const hint = uiHints[hintKey] as { label?: string; help?: string; sensitive?: boolean; placeholder?: string } | undefined;

        fields.push({
          key: `${key}.${childKey}`,
          type: childType,
          title: hint?.label ?? childSchema.title ?? childKey,
          description: hint?.help ?? childSchema.description,
          sensitive: hint?.sensitive ?? false,
          enumValues: Array.isArray(childSchema.enum) ? childSchema.enum : undefined,
          defaultValue: childSchema.default,
          placeholder: hint?.placeholder,
        });
      }
      continue;
    }

    const hintKey = `plugins.entries.${pluginId}.config.${key}`;
    const hint = uiHints[hintKey] as { label?: string; help?: string; sensitive?: boolean; placeholder?: string } | undefined;

    fields.push({
      key,
      type,
      title: hint?.label ?? schema.title ?? key,
      description: hint?.help ?? schema.description,
      sensitive: hint?.sensitive ?? false,
      enumValues: Array.isArray(schema.enum) ? schema.enum : undefined,
      defaultValue: schema.default,
      placeholder: hint?.placeholder,
    });
  }

  return fields;
}

function getPluginConfigValues(
  pluginId: string,
  config: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!config) return {};
  const entries = (config as any)?.plugins?.entries;
  if (!entries) return {};
  const pluginConfig = (entries[pluginId]?.config as Record<string, unknown>) ?? {};

  // Flatten one level of nested objects into dot-path keys to match field keys
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pluginConfig)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        flat[`${key}.${childKey}`] = childValue;
      }
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

export function PluginConfigPanel({
  plugin,
  config,
  configSchema,
  onSave,
  onClose,
}: PluginConfigPanelProps) {
  const fields = getPluginConfigFields(plugin.id, configSchema);
  const currentValues = getPluginConfigValues(plugin.id, config);
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...currentValues });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = plugin.icon;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Reconstruct nested objects from dot-path draft keys (e.g. "webSearch.apiKey")
      const pluginConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        const dotIdx = key.indexOf(".");
        if (dotIdx !== -1) {
          const parent = key.slice(0, dotIdx);
          const child = key.slice(dotIdx + 1);
          if (pluginConfig[parent] == null) pluginConfig[parent] = {};
          (pluginConfig[parent] as Record<string, unknown>)[child] = value;
        } else {
          pluginConfig[key] = value;
        }
      }
      await onSave({
        plugins: {
          entries: {
            [plugin.id]: {
              enabled: true,
              config: pluginConfig,
            },
          },
        },
      });
      setSaveSuccess(true);
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // AI Model Providers — always show the dedicated API key + base URL form,
  // since provider credentials live at models.providers.<id>, not plugins.entries.<id>.config.
  if (plugin.category === "ai-providers") {
    return (
      <AiProviderPanel
        plugin={plugin}
        config={config}
        configSchema={configSchema}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }

  // No config fields — show contextual guidance based on plugin category
  if (fields.length === 0) {
    const isChatPlugin = plugin.category === "chat";
    const isToolPlugin = plugin.category === "tools";

    return (
      <div className="space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-[var(--primary)]" />
        </div>
        <p className="text-sm text-text-secondary">{plugin.description}</p>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">How to set up</h4>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <span className="text-[var(--primary)] font-medium flex-shrink-0">1.</span>
              Enable the plugin using the toggle on the integration card
            </li>
            {isChatPlugin && (
              <>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--primary)] font-medium flex-shrink-0">2.</span>
                  Open the <span className="font-medium text-foreground">Shell</span> tab on your agent
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--primary)] font-medium flex-shrink-0">3.</span>
                  Follow the on-screen prompts to complete the connection (e.g. scan a QR code, enter credentials)
                </li>
              </>
            )}
            {isToolPlugin && (
              <>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--primary)] font-medium flex-shrink-0">2.</span>
                  If the tool requires an API key, add it in the <span className="font-medium text-foreground">OpenClaw</span> tab under plugin settings
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[var(--primary)] font-medium flex-shrink-0">3.</span>
                  Your agent will automatically use this tool when relevant
                </li>
              </>
            )}
          </ol>
        </div>

        {isChatPlugin && (
          <div className="glass-card p-3 text-xs text-text-tertiary">
            <p>
              After enabling, your agent will guide you through the setup process when you open the Shell tab.
              The connection details (tokens, QR codes) are handled securely inside the agent.
            </p>
          </div>
        )}
        {isToolPlugin && (
          <div className="glass-card p-3 text-xs text-text-tertiary">
            <p>
              Most tools require an API key. You can set it in the <span className="text-text-secondary">OpenClaw</span> config tab
              or as an environment variable in your agent settings.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-[var(--primary)]" />
      </div>
      <p className="text-sm text-text-secondary">{plugin.description}</p>

      {/* Provider-specific setup guidance */}
      {plugin.setupHint && (
        <div className="glass-card p-3 flex items-start gap-2.5">
          <div className="flex-1 text-xs text-text-secondary">
            {plugin.setupHint}
            {plugin.setupUrl && (
              <>
                {" \u2014 "}
                <a
                  href={plugin.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                >
                  Get API key <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{field.title}</label>
            {field.description && (
              <p className="text-xs text-text-tertiary">{field.description}</p>
            )}
            {field.type === "boolean" ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!draft[field.key]}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                />
                <span className="text-sm text-text-secondary">Enabled</span>
              </label>
            ) : field.enumValues ? (
              <select
                value={String(draft[field.key] ?? "")}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground focus:outline-none focus:border-[var(--primary)]"
              >
                <option value="">Select...</option>
                {field.enumValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : field.type === "integer" || field.type === "number" ? (
              <input
                type="number"
                value={draft[field.key] != null ? String(draft[field.key]) : ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder={field.placeholder ?? (field.defaultValue != null ? String(field.defaultValue) : undefined)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
              />
            ) : (
              <input
                type={field.sensitive ? "password" : "text"}
                value={String(draft[field.key] ?? "")}
                onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))}
                placeholder={field.placeholder ?? (field.defaultValue != null ? String(field.defaultValue) : undefined)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-xs text-[var(--error)]">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || saveSuccess}
          className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors ${
            saveSuccess
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              : "btn-primary"
          }`}
        >
          {saveSuccess ? (
            <span className="flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          ) : saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Provider Panel — API key + base URL form
// ---------------------------------------------------------------------------

function AiProviderPanel({
  plugin,
  config,
  configSchema,
  onSave,
  onClose,
}: {
  plugin: PluginMeta;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const enabled = isPluginEnabled(plugin, config);
  const creds = getProviderCredentials(plugin.id, config);
  const extraFields = getPluginConfigFields(plugin.id, configSchema);
  const extraValues = getPluginConfigValues(plugin.id, config);
  const [apiKey, setApiKey] = useState(creds.apiKey);
  const [baseUrl, setBaseUrl] = useState(creds.baseUrl);
  const [extraDraft, setExtraDraft] = useState<Record<string, unknown>>({ ...extraValues });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "connected" | "disconnected">("idle");
  const [error, setError] = useState<string | null>(null);

  const Icon = plugin.icon;
  const isSelfHosted = plugin.providerType === "self-hosted" || plugin.noApiKey;
  const hasInput = isSelfHosted ? baseUrl.trim() : (apiKey.trim() || baseUrl.trim());

  const handleConnect = async () => {
    if (!hasInput) return;
    setSaving(true);
    setError(null);
    try {
      const providerPatch: Record<string, unknown> = {};
      if (apiKey.trim()) providerPatch.apiKey = apiKey.trim();
      if (baseUrl.trim()) providerPatch.baseUrl = baseUrl.trim();

      await onSave({
        plugins: {
          entries: {
            [plugin.id]: {
              enabled: true,
              ...(extraFields.length > 0 ? { config: extraDraft } : {}),
            },
          },
        },
        models: {
          providers: {
            [plugin.id]: providerPatch,
          },
        },
      });
      setStatus("connected");
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        plugins: {
          entries: {
            [plugin.id]: { enabled: false },
          },
        },
      });
      setStatus("disconnected");
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setSaving(false);
    }
  };

  // Completed action — show brief confirmation
  if (status === "connected" || status === "disconnected") {
    return (
      <div className="space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-[var(--primary)]" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className={`w-4 h-4 ${status === "connected" ? "text-emerald-400" : "text-text-secondary"}`} />
          <span className="text-foreground">
            {status === "connected" ? `${plugin.displayName} connected` : `${plugin.displayName} disconnected`}
          </span>
        </div>
      </div>
    );
  }

  // Saving — show spinner in the panel
  if (saving) {
    return (
      <div className="space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-[var(--primary)]" />
        </div>
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" />
          {enabled ? "Disconnecting..." : "Connecting..."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-[var(--primary)]" />
      </div>
      <p className="text-sm text-text-secondary">{plugin.description}</p>

      {/* Setup hint + link */}
      {plugin.setupHint && (
        <div className="glass-card p-3 flex items-start gap-2.5">
          <div className="flex-1 text-xs text-text-secondary">
            {plugin.setupHint}
            {plugin.setupUrl && (
              <>
                {" \u2014 "}
                <a
                  href={plugin.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                >
                  Get API key <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* Status indicator for already-configured providers */}
      {!isSelfHosted && creds.hasExistingKey && (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          API key configured
        </div>
      )}

      {/* API Key field — hidden for self-hosted providers */}
      {!isSelfHosted && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-text-tertiary" />
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={creds.hasExistingKey ? "Enter new key to update" : "sk-..."}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      )}

      {/* Base URL field — required for self-hosted, optional for others */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-text-tertiary" />
          {isSelfHosted ? "Server URL" : "Base URL"}
          {!isSelfHosted && <span className="text-xs text-text-tertiary font-normal">(optional)</span>}
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={isSelfHosted ? "http://localhost:11434" : "https://api.provider.com/v1"}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
        />
        {!isSelfHosted && (
          <p className="text-xs text-text-tertiary">
            Only needed for custom endpoints or self-hosted instances.
          </p>
        )}
      </div>

      {/* Extra schema-discovered fields */}
      {extraFields.length > 0 && (
        <div className="space-y-4 pt-2 border-t border-[var(--border)]">
          <p className="text-xs text-text-tertiary">Additional settings</p>
          {extraFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">{field.title}</label>
              {field.description && (
                <p className="text-xs text-text-tertiary">{field.description}</p>
              )}
              {field.type === "boolean" ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!extraDraft[field.key]}
                    onChange={(e) => setExtraDraft((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                    className="w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm text-text-secondary">Enabled</span>
                </label>
              ) : (
                <input
                  type={field.sensitive ? "password" : "text"}
                  value={String(extraDraft[field.key] ?? "")}
                  onChange={(e) => setExtraDraft((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))}
                  placeholder={field.placeholder ?? (field.defaultValue != null ? String(field.defaultValue) : undefined)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--error)]">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
        >
          Cancel
        </button>
        {enabled && (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--error)] border border-[var(--error)]/20 hover:bg-[var(--error)]/5 transition-colors"
          >
            Disconnect
          </button>
        )}
        <button
          onClick={handleConnect}
          disabled={!hasInput}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {creds.hasExistingKey ? "Update" : "Connect"}
        </button>
      </div>
    </div>
  );
}
