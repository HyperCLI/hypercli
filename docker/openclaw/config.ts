import fs from "node:fs"

import { applyModelEnv } from "./models.ts"
import type { EnvMap } from "./models.ts"

type ConfigObject = Record<string, unknown>

const env: EnvMap = process.env
const configPath = env.CONFIG_PATH

if (!configPath) throw new Error("CONFIG_PATH is required")

const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigObject

function parseBoolean(name: string): boolean | undefined {
  const raw = env[name]
  if (raw === undefined || raw === "") return undefined
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
    case "enabled":
      return true
    case "0":
    case "false":
    case "no":
    case "off":
    case "disabled":
      return false
    default:
      throw new Error(`${name} must be a boolean-like value`)
  }
}

// Shared list shape for env-carried string lists: comma- or space-separated,
// or a JSON array (mirrors the ts-sdk read-side union). Entries are trimmed,
// empties and non-strings drop, and the result is deduped; "*" stays an
// ordinary entry (the gateway interprets the wildcard).
function parseEnvList(raw: string): string[] {
  const candidate = raw.trim()
  if (!candidate) return []
  const entries: unknown[] = candidate.startsWith("[")
    ? parseJsonArray(candidate)
    : candidate.split(/[,\s]+/)
  return [...new Set(entries.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))]
}

function parseJsonArray(candidate: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(candidate)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function asRecord(value: unknown): ConfigObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ConfigObject) : undefined
}

const agents = (config.agents ||= {}) as ConfigObject
const defaults = (agents.defaults ||= {}) as ConfigObject

// Legacy-shape repair, mirrored from the pinned gateway's own doctor
// migrations. The doctor only re-runs when the runtime build checkpoint
// changes, so a same-image stop/start skips it while the config still must
// validate against the pinned gateway schema on every boot — the reconciler
// therefore enforces the canonical shape itself. (upstream:
// openclaw-git src/commands/doctor/shared/legacy-config-migrations.runtime.*.ts)
const memorySearch = ((): ConfigObject => {
  // agents.defaults.memorySearch / top-level memorySearch → memory.search
  // (doctor migration "memorySearch->memory.search"; existing canonical keys win).
  const memory = (config.memory ||= {}) as ConfigObject
  const search = (memory.search ||= {}) as ConfigObject
  for (const owner of [defaults, config]) {
    const legacy = asRecord(owner.memorySearch)
    if (!legacy) continue
    delete owner.memorySearch
    for (const [key, value] of Object.entries(legacy)) {
      if (!(key in search)) search[key] = value
    }
  }
  // The pinned gateway's strict memory.search schema has no `sync` or `models`
  // keys (sync cadence is built in; only `model` is configurable), so any
  // carried over from legacy renders must be stripped to keep the output valid.
  delete search.sync
  delete search.models
  return search
})()

// agents.list[] → keyed agents.entries (doctor migration
// "runtime.agents-entries"). When canonical entries are already present the
// legacy roster is simply dropped, matching the doctor.
if (Array.isArray(agents.list)) {
  const list = agents.list as unknown[]
  delete agents.list
  if (!asRecord(agents.entries)) {
    const entries = (agents.entries = {}) as ConfigObject
    const ids = new Set<string>()
    for (const item of list) {
      const entry = asRecord(item)
      if (!entry) continue
      const rawId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "agent"
      const requested = rawId.toLowerCase()
      let id = requested
      let suffix = 2
      while (ids.has(id)) id = `${requested}-${suffix++}`
      ids.add(id)
      const { id: _id, ...rest } = entry
      entries[id] = rest
    }
  }
}

// commands.ownerDisplay/ownerDisplaySecret are retired upstream (owner ids
// render raw now); retained configs must shed them.
{
  const commands = asRecord(config.commands)
  if (commands) {
    delete commands.ownerDisplay
    delete commands.ownerDisplaySecret
  }
}

// The gateway is a pod-internal ACP hop only (loopback bind, no browser/WS
// clients): auth stays mode "none" with no token. The auth subtree is
// replaced wholesale so retained configs written in the caller-minted-token
// era shed their stale token on first boot.
{
  const gateway = (config.gateway ||= {}) as ConfigObject
  gateway.auth = { mode: "none" }
}

// OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN, when set in the container env, holds a
// list of origins that REPLACES gateway.controlUi.allowedOrigins, unrolled in
// full — no merging with the baked loopback defaults. A var that is unset or
// parses to nothing keeps the baked defaults. (OpenClaw has no reader for
// this var; the gateway only ever sees the unrolled file below.)
{
  const raw = env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN
  if (typeof raw === "string") {
    const envOrigins = parseEnvList(raw)
    if (envOrigins.length > 0) {
      const gateway = (config.gateway ||= {}) as ConfigObject
      const controlUi = (gateway.controlUi ||= {}) as ConfigObject
      controlUi.allowedOrigins = envOrigins
    }
  }
}

// OPENCLAW_TRUSTED_PROXIES unrolls into gateway.trustedProxies. This mirrors
// controlUi.allowedOrigins: the env is only an image/bootstrap contract, and
// OpenClaw itself reads the rendered config file. Deployed env values are
// written as one comma-joined list.
{
  const raw = env.OPENCLAW_TRUSTED_PROXIES
  if (typeof raw === "string") {
    const trustedProxies = raw.split(",").map((s) => s.trim()).filter(Boolean)
    if (trustedProxies.length > 0) {
      const gateway = (config.gateway ||= {}) as ConfigObject
      gateway.trustedProxies = [...new Set(trustedProxies)]
    }
  }
}

const workspaceIndexPath = "~/shared"
const extraPaths: unknown[] = Array.isArray(memorySearch.extraPaths) ? memorySearch.extraPaths : []
if (!extraPaths.includes(workspaceIndexPath)) extraPaths.push(workspaceIndexPath)
memorySearch.extraPaths = extraPaths

const enabled = parseBoolean("OPENCLAW_MEMORY_SEARCH_ENABLED")
if (enabled !== undefined) memorySearch.enabled = enabled

// tools.loopDetection.enabled is a guardrail, not a preference: retained
// configs predate the template carrying it, and with the detector off an
// unattended agent can repeat an identical tool call until an external
// timeout. Force it on every boot so existing state dirs pick it up.
{
  const tools = (config.tools ||= {}) as ConfigObject
  const loopDetection = (tools.loopDetection ||= {}) as ConfigObject
  loopDetection.enabled = true
}

applyModelEnv(config, env)

const cronEnabled = parseBoolean("OPENCLAW_CRON_ENABLED")
if (cronEnabled !== undefined) {
  const cron = (config.cron ||= {}) as ConfigObject
  cron.enabled = cronEnabled
}

// Atomic write: render to a sibling tmp file carrying the destination's
// existing mode, then rename over the target so readers never see a partial
// file.
const rendered = JSON.stringify(config, null, 2) + "\n"
const tmpPath = `${configPath}.tmp`
const existingMode = fs.statSync(configPath).mode & 0o777
fs.writeFileSync(tmpPath, rendered, { mode: existingMode })
fs.renameSync(tmpPath, configPath)
