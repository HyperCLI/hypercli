import { invoke } from "@tauri-apps/api/core";

export interface KeyValidation {
  valid: boolean;
  email: string | null;
  key_name: string | null;
  has_agents_capability: boolean;
  has_active_plan: boolean | null;
  detail: string | null;
}

export interface LauncherAgent {
  id: string;
  name: string;
  avatar_url: string | null;
  runtime: string | null;
  state: string;
  is_buzz: boolean;
  can_start: boolean;
  can_stop: boolean;
}

export interface BuzzConnectionMetadata {
  id: string;
  label: string;
  relay_url: string;
  owner_public_hex: string;
  owner_npub: string;
  keychain_ref: string;
}

export interface VisibleChannel {
  id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  is_member: boolean;
}

export interface BuzzCreateInput {
  name: string;
  instructions?: string | null;
  runtime: string;
  size?: string | null;
  model?: string | null;
  concurrency?: number | null;
  connection_id: string;
  channels: string[];
  respond_to: string;
  allowlist: string[];
}

export const listBuzzConnections = () =>
  invoke<BuzzConnectionMetadata[]>("list_buzz_connections");
export const saveBuzzConnection = (input: {
  label: string;
  relay: string;
  nsec: string;
}) => invoke<BuzzConnectionMetadata>("save_buzz_connection", { input });
export const removeBuzzConnection = (connectionId: string) =>
  invoke<void>("remove_buzz_connection", { connectionId });
export const listBuzzChannels = (connectionId: string) =>
  invoke<VisibleChannel[]>("list_buzz_channels", { connectionId });
export const createBuzzAgent = (input: BuzzCreateInput) =>
  invoke<LauncherAgent>("create_buzz_agent", { input });
export const openCreateWindow = () => invoke<void>("open_create_window");
export const openSettingsWindow = () => invoke<void>("open_settings_window");
export const openMainWindow = () => invoke<void>("open_main_window");
export const draftAgentPrompt = (keywords: string) =>
  invoke<string>("draft_agent_prompt", { keywords });

export const startLogin = () => invoke<void>("start_login");
export const mintApiKey = (sessionToken: string) =>
  invoke<string>("mint_api_key", { sessionToken });
export const saveApiKey = (apiKey: string) =>
  invoke<void>("save_api_key", { apiKey });
export const logout = () => invoke<boolean>("logout");
export const validateKey = () => invoke<KeyValidation>("validate_key");
export const listAgents = () => invoke<LauncherAgent[]>("list_agents");
export const createAgent = (input: {
  name?: string | null;
  size?: string | null;
  desktop: boolean;
}) => invoke<LauncherAgent>("create_agent", { input });
export const agentMetrics = (agentId: string) =>
  invoke<unknown>("agent_metrics", { agentId });
export const startAgent = (agentId: string) =>
  invoke<LauncherAgent>("start_agent", { agentId });
export const stopAgent = (agentId: string) =>
  invoke<LauncherAgent>("stop_agent", { agentId });
export const openAgentChat = (agentId: string) =>
  invoke<void>("open_agent_chat", { agentId });
export const openDashboard = () => invoke<void>("open_dashboard");
