import type { JsonObject } from "@/app/dashboard/agents/types";
import { asObject } from "@/lib/openclaw-config";

export interface OpenClawModelOption {
  value: string;
  label: string;
  detail?: string;
  providerId?: string;
  modelId?: string;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function modelLabel(name: string, providerLabel?: string | null): string {
  return providerLabel ? `${name} (${providerLabel})` : name;
}

export function getOpenClawDefaultModel(config: Record<string, unknown> | null | undefined): string {
  const cfg = asObject(config);
  if (!cfg) return "";

  const agents = asObject(cfg.agents);
  const defaults = asObject(agents?.defaults);
  const defaultsModel = defaults?.model;
  const defaultsModelObject = asObject(defaultsModel);
  const llm = asObject(cfg.llm);

  return firstString(
    defaultsModelObject?.primary,
    defaultsModel,
    agents?.defaultModel,
    llm?.model,
    cfg.model,
  ) ?? "";
}

function modelOptionsFromConfig(config: Record<string, unknown> | null | undefined): OpenClawModelOption[] {
  const cfg = asObject(config);
  const providers = asObject(asObject(cfg?.models)?.providers);
  if (!providers) return [];

  const options: OpenClawModelOption[] = [];
  for (const [providerId, providerRaw] of Object.entries(providers)) {
    const provider = asObject(providerRaw) ?? {};
    const providerLabel = firstString(provider.name, provider.displayName, provider.label, providerId);
    const models = Array.isArray(provider.models) ? provider.models : [];

    for (const modelRaw of models) {
      const model = asObject(modelRaw);
      const modelId = firstString(model?.id, model?.modelId, model?.model_id, model?.model);
      if (!modelId) continue;

      const displayName = firstString(model?.name, model?.displayName, model?.label, modelId) ?? modelId;
      options.push({
        value: `${providerId}/${modelId}`,
        label: modelLabel(displayName, providerLabel),
        detail: providerLabel ?? undefined,
        providerId,
        modelId,
      });
    }
  }

  return options;
}

function modelOptionsFromList(models: Array<Record<string, unknown>> | null | undefined): OpenClawModelOption[] {
  if (!models) return [];

  return models.flatMap((modelRaw) => {
    const model = asObject(modelRaw);
    if (!model) return [];

    const provider = asObject(model.provider);
    const nestedModels = Array.isArray(model.models) ? model.models : null;
    if (nestedModels) {
      const providerId = firstString(
        model.providerId,
        model.provider_id,
        model.providerKey,
        provider?.id,
        provider?.key,
        typeof model.provider === "string" ? model.provider : null,
        model.id,
      );
      const providerLabel = firstString(
        model.providerName,
        model.providerLabel,
        provider?.name,
        provider?.displayName,
        model.name,
        model.displayName,
        providerId,
      );
      if (!providerId) return [];

      return nestedModels.flatMap((nestedRaw) => {
        const nested = asObject(nestedRaw);
        const modelId = firstString(nested?.id, nested?.modelId, nested?.model_id, nested?.model, nested?.name);
        if (!modelId) return [];

        const value = modelId.includes("/") ? modelId : `${providerId}/${modelId}`;
        const displayName = firstString(nested?.name, nested?.displayName, nested?.label, nested?.title, modelId) ?? modelId;
        return [{
          value,
          label: modelLabel(displayName, providerLabel),
          detail: providerLabel ?? undefined,
          providerId,
          modelId,
        }];
      });
    }

    const providerId = firstString(
      model.providerId,
      model.provider_id,
      model.providerKey,
      provider?.id,
      provider?.key,
      typeof model.provider === "string" ? model.provider : null,
    );
    const providerLabel = firstString(
      model.providerName,
      model.providerLabel,
      provider?.name,
      provider?.displayName,
      providerId,
    );
    const modelId = firstString(model.id, model.modelId, model.model_id, model.model, model.name);
    if (!modelId) return [];

    const value = modelId.includes("/") || !providerId ? modelId : `${providerId}/${modelId}`;
    const displayName = firstString(model.name, model.displayName, model.label, model.title, modelId) ?? modelId;
    return [{
      value,
      label: modelLabel(displayName, providerLabel),
      detail: providerLabel ?? undefined,
      providerId: providerId ?? undefined,
      modelId,
    }];
  });
}

export function normalizeOpenClawModelOptions(
  config: Record<string, unknown> | null | undefined,
  models: Array<Record<string, unknown>> | null | undefined,
  currentModel?: string | null,
): OpenClawModelOption[] {
  const seen = new Set<string>();
  const options: OpenClawModelOption[] = [];
  const addOption = (option: OpenClawModelOption) => {
    if (!option.value || seen.has(option.value)) return;
    seen.add(option.value);
    options.push(option);
  };

  modelOptionsFromConfig(config).forEach(addOption);
  modelOptionsFromList(models).forEach(addOption);

  const configured = firstString(currentModel);
  if (configured && !seen.has(configured)) {
    addOption({ value: configured, label: configured, detail: "Configured" });
  }

  return options;
}

export function buildOpenClawDefaultModelPatch(modelValue: string): JsonObject {
  return {
    agents: {
      defaults: {
        model: {
          primary: modelValue,
        },
      },
    },
  };
}
