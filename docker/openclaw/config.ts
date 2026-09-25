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

function parseNonNegativeInteger(name: string): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw === "") return undefined
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a non-negative integer`)
  return Number.parseInt(raw.trim(), 10)
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

const agents = (config.agents ||= {}) as ConfigObject
const defaults = (agents.defaults ||= {}) as ConfigObject
const memorySearch = (defaults.memorySearch ||= {}) as ConfigObject

{
  const token = (env.OPENCLAW_GATEWAY_TOKEN || "").trim()
  if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN is required")
  const gateway = (config.gateway ||= {}) as ConfigObject
  const auth = (gateway.auth ||= {}) as ConfigObject
  auth.mode = "token"
  auth.token = token
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

const onSessionStart = parseBoolean("OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START")
const onSearch = parseBoolean("OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH")
const watch = parseBoolean("OPENCLAW_MEMORY_SEARCH_SYNC_WATCH")
const watchDebounceMs = parseNonNegativeInteger("OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS")
const intervalMinutes = parseNonNegativeInteger("OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES")

// Only materialize the sync subtree when the deploy env actually configures
// memory search; retained configs without it stay untouched (the baked
// openclaw.json template already carries the subtree, so this is a no-op
// against the template).
const memorySearchEnvs = [enabled, onSessionStart, onSearch, watch, watchDebounceMs, intervalMinutes]
if (memorySearchEnvs.some((value) => value !== undefined)) {
  const sync = (memorySearch.sync ||= {}) as ConfigObject
  if (onSessionStart !== undefined) sync.onSessionStart = onSessionStart
  if (onSearch !== undefined) sync.onSearch = onSearch
  if (watch !== undefined) sync.watch = watch
  if (watchDebounceMs !== undefined) sync.watchDebounceMs = watchDebounceMs
  if (intervalMinutes !== undefined) sync.intervalMinutes = intervalMinutes
}

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
