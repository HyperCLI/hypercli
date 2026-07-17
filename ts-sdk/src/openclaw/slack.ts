import {
  isOpenClawGatewayMethodUnsupported,
  type OpenClawConfigSchemaLookupResult,
} from './gateway.js';

export type OpenClawSecretRefSource = 'env' | 'file' | 'exec';

export interface OpenClawSecretRef {
  source: OpenClawSecretRefSource;
  provider: string;
  id: string;
}

export type OpenClawSlackSecretRefSource = OpenClawSecretRefSource;
export type OpenClawSlackSecretRef = OpenClawSecretRef;
export type OpenClawSlackSecretInput = string | OpenClawSecretRef;
export type OpenClawSlackMode = 'socket' | 'http' | 'relay';
export type OpenClawSlackReplyToMode = 'off' | 'first' | 'all' | 'batched';
export type OpenClawSlackGroupPolicy = 'open' | 'disabled' | 'allowlist';
export type OpenClawSlackDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type OpenClawSlackContextVisibility = 'all' | 'allowlist' | 'allowlist_quote';

export interface OpenClawSlackToolPolicy {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
}

export type OpenClawSlackToolPolicyBySender = Record<string, OpenClawSlackToolPolicy>;

export interface OpenClawSlackBotLoopProtectionConfig {
  enabled?: boolean;
  maxEventsPerWindow?: number;
  windowSeconds?: number;
  cooldownSeconds?: number;
}

export interface OpenClawSlackImplicitMentionsConfig {
  replyToBot?: boolean;
  quotedBot?: boolean;
  threadParticipation?: boolean;
}

export interface OpenClawSlackPresenceEventsConfig {
  mode?: 'off' | 'auto' | 'on';
}

export interface OpenClawSlackChannelConfig {
  enabled?: boolean;
  requireMention?: boolean;
  ignoreOtherMentions?: boolean;
  replyToMode?: OpenClawSlackReplyToMode;
  tools?: OpenClawSlackToolPolicy;
  toolsBySender?: OpenClawSlackToolPolicyBySender;
  allowBots?: boolean | 'mentions';
  botLoopProtection?: OpenClawSlackBotLoopProtectionConfig;
  users?: Array<string | number>;
  skills?: string[];
  systemPrompt?: string;
  presenceEvents?: OpenClawSlackPresenceEventsConfig;
}

export interface OpenClawSlackDmConfig {
  enabled?: boolean;
  /** @deprecated Use account-level dmPolicy. */
  policy?: OpenClawSlackDmPolicy;
  /** @deprecated Use account-level allowFrom. */
  allowFrom?: Array<string | number>;
  groupEnabled?: boolean;
  groupChannels?: Array<string | number>;
  /** @deprecated Prefer replyToModeByChatType.direct. */
  replyToMode?: OpenClawSlackReplyToMode;
}

export interface OpenClawSlackSocketModeConfig {
  clientPingTimeout?: number;
  serverPingTimeout?: number;
  pingPongLoggingEnabled?: boolean;
}

export interface OpenClawSlackRelayConfig {
  url?: string;
  authToken?: OpenClawSlackSecretInput;
  gatewayId?: string;
}

export interface OpenClawSlackStreamingChunkConfig {
  minChars?: number;
  maxChars?: number;
  breakPreference?: 'paragraph' | 'newline' | 'sentence';
}

export interface OpenClawSlackStreamingPreviewConfig {
  chunk?: OpenClawSlackStreamingChunkConfig;
  toolProgress?: boolean;
  commandText?: 'raw' | 'status';
}

export interface OpenClawSlackStreamingProgressConfig {
  label?: string | false;
  labels?: string[];
  maxLines?: number;
  maxLineChars?: number;
  render?: 'text' | 'rich';
  toolProgress?: boolean;
  commandText?: 'raw' | 'status';
  commentary?: boolean;
  narration?: boolean;
  nativeTaskCards?: boolean;
}

export interface OpenClawSlackStreamingCoalesceConfig {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
}

export interface OpenClawSlackStreamingBlockConfig {
  enabled?: boolean;
  coalesce?: OpenClawSlackStreamingCoalesceConfig;
}

export interface OpenClawSlackStreamingConfig {
  mode?: 'off' | 'partial' | 'block' | 'progress';
  chunkMode?: 'length' | 'newline';
  nativeTransport?: boolean;
  preview?: OpenClawSlackStreamingPreviewConfig;
  progress?: OpenClawSlackStreamingProgressConfig;
  block?: OpenClawSlackStreamingBlockConfig;
}

export interface OpenClawSlackExecApprovalConfig {
  enabled?: boolean | 'auto';
  approvers?: Array<string | number>;
  agentFilter?: string[];
  sessionFilter?: string[];
  target?: 'dm' | 'channel' | 'both';
}

export type OpenClawSlackCapabilitiesConfig = string[] | { interactiveReplies?: boolean };

export interface OpenClawSlackActionsConfig {
  reactions?: boolean;
  messages?: boolean;
  pins?: boolean;
  search?: boolean;
  permissions?: boolean;
  memberInfo?: boolean;
  channelInfo?: boolean;
  emojiList?: boolean;
}

export interface OpenClawSlackSlashCommandConfig {
  enabled?: boolean;
  name?: string;
  sessionPrefix?: string;
  ephemeral?: boolean;
}

export interface OpenClawSlackCommandsConfig {
  native?: boolean | 'auto';
  nativeSkills?: boolean | 'auto';
}

export interface OpenClawSlackMarkdownConfig {
  tables?: 'off' | 'bullets' | 'code' | 'block';
}

export interface OpenClawSlackMentionPatternsConfig {
  mode?: 'allow' | 'deny';
  allowIn?: string[];
  denyIn?: string[];
}

export interface OpenClawSlackThreadConfig {
  historyScope?: 'thread' | 'channel';
  inheritParent?: boolean;
  initialHistoryLimit?: number;
}

export interface OpenClawSlackHeartbeatConfig {
  showOk?: boolean;
  showAlerts?: boolean;
  useIndicator?: boolean;
}

export interface OpenClawSlackHealthMonitorConfig {
  enabled?: boolean;
}

export interface OpenClawSlackAccountConfig {
  name?: string;
  mode?: OpenClawSlackMode;
  enterpriseOrgInstall?: boolean;
  socketMode?: OpenClawSlackSocketModeConfig;
  relay?: OpenClawSlackRelayConfig;
  signingSecret?: OpenClawSlackSecretInput;
  webhookPath?: string;
  capabilities?: OpenClawSlackCapabilitiesConfig;
  execApprovals?: OpenClawSlackExecApprovalConfig;
  markdown?: OpenClawSlackMarkdownConfig;
  commands?: OpenClawSlackCommandsConfig;
  configWrites?: boolean;
  enabled?: boolean;
  botToken?: OpenClawSlackSecretInput;
  appToken?: OpenClawSlackSecretInput;
  userToken?: OpenClawSlackSecretInput;
  userTokenReadOnly?: boolean;
  allowBots?: boolean | 'mentions';
  botLoopProtection?: OpenClawSlackBotLoopProtectionConfig;
  dangerouslyAllowNameMatching?: boolean;
  requireMention?: boolean;
  implicitMentions?: OpenClawSlackImplicitMentionsConfig;
  groupPolicy?: OpenClawSlackGroupPolicy;
  mentionPatterns?: OpenClawSlackMentionPatternsConfig;
  contextVisibility?: OpenClawSlackContextVisibility;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, { historyLimit?: number }>;
  textChunkLimit?: number;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
  streaming?: OpenClawSlackStreamingConfig;
  mediaMaxMb?: number;
  reactionNotifications?: 'off' | 'own' | 'all' | 'allowlist';
  reactionAllowlist?: Array<string | number>;
  replyToMode?: OpenClawSlackReplyToMode;
  replyToModeByChatType?: Partial<Record<'direct' | 'group' | 'channel', OpenClawSlackReplyToMode>>;
  thread?: OpenClawSlackThreadConfig;
  presenceEvents?: OpenClawSlackPresenceEventsConfig;
  actions?: OpenClawSlackActionsConfig;
  slashCommand?: OpenClawSlackSlashCommandConfig;
  dmPolicy?: OpenClawSlackDmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  dm?: OpenClawSlackDmConfig;
  channels?: Record<string, OpenClawSlackChannelConfig>;
  heartbeat?: OpenClawSlackHeartbeatConfig;
  healthMonitor?: OpenClawSlackHealthMonitorConfig;
  responsePrefix?: string;
  ackReaction?: string;
  typingReaction?: string;
}

export interface OpenClawSlackConfig extends OpenClawSlackAccountConfig {
  accounts?: Record<string, OpenClawSlackAccountConfig>;
  defaultAccount?: string;
}

export type OpenClawSlackChannelId = string;
export type OpenClawSlackUserId = string;
export type OpenClawSlackMessageId = string;
export type OpenClawSlackThreadId = string;
export type OpenClawSlackFileId = string;
export type OpenClawSlackEmoji = string;
export type OpenClawSlackTarget = OpenClawSlackChannelId | OpenClawSlackUserId;

export type OpenClawPresentationTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type OpenClawPresentationButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

export type OpenClawPresentationAction =
  | { type: 'command'; command: string }
  | { type: 'callback'; value: string }
  | {
      type: 'approval';
      approvalId: string;
      approvalKind: 'exec' | 'plugin';
      decision: 'allow-once' | 'allow-always' | 'deny';
    }
  | { type: 'url'; url: string }
  | { type: 'web-app'; url: string; widgetId?: string }
  | { type: 'web-app'; url?: string; widgetId: string };

export interface OpenClawPresentationButton {
  label: string;
  action?: OpenClawPresentationAction;
  /** @deprecated Use action. */
  value?: string;
  /** @deprecated Use action with type "url". */
  url?: string;
  /** @deprecated Use action with type "web-app". */
  webApp?: { url: string };
  /** @deprecated Use action with type "web-app". */
  web_app?: { url: string };
  priority?: number;
  disabled?: boolean;
  reusable?: boolean;
  style?: OpenClawPresentationButtonStyle;
}

export interface OpenClawPresentationOption {
  label: string;
  action?: Extract<OpenClawPresentationAction, { type: 'command' | 'callback' }>;
  /** @deprecated Use action. */
  value?: string;
}

export interface OpenClawPresentationPieChart {
  type: 'chart';
  chartType: 'pie';
  title: string;
  segments: Array<{ label: string; value: number }>;
}

export interface OpenClawPresentationSeriesChart {
  type: 'chart';
  chartType: 'bar' | 'area' | 'line';
  title: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  xLabel?: string;
  yLabel?: string;
}

export interface OpenClawPresentationTable {
  type: 'table';
  caption: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  rowHeaderColumnIndex?: number;
}

export type OpenClawPresentationBlock =
  | { type: 'text'; text: string }
  | { type: 'context'; text: string }
  | { type: 'divider' }
  | { type: 'buttons'; buttons: OpenClawPresentationButton[] }
  | { type: 'select'; placeholder?: string; options: OpenClawPresentationOption[] }
  | OpenClawPresentationPieChart
  | OpenClawPresentationSeriesChart
  | OpenClawPresentationTable;

export interface OpenClawPresentation {
  title?: string;
  tone?: OpenClawPresentationTone;
  blocks: OpenClawPresentationBlock[];
}

export type OpenClawInteractiveReplyBlock =
  | { type: 'text'; text: string }
  | { type: 'buttons'; buttons: OpenClawPresentationButton[] }
  | { type: 'select'; placeholder?: string; options: OpenClawPresentationOption[] };

export interface OpenClawInteractiveReply {
  blocks: OpenClawInteractiveReplyBlock[];
}

export interface OpenClawSlackOperationOptions {
  accountId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  directOperator?: boolean;
  idempotencyKey?: string;
}

export interface OpenClawSlackMessageActionRequest {
  channel: 'slack';
  action: OpenClawSlackActionName;
  params: Record<string, unknown>;
  accountId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  conversationReadOrigin?: 'direct-operator';
  idempotencyKey: string;
}

export type OpenClawSlackActionName =
  | 'send'
  | 'upload-file'
  | 'download-file'
  | 'read'
  | 'edit'
  | 'delete'
  | 'react'
  | 'reactions'
  | 'pin'
  | 'unpin'
  | 'list-pins'
  | 'member-info'
  | 'emoji-list';

type ForwardCompatible<T extends object> = T & Record<string, unknown>;

export interface OpenClawSlackMessageSummary extends Record<string, unknown> {
  ts?: string;
  timestampMs?: number;
  timestampUtc?: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: OpenClawSlackReaction[];
  files?: Array<{ id?: string; name?: string; mimetype?: string } & Record<string, unknown>>;
}

export interface OpenClawSlackReaction extends Record<string, unknown> {
  name?: string;
  count?: number;
  users?: string[];
}

export interface OpenClawSlackPin extends Record<string, unknown> {
  type?: string;
  message?: ({ ts?: string; timestampMs?: number; timestampUtc?: string; text?: string } & Record<string, unknown>);
  file?: ({ id?: string; name?: string } & Record<string, unknown>);
}

export type OpenClawMessageReceiptPartKind =
  | 'text'
  | 'media'
  | 'voice'
  | 'poll'
  | 'card'
  | 'preview'
  | 'unknown';

export interface OpenClawMessageReceiptPart extends Record<string, unknown> {
  platformMessageId: string;
  kind: OpenClawMessageReceiptPartKind;
  index: number;
  threadId?: string;
  replyToId?: string;
  raw?: Record<string, unknown>;
}

export interface OpenClawMessageReceipt extends Record<string, unknown> {
  primaryPlatformMessageId?: string;
  platformMessageIds: string[];
  parts: OpenClawMessageReceiptPart[];
  threadId?: string;
  replyToId?: string;
  editToken?: string;
  deleteToken?: string;
  sentAt: number;
  raw?: readonly Record<string, unknown>[];
}

export type OpenClawSlackSendResult = ForwardCompatible<{
  channelId: string;
  messageId: string;
  receipt: OpenClawMessageReceipt;
  threadTs?: string;
}>;
export type OpenClawSlackSendActionResult = ForwardCompatible<{ ok: true; result: OpenClawSlackSendResult }>;
export type OpenClawSlackMutationResult = ForwardCompatible<{ ok: true }>;
export type OpenClawSlackAddReactionResult = ForwardCompatible<{ ok: true; added: string }>;
export type OpenClawSlackRemoveReactionResult = ForwardCompatible<{ ok: true; removed: string }>;
export type OpenClawSlackClearReactionsResult = ForwardCompatible<{ ok: true; removed: string[] }>;
export type OpenClawSlackListReactionsResult = ForwardCompatible<{ ok: true; reactions: OpenClawSlackReaction[] }>;
export type OpenClawSlackReadResult = ForwardCompatible<{
  ok: true;
  channelId: string;
  threadId?: string;
  messages: OpenClawSlackMessageSummary[];
  hasMore: boolean;
}>;
export type OpenClawSlackPinsResult = ForwardCompatible<{ ok: true; pins: OpenClawSlackPin[] }>;
export type OpenClawSlackMemberInfoResult = ForwardCompatible<{
  ok: true;
  info: Record<string, unknown>;
}>;
export type OpenClawSlackEmojiListResult = ForwardCompatible<{
  ok: true;
  emojis: ForwardCompatible<{ emoji?: Record<string, string> }>;
}>;
export type OpenClawSlackDownloadResult =
  | ForwardCompatible<{ ok: false; error: string }>
  | ForwardCompatible<{
      ok?: true;
      fileId: string;
      path: string;
      contentType?: string;
      placeholder?: string;
      media: ForwardCompatible<{
        mediaUrl: string;
        outbound: false;
        contentType?: string;
      }>;
    }>;

interface OpenClawSlackSendMessageInputBase {
  to: OpenClawSlackTarget;
  threadId?: OpenClawSlackThreadId | null;
  replyTo?: OpenClawSlackMessageId;
  topLevel?: boolean;
}

type OpenClawSlackNonMediaContent =
  | { message: string; presentation?: OpenClawPresentation; /** @deprecated Use presentation. */ interactive?: OpenClawInteractiveReply }
  | { message?: string; presentation: OpenClawPresentation; /** @deprecated Use presentation. */ interactive?: OpenClawInteractiveReply }
  | { message?: string; presentation?: OpenClawPresentation; /** @deprecated Use presentation. */ interactive: OpenClawInteractiveReply };

export type OpenClawSlackSendMessageInput = OpenClawSlackSendMessageInputBase & (
  | ({ media: string; replyBroadcast?: never } & Partial<OpenClawSlackNonMediaContent>)
  | ({ media?: never; replyBroadcast?: boolean } & OpenClawSlackNonMediaContent)
);

export interface OpenClawSlackUploadFileInput {
  to: OpenClawSlackTarget;
  filePath: string;
  initialComment?: string;
  filename?: string;
  title?: string;
  threadId?: OpenClawSlackThreadId | null;
  replyTo?: OpenClawSlackMessageId;
  topLevel?: boolean;
}

interface OpenClawSlackEditMessageInputBase {
  channelId: OpenClawSlackChannelId;
  messageId: OpenClawSlackMessageId;
}

export type OpenClawSlackEditMessageInput = OpenClawSlackEditMessageInputBase & (
  | { message: string; presentation?: OpenClawPresentation }
  | { message?: string; presentation: OpenClawPresentation }
);

interface OpenClawSlackDownloadFileInputBase {
  fileId: OpenClawSlackFileId;
  threadId?: OpenClawSlackThreadId;
}

export type OpenClawSlackDownloadFileInput = OpenClawSlackDownloadFileInputBase & (
  | { channelId: OpenClawSlackChannelId; to?: OpenClawSlackTarget }
  | { channelId?: OpenClawSlackChannelId; to: OpenClawSlackTarget }
);

export interface OpenClawSlackReadMessagesInput {
  channelId: OpenClawSlackChannelId;
  limit?: number;
  before?: string;
  after?: string;
  threadId?: OpenClawSlackThreadId;
  messageId?: OpenClawSlackMessageId;
}


export interface OpenClawSlackMessageReference {
  channelId: OpenClawSlackChannelId;
  messageId: OpenClawSlackMessageId;
}

export interface OpenClawSlackReactionInput extends OpenClawSlackMessageReference {
  emoji: OpenClawSlackEmoji;
}

export interface OpenClawSlackAccountStatus extends Record<string, unknown> {
  accountId?: string;
  name?: string;
  mode?: OpenClawSlackMode;
  configured?: boolean;
  enabled?: boolean;
  running?: boolean;
  connected?: boolean;
  authenticated?: boolean;
  healthState?: string;
  lastError?: string;
  lastProbeAt?: number;
  botTokenSource?: string;
  appTokenSource?: string;
  signingSecretSource?: string;
  userTokenSource?: string;
  botTokenStatus?: 'available' | 'configured_unavailable' | 'missing';
  appTokenStatus?: 'available' | 'configured_unavailable' | 'missing';
  signingSecretStatus?: 'available' | 'configured_unavailable' | 'missing';
  userTokenStatus?: 'available' | 'configured_unavailable' | 'missing';
  probe?: Record<string, unknown>;
}

export type OpenClawSlackStartResult = ForwardCompatible<{
  channel: 'slack';
  accountId: string;
  started: boolean;
}>;
export type OpenClawSlackStopResult = ForwardCompatible<{
  channel: 'slack';
  accountId: string;
  stopped: boolean;
}>;
export type OpenClawSlackLogoutResult = ForwardCompatible<{
  channel: 'slack';
  accountId: string;
  cleared: boolean;
}>;

export type OpenClawSlackPluginInstallAction =
  | { source: 'clawhub'; packageName: string }
  | { source: 'official'; pluginId: string };

export interface OpenClawSlackPluginInfo extends Record<string, unknown> {
  id: string;
  name: string;
  packageName?: string;
  description?: string;
  version?: string;
  kind?: string[];
  origin?: string;
  installed: boolean;
  enabled: boolean;
  state: 'enabled' | 'disabled' | 'not-installed' | 'error';
  install?: OpenClawSlackPluginInstallAction;
  error?: string;
  removable?: boolean;
}

export interface OpenClawSlackPluginsListResult extends Record<string, unknown> {
  plugins: OpenClawSlackPluginInfo[];
  diagnostics: unknown[];
  mutationAllowed: boolean;
}

export type OpenClawSlackPluginSupport =
  | { supported: false; mutationAllowed: false }
  | { supported: true; mutationAllowed: boolean; plugin?: OpenClawSlackPluginInfo };

export type OpenClawSlackPluginInstallResult = ForwardCompatible<{
  ok: true;
  plugin: OpenClawSlackPluginInfo;
  restartRequired: true;
  warnings?: string[];
}>;
export type OpenClawSlackPluginEnabledResult = ForwardCompatible<{
  ok: true;
  plugin: OpenClawSlackPluginInfo;
  restartRequired: boolean;
  warnings?: string[];
}>;
export type OpenClawSlackPluginUninstallResult = ForwardCompatible<{
  ok: true;
  pluginId: string;
  restartRequired: true;
  removed: string[];
  warnings?: string[];
}>;
export type OpenClawSlackPluginRefreshResult = ForwardCompatible<{ ok: true }>;

export interface OpenClawSlackCommandArgument {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  choices?: Array<{ value: string; label: string }>;
  dynamic?: boolean;
}

export interface OpenClawSlackCommand {
  name: string;
  nativeName?: string;
  textAliases?: string[];
  description: string;
  category?: 'session' | 'options' | 'status' | 'management' | 'media' | 'tools' | 'docks';
  source: 'native' | 'skill' | 'plugin';
  scope: 'text' | 'native' | 'both';
  acceptsArgs: boolean;
  args?: OpenClawSlackCommandArgument[];
}

export interface OpenClawSlackCommandListOptions {
  agentId?: string;
  scope?: 'text' | 'native' | 'both';
  includeArgs?: boolean;
}

export type OpenClawSlackCommandRunnerResult =
  | string
  | { exitCode?: number; exit_code?: number; stdout?: string; stderr?: string };

export interface OpenClawSlackProviderOptions {
  runCommand?: (command: string) => Promise<OpenClawSlackCommandRunnerResult>;
}

export interface OpenClawSlackPairingRequest extends Record<string, unknown> {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

export type OpenClawSlackPairingListResult = ForwardCompatible<{
  channel: 'slack';
  requests: OpenClawSlackPairingRequest[];
}>;

export type OpenClawSlackPairingApprovalResult = ForwardCompatible<{
  channel: 'slack';
  approved: true;
  code: string;
  mayBootstrapCommandOwner: true;
  raw?: string;
}>;

export interface OpenClawSlackClient {
  configGet(): Promise<Record<string, unknown>>;
  configSchemaLookup(path: string): Promise<OpenClawConfigSchemaLookupResult>;
  configPatch(patch: Record<string, unknown>): Promise<unknown>;
  channelsStatus(probe?: boolean, timeoutMs?: number, channel?: string): Promise<Record<string, unknown>>;
  channelsStart(channel: string, accountId?: string): Promise<unknown>;
  channelsStop(channel: string, accountId?: string): Promise<unknown>;
  channelsLogout(channel: string, accountId?: string): Promise<unknown>;
  messageAction(request: OpenClawSlackMessageActionRequest): Promise<unknown>;
  pluginsList(): Promise<unknown>;
  pluginsInstall(action: OpenClawSlackPluginInstallAction): Promise<unknown>;
  pluginsSetEnabled(params: { pluginId: string; enabled: boolean }): Promise<unknown>;
  pluginsUninstall(params: { pluginId: string }): Promise<unknown>;
  pluginsRefresh(): Promise<unknown>;
  commandsList(params: {
    provider: string;
    agentId?: string;
    scope?: 'text' | 'native' | 'both';
    includeArgs?: boolean;
  }): Promise<{ commands: OpenClawSlackCommand[] }>;
}

type OpenClawSlackTransportConfigurationBase = Omit<
  OpenClawSlackAccountConfig,
  'mode' | 'botToken' | 'appToken' | 'signingSecret' | 'relay' | 'socketMode' | 'webhookPath'
>;

export type OpenClawSlackSocketConfiguration = OpenClawSlackTransportConfigurationBase & {
  botToken: OpenClawSlackSecretInput;
  appToken: OpenClawSlackSecretInput;
  socketMode?: OpenClawSlackSocketModeConfig;
};
export type OpenClawSlackHttpConfiguration = OpenClawSlackTransportConfigurationBase & {
  botToken: OpenClawSlackSecretInput;
  signingSecret: OpenClawSlackSecretInput;
  webhookPath?: string;
};
export type OpenClawSlackRelayConfiguration = OpenClawSlackTransportConfigurationBase & {
  botToken: OpenClawSlackSecretInput;
  relay: Required<OpenClawSlackRelayConfig>;
};

export type OpenClawSlackAccountConfigPatch = {
  [K in keyof OpenClawSlackAccountConfig]?: OpenClawSlackAccountConfig[K] | null;
};

export type OpenClawSlackConfigPatch = OpenClawSlackAccountConfigPatch & {
  accounts?: Record<string, OpenClawSlackAccountConfigPatch | null> | null;
  defaultAccount?: string | null;
};

export interface OpenClawSlackEnsurePluginResult {
  plugin: OpenClawSlackPluginInfo;
  changed: boolean;
  restartRequired: boolean;
  warnings?: string[];
}

const SAFE_CLI_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PAIRING_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
let idempotencySequence = 0;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, cloneValue(entry)])) as T;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be nonempty.`);
  return normalized;
}

function hasSecret(value: OpenClawSlackSecretInput | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value && value.provider.trim() && value.id.trim());
}

function assertSecret(value: OpenClawSlackSecretInput | undefined, label: string): void {
  if (!hasSecret(value)) throw new Error(`${label} is required.`);
}

function assertRelayUrl(raw: string): string {
  const value = requiredString(raw, 'Slack relay URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Slack relay URL is invalid.');
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'wss:' && !(localhost && url.protocol === 'ws:')) {
    throw new Error('Slack relay URL must use wss except for localhost.');
  }
  return value;
}

function idempotencyKey(explicit?: string): string {
  if (explicit !== undefined) return requiredString(explicit, 'Idempotency key');
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return `slack-${randomUUID.call(globalThis.crypto)}`;
  idempotencySequence += 1;
  return `slack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${idempotencySequence.toString(36)}`;
}

function commandOutput(result: OpenClawSlackCommandRunnerResult): { stdout: string; stderr: string; exitCode: number } {
  if (typeof result === 'string') return { stdout: result, stderr: '', exitCode: 0 };
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? result.exit_code ?? 0,
  };
}

function cliPluginEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const record = asRecord(value);
  if (!record) throw new Error('OpenClaw plugin inventory returned unexpected JSON.');
  for (const key of ['plugins', 'entries', 'items']) {
    const collection = record[key];
    if (Array.isArray(collection)) {
      return collection.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
    const mapped = asRecord(collection);
    if (mapped) {
      return Object.entries(mapped).flatMap(([id, entry]) => {
        const plugin = asRecord(entry);
        return plugin ? [{ id, ...plugin }] : [];
      });
    }
  }
  throw new Error('OpenClaw plugin inventory returned unexpected JSON.');
}

function cliSlackPlugin(stdout: string): OpenClawSlackPluginInfo | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('OpenClaw plugin inventory returned invalid JSON.');
  }
  const entry = cliPluginEntries(parsed).find((candidate) => {
    const identifiers = [candidate.id, candidate.pluginId, candidate.packageName, candidate.package, candidate.spec];
    return identifiers.some((identifier) => {
      const normalized = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
      return normalized === 'slack' || normalized === '@openclaw/slack' || normalized.startsWith('@openclaw/slack@');
    });
  });
  if (!entry) return undefined;
  const state = [entry.state, entry.status, entry.loadStatus]
    .find((value): value is string => typeof value === 'string')
    ?.trim().toLowerCase();
  const installed = entry.installed !== false && !['not-installed', 'missing', 'uninstalled'].includes(state ?? '');
  const enabled = typeof entry.enabled === 'boolean'
    ? entry.enabled
    : installed && !['disabled', 'blocked', 'denied', 'not-enabled'].includes(state ?? '');
  return {
    ...entry,
    id: 'slack',
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : 'Slack',
    installed,
    enabled,
    state: state ?? (enabled ? 'enabled' : 'disabled'),
  } as OpenClawSlackPluginInfo;
}

export class OpenClawSlackProvider {
  constructor(
    private readonly client: OpenClawSlackClient,
    private readonly options: OpenClawSlackProviderOptions = {},
  ) {}

  async getConfig(): Promise<OpenClawSlackConfig | undefined> {
    const config = await this.client.configGet();
    return cloneValue(asRecord(asRecord(config.channels)?.slack) as OpenClawSlackConfig | undefined);
  }

  async getSchema(): Promise<OpenClawConfigSchemaLookupResult> {
    return await this.client.configSchemaLookup('channels.slack');
  }

  async getAccountConfig(accountId: string): Promise<OpenClawSlackAccountConfig | undefined> {
    const id = requiredString(accountId, 'Slack account id');
    const config = await this.getConfig();
    if (!config?.accounts || !Object.prototype.hasOwnProperty.call(config.accounts, id)) return undefined;
    return cloneValue(config.accounts[id]);
  }

  async patchConfig(patch: OpenClawSlackConfigPatch): Promise<void> {
    await this.client.configPatch({ channels: { slack: patch } });
  }

  async patchAccount(accountId: string, patch: OpenClawSlackAccountConfigPatch): Promise<void> {
    const id = requiredString(accountId, 'Slack account id');
    await this.client.configPatch({ channels: { slack: { accounts: { [id]: patch } } } });
  }

  async configureSocket(config: OpenClawSlackSocketConfiguration, accountId?: string): Promise<void> {
    assertSecret(config.botToken, 'Slack bot token');
    assertSecret(config.appToken, 'Slack app token');
    await this.patchTransport({ ...config, mode: 'socket' }, accountId);
  }

  async configureHttp(config: OpenClawSlackHttpConfiguration, accountId?: string): Promise<void> {
    assertSecret(config.botToken, 'Slack bot token');
    assertSecret(config.signingSecret, 'Slack signing secret');
    await this.patchTransport({ ...config, mode: 'http' }, accountId);
  }

  async configureRelay(config: OpenClawSlackRelayConfiguration, accountId?: string): Promise<void> {
    assertSecret(config.botToken, 'Slack bot token');
    assertSecret(config.relay.authToken, 'Slack relay auth token');
    requiredString(config.relay.gatewayId, 'Slack relay gateway id');
    if (config.enterpriseOrgInstall === true) {
      throw new Error('Slack relay mode is unavailable for Enterprise Grid organization installs.');
    }
    const relay = { ...config.relay, url: assertRelayUrl(config.relay.url) };
    await this.patchTransport({ ...config, enterpriseOrgInstall: false, relay, mode: 'relay' }, accountId);
  }

  async removeConfig(): Promise<void> {
    await this.client.configPatch({ channels: { slack: null } });
  }

  async removeAccount(accountId: string): Promise<void> {
    const id = requiredString(accountId, 'Slack account id');
    await this.client.configPatch({ channels: { slack: { accounts: { [id]: null } } } });
  }

  async setDefaultAccount(accountId: string): Promise<void> {
    const id = requiredString(accountId, 'Slack account id');
    await this.client.configPatch({ channels: { slack: { defaultAccount: id } } });
  }

  async status(accountId?: string): Promise<OpenClawSlackAccountStatus | undefined> {
    return this.readStatus(false, accountId);
  }

  async probe(accountId?: string, timeoutMs?: number): Promise<OpenClawSlackAccountStatus | undefined> {
    return this.readStatus(true, accountId, timeoutMs);
  }

  async start(accountId?: string): Promise<OpenClawSlackStartResult> {
    return await this.client.channelsStart(
      'slack',
      accountId === undefined ? undefined : requiredString(accountId, 'Slack account id'),
    ) as OpenClawSlackStartResult;
  }

  async stop(accountId?: string): Promise<OpenClawSlackStopResult> {
    return await this.client.channelsStop(
      'slack',
      accountId === undefined ? undefined : requiredString(accountId, 'Slack account id'),
    ) as OpenClawSlackStopResult;
  }

  async logout(accountId?: string): Promise<OpenClawSlackLogoutResult> {
    return await this.client.channelsLogout(
      'slack',
      accountId === undefined ? undefined : requiredString(accountId, 'Slack account id'),
    ) as OpenClawSlackLogoutResult;
  }

  async pluginInfo(): Promise<OpenClawSlackPluginInfo | undefined> {
    const support = await this.pluginSupport();
    return support.supported ? support.plugin : undefined;
  }

  async pluginSupport(): Promise<OpenClawSlackPluginSupport> {
    try {
      const result = await this.client.pluginsList() as OpenClawSlackPluginsListResult;
      const plugin = result.plugins.find((candidate) => candidate.id === 'slack');
      return {
        supported: true,
        mutationAllowed: result.mutationAllowed,
        ...(plugin ? { plugin } : {}),
      };
    } catch (error) {
      if (isOpenClawGatewayMethodUnsupported(error, 'plugins.list')) {
        return { supported: false, mutationAllowed: false };
      }
      throw error;
    }
  }

  async ensurePluginInstalled(): Promise<OpenClawSlackEnsurePluginResult> {
    const support = await this.pluginSupport();
    if (!support.supported) throw new Error('Slack support management is unavailable on this gateway version.');
    const current = support.plugin;
    if (current?.installed) {
      if (current.enabled) {
        return { plugin: current, changed: false, restartRequired: false };
      }
      if (!support.mutationAllowed) throw new Error('Slack support changes are not allowed by this gateway.');
      const enabled = await this.setPluginEnabled(true);
      return {
        plugin: enabled.plugin,
        changed: true,
        restartRequired: enabled.restartRequired,
        ...(enabled.warnings ? { warnings: enabled.warnings } : {}),
      };
    }
    if (!current?.install) {
      throw new Error('Slack plugin is not installed and no install action is advertised.');
    }
    if (!support.mutationAllowed) throw new Error('Slack support changes are not allowed by this gateway.');
    const installed = await this.client.pluginsInstall(current.install) as OpenClawSlackPluginInstallResult;
    if (installed.plugin.enabled) {
      return {
        plugin: installed.plugin,
        changed: true,
        restartRequired: installed.restartRequired,
        ...(installed.warnings ? { warnings: installed.warnings } : {}),
      };
    }
    const enabled = await this.setPluginEnabled(true);
    const warnings = [...(installed.warnings ?? []), ...(enabled.warnings ?? [])];
    return {
      plugin: enabled.plugin,
      changed: true,
      restartRequired: installed.restartRequired || enabled.restartRequired,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async ensurePluginInstalledWithCli(): Promise<OpenClawSlackEnsurePluginResult> {
    const runner = this.requireCommandRunner();
    const listed = commandOutput(await runner('openclaw plugins list --json'));
    if (listed.exitCode !== 0) {
      throw new Error(listed.stderr.trim() || listed.stdout.trim() || 'Could not inspect Slack support.');
    }
    const current = cliSlackPlugin(listed.stdout.trim());
    if (current?.installed && current.enabled) {
      return { plugin: current, changed: false, restartRequired: false };
    }
    if (!current?.installed) {
      const installed = commandOutput(await runner('openclaw plugins install @openclaw/slack'));
      if (installed.exitCode !== 0) {
        throw new Error(installed.stderr.trim() || installed.stdout.trim() || 'Could not install Slack support.');
      }
    }
    const enabled = commandOutput(await runner('openclaw plugins enable slack'));
    if (enabled.exitCode !== 0) {
      throw new Error(enabled.stderr.trim() || enabled.stdout.trim() || 'Could not enable Slack support.');
    }
    const verified = commandOutput(await runner('openclaw plugins list --json'));
    if (verified.exitCode !== 0) {
      throw new Error(verified.stderr.trim() || verified.stdout.trim() || 'Could not verify Slack support after installation.');
    }
    const plugin = cliSlackPlugin(verified.stdout.trim());
    if (!plugin?.installed || !plugin.enabled) {
      throw new Error('Slack support is still unavailable after installation. Check the active OpenClaw state directory.');
    }
    return {
      plugin,
      changed: true,
      restartRequired: true,
    };
  }

  async verifyPluginRuntimeWithCli(): Promise<OpenClawSlackPluginInfo> {
    const result = commandOutput(await this.requireCommandRunner()('openclaw plugins inspect slack --runtime --json'));
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Could not verify the running Slack support.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error('Slack runtime inspection returned invalid JSON.');
    }
    const record = asRecord(parsed);
    const plugin = asRecord(record?.plugin) ?? record;
    if (!plugin || plugin.id !== 'slack') throw new Error('Slack runtime inspection did not report the Slack support.');
    return {
      ...plugin,
      id: 'slack',
      name: typeof plugin.name === 'string' && plugin.name.trim() ? plugin.name : 'Slack',
      installed: true,
      enabled: plugin.enabled !== false,
      state: typeof plugin.status === 'string' ? plugin.status : typeof plugin.state === 'string' ? plugin.state : 'loaded',
    } as OpenClawSlackPluginInfo;
  }

  async restartGateway(): Promise<void> {
    const result = commandOutput(await this.requireCommandRunner()('openclaw gateway restart'));
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Could not restart the OpenClaw gateway.');
    }
  }

  async setPluginEnabled(enabled: boolean): Promise<OpenClawSlackPluginEnabledResult> {
    return await this.client.pluginsSetEnabled({ pluginId: 'slack', enabled }) as OpenClawSlackPluginEnabledResult;
  }

  async uninstallPlugin(): Promise<OpenClawSlackPluginUninstallResult> {
    return await this.client.pluginsUninstall({ pluginId: 'slack' }) as OpenClawSlackPluginUninstallResult;
  }

  async refreshPlugins(): Promise<OpenClawSlackPluginRefreshResult> {
    return await this.client.pluginsRefresh() as OpenClawSlackPluginRefreshResult;
  }

  async listCommands(options: OpenClawSlackCommandListOptions = {}): Promise<OpenClawSlackCommand[]> {
    const result = await this.client.commandsList({ provider: 'slack', ...options });
    return result.commands;
  }

  async listPairings(accountId?: string): Promise<OpenClawSlackPairingListResult> {
    const runner = this.requireCommandRunner();
    const account = accountId === undefined ? undefined : this.safeCliAccountId(accountId);
    const result = commandOutput(await runner(
      `openclaw pairing list slack${account ? ` --account ${account}` : ''} --json`,
    ));
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Slack pairing list failed.');
    const raw = result.stdout.trim();
    if (!raw) return { channel: 'slack', requests: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Slack pairing list returned invalid JSON.');
    }
    const record = asRecord(parsed);
    if (!record || record.channel !== 'slack' || !Array.isArray(record.requests)) {
      throw new Error('Slack pairing list returned an invalid response.');
    }
    return { ...record, channel: 'slack', requests: record.requests as OpenClawSlackPairingRequest[] };
  }

  async approvePairing(
    code: string,
    options: { accountId?: string; notify?: boolean } = {},
  ): Promise<OpenClawSlackPairingApprovalResult> {
    const runner = this.requireCommandRunner();
    const normalizedCode = code.trim().toUpperCase();
    if (!PAIRING_CODE.test(normalizedCode)) throw new Error('Slack pairing code is invalid.');
    const account = options.accountId === undefined ? undefined : this.safeCliAccountId(options.accountId);
    const command = `openclaw pairing approve slack ${normalizedCode}${account ? ` --account ${account}` : ''}${options.notify ? ' --notify' : ''}`;
    const result = commandOutput(await runner(command));
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Slack pairing approval failed.');
    return {
      channel: 'slack',
      approved: true,
      code: normalizedCode,
      mayBootstrapCommandOwner: true,
      ...(result.stdout.trim() ? { raw: result.stdout.trim() } : {}),
    };
  }

  async sendMessage(input: OpenClawSlackSendMessageInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackSendActionResult> {
    const hasMessage = typeof input.message === 'string' && input.message.trim().length > 0;
    const hasPresentation = input.presentation !== undefined && input.presentation.blocks.length > 0;
    const hasInteractive = input.interactive !== undefined && input.interactive.blocks.length > 0;
    const hasMedia = typeof input.media === 'string' && input.media.trim().length > 0;
    if (!hasMessage && !hasPresentation && !hasInteractive && !hasMedia) {
      throw new Error('Slack message content is required.');
    }
    if (input.presentation !== undefined && !hasPresentation) {
      throw new Error('Slack presentation must contain at least one block.');
    }
    if (input.interactive !== undefined && !hasInteractive) {
      throw new Error('Slack interactive reply must contain at least one block.');
    }
    if (input.media !== undefined && !hasMedia) {
      throw new Error('Slack media must be nonempty.');
    }
    if (input.media !== undefined && input.replyBroadcast !== undefined) {
      throw new Error('Slack media messages cannot set replyBroadcast.');
    }
    const params = { ...input, to: requiredString(input.to, 'Slack target') };
    return this.action('send', params, options);
  }

  async uploadFile(input: OpenClawSlackUploadFileInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackSendActionResult> {
    const params = {
      ...input,
      to: requiredString(input.to, 'Slack target'),
      filePath: requiredString(input.filePath, 'Slack upload file path'),
    };
    return this.action('upload-file', params, options);
  }

  async downloadFile(input: OpenClawSlackDownloadFileInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackDownloadResult> {
    const params: Record<string, unknown> = {
      ...input,
      fileId: requiredString(input.fileId, 'Slack file id'),
    };
    if (input.channelId !== undefined) params.channelId = requiredString(input.channelId, 'Slack channel id');
    if (input.to !== undefined) params.to = requiredString(input.to, 'Slack target');
    return this.action('download-file', params, options);
  }

  async readMessages(input: OpenClawSlackReadMessagesInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackReadResult> {
    return this.action('read', { ...input, channelId: requiredString(input.channelId, 'Slack channel id') }, options);
  }

  async editMessage(input: OpenClawSlackEditMessageInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackMutationResult> {
    const hasMessage = typeof input.message === 'string' && input.message.trim().length > 0;
    const hasPresentation = input.presentation !== undefined && input.presentation.blocks.length > 0;
    if (!hasMessage && !hasPresentation) throw new Error('Slack edited message content is required.');
    if (input.presentation !== undefined && !hasPresentation) {
      throw new Error('Slack presentation must contain at least one block.');
    }
    return this.action('edit', {
      ...input,
      channelId: requiredString(input.channelId, 'Slack channel id'),
      messageId: requiredString(input.messageId, 'Slack message id'),
    }, options);
  }

  async deleteMessage(input: OpenClawSlackMessageReference, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackMutationResult> {
    return this.messageReferenceAction('delete', input, options);
  }

  async addReaction(input: OpenClawSlackReactionInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackAddReactionResult> {
    return this.action('react', { ...this.messageReference(input), emoji: requiredString(input.emoji, 'Slack reaction') }, options);
  }

  async removeReaction(input: OpenClawSlackReactionInput, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackRemoveReactionResult> {
    return this.action('react', {
      ...this.messageReference(input),
      emoji: requiredString(input.emoji, 'Slack reaction'),
      remove: true,
    }, options);
  }

  async clearOwnReactions(input: OpenClawSlackMessageReference, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackClearReactionsResult> {
    return this.action('react', { ...this.messageReference(input), emoji: '' }, options);
  }

  async listReactions(input: OpenClawSlackMessageReference, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackListReactionsResult> {
    return this.messageReferenceAction('reactions', input, options);
  }

  async pinMessage(input: OpenClawSlackMessageReference, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackMutationResult> {
    return this.messageReferenceAction('pin', input, options);
  }

  async unpinMessage(input: OpenClawSlackMessageReference, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackMutationResult> {
    return this.messageReferenceAction('unpin', input, options);
  }

  async listPins(channelId: OpenClawSlackChannelId, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackPinsResult> {
    return this.action('list-pins', { channelId: requiredString(channelId, 'Slack channel id') }, options);
  }

  async getMemberInfo(userId: OpenClawSlackUserId, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackMemberInfoResult> {
    return this.action('member-info', { userId: requiredString(userId, 'Slack user id') }, options);
  }

  async listEmojis(limit?: number, options?: OpenClawSlackOperationOptions): Promise<OpenClawSlackEmojiListResult> {
    return this.action('emoji-list', limit === undefined ? {} : { limit }, options);
  }

  private async patchTransport(config: OpenClawSlackAccountConfig, accountId?: string): Promise<void> {
    if (accountId === undefined) await this.patchConfig(config);
    else await this.patchAccount(accountId, config);
  }

  private async readStatus(probe: boolean, accountId?: string, timeoutMs?: number): Promise<OpenClawSlackAccountStatus | undefined> {
    const requested = accountId === undefined ? undefined : requiredString(accountId, 'Slack account id');
    const result = await this.client.channelsStatus(probe, timeoutMs, 'slack');
    const accountsValue = asRecord(result.channelAccounts)?.slack;
    const accounts = Array.isArray(accountsValue)
      ? accountsValue.filter((entry): entry is OpenClawSlackAccountStatus => Boolean(asRecord(entry)))
      : Object.entries(asRecord(accountsValue) ?? {}).map(([id, entry]) => ({
          ...asRecord(entry),
          accountId: typeof asRecord(entry)?.accountId === 'string' ? asRecord(entry)?.accountId : id,
        } as OpenClawSlackAccountStatus));
    if (requested) return accounts.find((account) => account.accountId === requested);
    const defaultId = asRecord(result.channelDefaultAccountId)?.slack;
    if (typeof defaultId === 'string') {
      const selected = accounts.find((account) => account.accountId === defaultId);
      if (selected) return selected;
    }
    if (accounts.length > 0) return accounts[0];
    return asRecord(asRecord(result.channels)?.slack) as OpenClawSlackAccountStatus | undefined;
  }

  private requireCommandRunner(): NonNullable<OpenClawSlackProviderOptions['runCommand']> {
    if (!this.options.runCommand) throw new Error('Slack pairing commands are unavailable.');
    return this.options.runCommand;
  }

  private safeCliAccountId(accountId: string): string {
    const id = requiredString(accountId, 'Slack account id');
    if (!SAFE_CLI_ACCOUNT_ID.test(id)) throw new Error('Slack account id is unsafe for command execution.');
    return id;
  }

  private messageReference(input: OpenClawSlackMessageReference): OpenClawSlackMessageReference {
    return {
      channelId: requiredString(input.channelId, 'Slack channel id'),
      messageId: requiredString(input.messageId, 'Slack message id'),
    };
  }

  private messageReferenceAction<T extends Record<string, unknown>>(
    action: Extract<OpenClawSlackActionName, 'delete' | 'reactions' | 'pin' | 'unpin'>,
    input: OpenClawSlackMessageReference,
    options?: OpenClawSlackOperationOptions,
  ): Promise<T> {
    return this.action(action, { ...this.messageReference(input) }, options);
  }

  private action<T extends Record<string, unknown>>(
    action: OpenClawSlackActionName,
    params: Record<string, unknown>,
    options: OpenClawSlackOperationOptions = {},
  ): Promise<T> {
    const request: OpenClawSlackMessageActionRequest = {
      channel: 'slack',
      action,
      params,
      idempotencyKey: idempotencyKey(options.idempotencyKey),
    };
    if (options.accountId !== undefined) request.accountId = requiredString(options.accountId, 'Slack account id');
    if (options.sessionKey !== undefined) request.sessionKey = requiredString(options.sessionKey, 'Session key');
    if (options.sessionId !== undefined) request.sessionId = requiredString(options.sessionId, 'Session id');
    if (options.agentId !== undefined) request.agentId = requiredString(options.agentId, 'Agent id');
    if (options.directOperator) request.conversationReadOrigin = 'direct-operator';
    return this.client.messageAction(request) as Promise<T>;
  }
}
