import fs from "node:fs"

type ConfigObject = Record<string, unknown>

const env = process.env
const configPath = env.CONFIG_PATH

if (!configPath) throw new Error("CONFIG_PATH is required")

const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigObject

function asRecord(value: unknown): ConfigObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as ConfigObject
}

// The disable path only tears down what the enable path writes: a relay
// channel whose auth token references HYPER_AGENTS_API_KEY. Hand-written or
// otherwise foreign slack configs survive an explicit disable untouched.
function isHostedSlackRelayConfig(slack: unknown): boolean {
  const channel = asRecord(slack)
  if (!channel || channel.mode !== "relay") return false
  const authToken = asRecord(asRecord(channel.relay)?.authToken)
  return authToken?.id === "HYPER_AGENTS_API_KEY"
}

const GROUP_POLICIES = new Set(["open", "allowlist", "disabled"])

function fail(message: string): never {
  console.error(`[openclaw] ${message}`)
  process.exit(1)
}

// HYPER_SLACK_GROUP_POLICY: one of OpenClaw's channel group policies.
function parseGroupPolicy(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim()
  if (!value) return undefined
  if (!GROUP_POLICIES.has(value)) {
    fail(`HYPER_SLACK_GROUP_POLICY must be one of open, allowlist, disabled; got ${JSON.stringify(value)}`)
  }
  return value
}

// HYPER_SLACK_CHANNELS_JSON: OpenClaw's channels.slack.channels map
// ({"<channel id>": {"enabled": true, "requireMention": false}, ...}) as JSON.
// A legacy `allow` key (what slack-relays before the `enabled` rename wrote;
// OpenClaw's strict channel schema only knows `enabled`) is mapped to
// `enabled` rather than rejected: old relays are still deployed.
function parseChannelsJson(raw: string | undefined): ConfigObject | undefined {
  const value = (raw ?? "").trim()
  if (!value) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    fail("HYPER_SLACK_CHANNELS_JSON is not valid JSON")
  }
  const record = asRecord(parsed)
  if (!record) fail("HYPER_SLACK_CHANNELS_JSON must be a JSON object keyed by Slack channel id")
  for (const [channel, entry] of Object.entries(record)) {
    const channelEntry = asRecord(entry)
    if (!channel.trim() || !channelEntry) {
      fail(`HYPER_SLACK_CHANNELS_JSON entry ${JSON.stringify(channel)} must be an object`)
    }
    if ("allow" in channelEntry) {
      if (!("enabled" in channelEntry)) channelEntry.enabled = channelEntry.allow
      delete channelEntry.allow
    }
  }
  return Object.keys(record).length > 0 ? record : undefined
}

// HYPER_SLACK_ALLOW_FROM: comma-separated Slack user ids, deduplicated and
// sorted — literally the relay's `sorted(set(...))` shape.
function parseAllowFrom(raw: string | undefined): string[] {
  const seen = new Set<string>()
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim()
    if (id) seen.add(id)
  }
  return [...seen].sort()
}

// HYPER_SLACK_APP_ENABLED is a launch-env contract owned by the ts-sdk, which
// writes exactly "1" (enable) or "0" (disable). Anything else — unset, empty,
// legacy boolean spellings — is a no-op and leaves the retained config alone.
const flag = (env.HYPER_SLACK_APP_ENABLED ?? "").trim().toLowerCase()

if (flag === "1") {
  const relayUrl = (env.HYPER_SLACK_RELAY_URL ?? "").trim()
  const gatewayId = (env.HYPER_SLACK_GATEWAY_ID ?? "").trim()
  const apiUrl = (env.HYPER_SLACK_API_URL ?? "").trim()
  const agentsApiKey = (env.HYPER_AGENTS_API_KEY ?? "").trim()
  // Gates run BEFORE any write: the ts-sdk supplies all four companions
  // atomically, so a missing one means a broken launch env — fail the boot
  // loudly instead of persisting a half-reconciled config.
  const missing: string[] = []
  if (!relayUrl) missing.push("HYPER_SLACK_RELAY_URL")
  if (!gatewayId) missing.push("HYPER_SLACK_GATEWAY_ID")
  if (!apiUrl) missing.push("HYPER_SLACK_API_URL")
  if (!agentsApiKey) missing.push("HYPER_AGENTS_API_KEY")
  if (missing.length > 0) {
    fail(`HYPER_SLACK_APP_ENABLED=1 requires ${missing.join(", ")}`)
  }

  // Access-policy knobs. The slack-relay writes these when it starts a managed
  // agent on the owner's behalf (slack-relay/app/main.py `_hosted_slack_launch_env`
  // mirroring `routing.openclaw_slack_relay_config`): the created agent is
  // scoped to the channel it was created from plus the installer/creator user
  // ids. They are optional; absent knobs leave OpenClaw's own defaults in place.
  // A malformed value is a broken launch env and fails the boot like a
  // missing companion does, before anything is written.
  const groupPolicy = parseGroupPolicy(env.HYPER_SLACK_GROUP_POLICY)
  const channelsConfig = parseChannelsJson(env.HYPER_SLACK_CHANNELS_JSON)
  const allowFrom = parseAllowFrom(env.HYPER_SLACK_ALLOW_FROM)

  // Env is authoritative: channels.slack is fully replaced, never merged with
  // the retained config, so stale relay state cannot linger across boots.
  const channels = (config.channels ||= {}) as ConfigObject
  const slack: ConfigObject = {
    enabled: true,
    mode: "relay",
    replyToMode: "all",
    replyToModeByChatType: { direct: "off" },
    botToken: { source: "env", provider: "default", id: "SLACK_BOT_TOKEN" },
    relay: {
      url: relayUrl,
      authToken: { source: "env", provider: "default", id: "HYPER_AGENTS_API_KEY" },
      gatewayId,
    },
  }
  if (groupPolicy) slack.groupPolicy = groupPolicy
  if (channelsConfig) slack.channels = channelsConfig
  if (allowFrom.length > 0) {
    // Same shape the relay itself renders for a direct launch
    // (routing.openclaw_slack_relay_config): an explicit, sorted sender
    // allowlist implies allowlist DM policy.
    slack.dmPolicy = "allowlist"
    slack.allowFrom = allowFrom
  }
  channels.slack = slack
  const messages = (config.messages ||= {}) as ConfigObject
  messages.statusReactions = { enabled: true }
  const plugins = (config.plugins ||= {}) as ConfigObject
  const entries = (plugins.entries ||= {}) as ConfigObject
  const slackEntry = (entries.slack ||= {}) as ConfigObject
  slackEntry.enabled = true
}

if (flag === "0") {
  // Symmetric teardown: drop everything the enable path writes, but only when
  // channels.slack is recognizably the hosted relay config.
  const channels = asRecord(config.channels)
  if (channels && isHostedSlackRelayConfig(channels.slack)) {
    delete channels.slack
    const entries = asRecord(asRecord(config.plugins)?.entries)
    if (entries) delete entries.slack
    const messages = asRecord(config.messages)
    if (messages) delete messages.statusReactions
  }
}

// Atomic write: render to a sibling tmp file carrying the destination's
// existing mode, then rename over the target so readers never see a partial
// file.
const rendered = JSON.stringify(config, null, 2) + "\n"
const tmpPath = `${configPath}.tmp`
const existingMode = fs.statSync(configPath).mode & 0o777
fs.writeFileSync(tmpPath, rendered, { mode: existingMode })
fs.renameSync(tmpPath, configPath)
