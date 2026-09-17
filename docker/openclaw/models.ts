type ConfigObject = Record<string, unknown>

export type EnvMap = Record<string, string | undefined>

// Only the subtree this module mutates is typed; the rest of the config is an
// opaque object tree.
export interface AgentDefaultsModelConfig extends ConfigObject {
  primary?: string
}

interface ModelProviderEntry extends ConfigObject {
  id: string
}

function parseCsv(env: EnvMap, name: string): string[] {
  const raw = env[name]
  if (typeof raw !== "string") return []
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))]
}

function modelEntry(id: string, existingById: Map<string, ModelProviderEntry>): ModelProviderEntry {
  const existing = existingById.get(id)
  if (existing && typeof existing === "object") return { ...existing, id }
  return { id, name: id }
}

// Retained configs may carry a pre-schema `model` string or a non-object
// `modelPolicy`: normalize before spreading, otherwise `...value` would
// explode a string into per-character keys instead of replacing it (M1).
function asModelConfig(value: unknown): AgentDefaultsModelConfig {
  if (typeof value === "string") return { primary: value }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as AgentDefaultsModelConfig
  return {}
}

function asModelPolicyConfig(value: unknown): ConfigObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}

export function applyModelEnv(config: ConfigObject, env: EnvMap): void {
  const agents = (config.agents ||= {}) as ConfigObject
  const defaults = (agents.defaults ||= {}) as ConfigObject
  const models = parseCsv(env, "HYPER_MODELS")
  if (models.length > 0) {
    const modelsRoot = (config.models ||= {}) as ConfigObject
    const providers = (modelsRoot.providers ||= {}) as ConfigObject
    const provider = (providers.hypercli ||= {}) as ConfigObject
    const existingById = new Map<string, ModelProviderEntry>()
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      if (model && typeof model === "object" && !Array.isArray(model) && typeof (model as ConfigObject).id === "string") {
        const entry = model as ModelProviderEntry
        existingById.set(entry.id, entry)
      }
    }
    provider.models = models.map((id) => modelEntry(id, existingById))
    defaults.model = { ...asModelConfig(defaults.model), primary: `hypercli/${models[0]}` }
    defaults.models = Object.fromEntries(models.map((id) => [`hypercli/${id}`, { alias: id }]))
    defaults.modelPolicy = { ...asModelPolicyConfig(defaults.modelPolicy), allow: models.map((id) => `hypercli/${id}`) }
  }

  const embeddingModels = parseCsv(env, "HYPER_EMBEDDING_MODELS")
  if (embeddingModels.length > 0) {
    const memorySearch = (defaults.memorySearch ||= {}) as ConfigObject
    memorySearch.model = embeddingModels[0]
    memorySearch.models = embeddingModels
  }
}
