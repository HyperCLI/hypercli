// Injected before ui/app.js loads: a mock window.__TAURI__ backed by
// mutable state the tests read and tweak via window.__MOCK__. Tests can
// pre-seed state by installing window.__MOCK_OVERRIDES__ in an earlier
// init script.
(() => {
  const DEV_CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
  const CI_CHANNEL_ID = "22222222-2222-4222-8222-222222222222";
  const INTERNAL_CHANNEL_ID = "33333333-3333-4333-8333-333333333333";
  const NAMES = [
    "buzz-backend-hypercli",
    "buzz-backend-hypercli-buzz-agent",
    "buzz-backend-hypercli-opencode",
    "buzz-backend-hypercli-codex",
    "buzz-backend-hypercli-claude",
    "buzz-backend-hypercli-goose",
    "buzz-backend-hypercli-kimi",
  ];

  const state = {
    status: {
      installed: [],
      missing: NAMES.slice(),
      broken: [],
      translocated: false,
      has_api_key: false,
      config_error: null,
      bin_dir: "/home/test/.local/bin",
      bin_dir_exists: true,
    },
    validation: {
      valid: true,
      email: "test@hypercli.com",
      key_name: "Linux (ci)",
      has_agents_capability: true,
      has_editor_capability: true,
      has_active_plan: true,
      detail: null,
    },
    envKeyActive: false,
    agents: [
      {
        id: "40c42593-7d02-48f9-a3ff-6c7d6461f140",
        name: "Maverick",
        handle: "buzz-maverick",
        runtime: "claude-code",
        state: "running",
        tags: ["buzz_agent=public-key"],
        hostname: "maverick.hypercli.app",
        requested_size: "large",
        last_error: null,
        is_buzz: true,
        agent_public_key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        can_start: false,
        can_stop: true,
        can_restart: true,
        can_delete: false,
      },
      {
        id: "a3158a87-df87-44b0-bc8f-babf60b35d86",
        name: "Research",
        handle: null,
        runtime: "openclaw",
        state: "stopped",
        tags: [],
        hostname: null,
        requested_size: "small",
        last_error: null,
        is_buzz: false,
        can_start: true,
        can_stop: false,
        can_restart: false,
        can_delete: true,
      },
      {
        id: "b75d2036-05b5-46bc-9f67-3c48e7cf5934",
        name: "Goose",
        handle: "buzz-goose",
        runtime: "goose",
        state: "failed",
        tags: ["app=buzz", "buzz_agent=another-key"],
        hostname: null,
        requested_size: "medium",
        last_error: "Harness exited unexpectedly",
        is_buzz: true,
        can_start: false,
        can_stop: false,
        can_restart: true,
        can_delete: false,
      },
    ],
    agentDetails: {
      "40c42593-7d02-48f9-a3ff-6c7d6461f140": {
        name: "Maverick",
        instructions: "You are Maverick, a pragmatic coding agent.",
        runtime: "claude-code",
        size: "large",
        model: "",
        concurrency: 5,
        relay: "wss://dev.buzz.hypercli.com",
        connection_id: DEV_CONNECTION_ID,
        community: CI_CHANNEL_ID,
        respond_to: "allowlist",
        allowlist: ["npub1owner", "damian"],
        env: { GITHUB_ORG: "hypercli" },
        secret_env_keys: ["GITHUB_TOKEN"],
        recent_communities: [
          { id: CI_CHANNEL_ID, name: "#CI" },
          { id: INTERNAL_CHANNEL_ID, name: "Internal" },
        ],
      },
      "b75d2036-05b5-46bc-9f67-3c48e7cf5934": {
        name: "Goose",
        instructions: "Help with repository maintenance.",
        runtime: "goose",
        size: "medium",
        model: "kimi-k2.6",
        concurrency: null,
        relay: "wss://dev.buzz.hypercli.com",
        connection_id: DEV_CONNECTION_ID,
        community: CI_CHANNEL_ID,
        respond_to: "owner",
        allowlist: [],
        env: {},
        recent_communities: [{ id: CI_CHANNEL_ID, name: "#CI" }],
      },
    },
    runtimeAuth: {
      "40c42593-7d02-48f9-a3ff-6c7d6461f140": {
        authenticated: false,
        detail: "Claude Code is waiting for login.",
      },
    },
    runtimeLoginPolls: {},
    runtimeLoginImmediateComplete: false,
    runtimeLoginBeginDelayMs: 0,
    draftError: null,
    buzzConnections: [
      {
        id: DEV_CONNECTION_ID,
        label: "Dev Buzz",
        relay_url: "wss://dev.buzz.hypercli.com",
        channels: [
          { id: CI_CHANNEL_ID, name: "#CI" },
          { id: INTERNAL_CHANNEL_ID, name: "Internal" },
        ],
      },
    ],
    sshKeys: {},
    calls: [],
    listeners: {},
  };
  const overrides = window.__MOCK_OVERRIDES__ || {};
  if (overrides.envKeyActive !== undefined) {
    state.envKeyActive = overrides.envKeyActive;
  }
  state.status = { ...state.status, ...(overrides.status || {}) };
  state.validation = { ...state.validation, ...(overrides.validation || {}) };
  if (overrides.agents) state.agents = overrides.agents.map((agent) => ({ ...agent }));
  if (overrides.agentDetails) {
    for (const [id, detail] of Object.entries(overrides.agentDetails)) {
      state.agentDetails[id] = { ...(state.agentDetails[id] || {}), ...detail };
    }
  }
  if (overrides.runtimeAuth) state.runtimeAuth = { ...state.runtimeAuth, ...overrides.runtimeAuth };
  if (overrides.runtimeLoginImmediateComplete !== undefined) {
    state.runtimeLoginImmediateComplete = overrides.runtimeLoginImmediateComplete;
  }
  if (overrides.runtimeLoginBeginDelayMs !== undefined) {
    state.runtimeLoginBeginDelayMs = overrides.runtimeLoginBeginDelayMs;
  }
  if (overrides.draftError !== undefined) state.draftError = overrides.draftError;
  if (overrides.buzzConnections) state.buzzConnections = overrides.buzzConnections.map((item) => ({ ...item }));
  if (overrides.sshKeys) state.sshKeys = { ...state.sshKeys, ...overrides.sshKeys };
  window.__MOCK__ = state;

  const snapshot = () => ({
    ...state.status,
    installed: [...state.status.installed],
    missing: [...state.status.missing],
  });

  window.__TAURI__ = {
    core: {
      async invoke(cmd, args) {
        const recordedArgs = cmd === "save_buzz_connection"
          ? { ...args, input: { ...args?.input, nsec: "[redacted]" } }
          : cmd === "send_runtime_login_input"
            ? { ...args, value: "[redacted]" }
            : args ?? null;
        state.calls.push([cmd, recordedArgs]);
        switch (cmd) {
          case "provider_status":
            return snapshot();
          case "validate_key":
            return { ...state.validation };
          case "list_agents":
            return state.agents.map((agent) => ({ ...agent, tags: [...agent.tags] }));
          case "get_agent_detail": {
            const agent = state.agents.find((item) => item.id === args?.agentId);
            if (!agent) throw "Agent not found";
            return {
              ...agent,
              ...(state.agentDetails[agent.id] || {}),
              recent_communities: state.agentDetails[agent.id]?.recent_communities || [],
            };
          }
          case "list_buzz_connections":
            return state.buzzConnections.map((connection) => ({
              ...connection,
              channels: (connection.channels || []).map((channel) => ({ ...channel })),
            }));
          case "list_buzz_channels": {
            const connection = state.buzzConnections.find((item) => item.id === args?.connectionId);
            if (!connection) throw "Buzz connection not found";
            return (connection.channels || []).map((channel) => ({ ...channel }));
          }
          case "save_buzz_connection": {
            const connection = {
              id: "44444444-4444-4444-8444-444444444444",
              label: args?.input?.label,
              relay_url: args?.input?.relay,
              channels: [{ id: "55555555-5555-4555-8555-555555555555", name: "New channel" }],
            };
            state.buzzConnections.push(connection);
            return { ...connection };
          }
          case "draft_agent_prompt":
            if (state.draftError) throw state.draftError;
            return `You are a focused agent. ${args?.keywords} Keep responses concise and useful.`;
          case "runtime_auth_status":
            return state.runtimeAuth[args?.agentId] || { authenticated: false };
          case "begin_runtime_login":
            if (state.runtimeLoginBeginDelayMs) {
              await new Promise((resolve) => setTimeout(resolve, state.runtimeLoginBeginDelayMs));
            }
            if (state.runtimeLoginImmediateComplete) {
              state.runtimeAuth[args?.agentId] = { authenticated: true };
              return { completed: true, status: "completed" };
            }
            state.runtimeLoginPolls[args?.agentId] = 0;
            return {
              url: args?.runtime === "codex" ? "https://auth.openai.com/codex/device" : "https://claude.ai/oauth/authorize",
              code: "TEST-CODE",
              instructions: "Open the URL and complete sign in.",
              interactive_required: true,
            };
          case "poll_runtime_login": {
            const count = (state.runtimeLoginPolls[args?.agentId] || 0) + 1;
            state.runtimeLoginPolls[args?.agentId] = count;
            if (count >= 2) {
              state.runtimeAuth[args?.agentId] = { authenticated: true };
              return { completed: true, status: "completed" };
            }
            return { status: "waiting", instructions: "Waiting for browser sign in.", interactive_required: true };
          }
          case "send_runtime_login_input":
            return null;
          case "cancel_runtime_login":
            return null;
          case "ssh_key_status":
            return state.sshKeys[args?.agentId] || { configured: false };
          case "generate_ssh_key":
          case "import_ssh_key":
            state.sshKeys[args?.agentId] = { configured: true, fingerprint: "SHA256:test-agent-key" };
            return state.sshKeys[args?.agentId];
          case "pick_agent_avatar":
            return {
              upload_id: "44444444-4444-4444-8444-444444444444",
              preview_data_url: "data:image/png;base64,iVBORw0KGgo=",
              file_name: "maverick.png",
            };
          case "discard_agent_avatar":
            return null;
          case "save_agent": {
            const agent = state.agents.find((item) => item.id === args?.agentId);
            if (!agent) throw "Agent not found";
            const input = args?.input || {};
            state.agentDetails[agent.id] = { ...(state.agentDetails[agent.id] || {}), ...input };
            Object.assign(agent, {
              name: input.name ?? agent.name,
              runtime: input.runtime ?? agent.runtime,
              requested_size: input.size ?? agent.requested_size,
            });
            return { ...agent };
          }
          case "create_buzz_agent": {
            const input = args?.input || {};
            const id = `created-${state.agents.length + 1}`;
            const agent = {
              id,
              name: input.name,
              handle: null,
              runtime: input.runtime,
              state: "starting",
              tags: ["app=buzz"],
              hostname: null,
              requested_size: input.size,
              last_error: null,
              is_buzz: true,
              can_start: false,
              can_stop: true,
              can_restart: false,
              can_delete: false,
            };
            state.agents.push(agent);
            state.agentDetails[id] = { ...input };
            return { ...agent };
          }
          case "install_providers":
            state.status.installed = NAMES.slice();
            state.status.missing = [];
            state.status.broken = [];
            return snapshot();
          case "uninstall_providers":
            state.status.installed = [];
            state.status.missing = NAMES.slice();
            state.status.broken = [];
            return snapshot();
          case "save_api_key":
            if (!args?.apiKey?.trim()) throw "API key is empty";
            state.status.has_api_key = true;
            return null;
          case "logout":
            state.status.has_api_key = state.envKeyActive;
            return state.envKeyActive;
          case "mint_api_key":
            state.status.has_api_key = true;
            return state.validation.key_name;
          case "start_login":
          case "open_plans":
            return null;
          case "start_agent":
          case "restart_agent": {
            const agent = state.agents.find((item) => item.id === args?.agentId);
            if (!agent) throw "Agent not found";
            agent.state = "starting";
            agent.last_error = null;
            agent.can_start = false;
            agent.can_stop = true;
            agent.can_restart = false;
            agent.can_delete = false;
            return { ...agent };
          }
          case "stop_agent": {
            const agent = state.agents.find((item) => item.id === args?.agentId);
            if (!agent) throw "Agent not found";
            agent.state = "stopping";
            agent.can_start = false;
            agent.can_stop = false;
            agent.can_restart = false;
            agent.can_delete = false;
            return { ...agent };
          }
          case "delete_agent": {
            const index = state.agents.findIndex((item) => item.id === args?.agentId);
            if (index < 0) throw "Agent not found";
            if (state.agents[index].state !== "stopped") throw "Only stopped agents can be deleted";
            state.agents.splice(index, 1);
            return null;
          }
          case "is_auto_update_supported":
            return true;
          default:
            throw `unknown command ${cmd}`;
        }
      },
    },
    event: {
      async listen(name, callback) {
        state.listeners[name] = callback;
        return () => {};
      },
    },
    window: {
      getCurrentWindow: () => ({ setSize: async () => {} }),
      LogicalSize: function LogicalSize(width, height) {
        this.width = width;
        this.height = height;
      },
    },
    app: {
      getVersion: async () => "0.0.0-test",
    },
  };
})();
