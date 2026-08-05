// Injected before ui/app.js loads: a mock window.__TAURI__ backed by
// mutable state the tests read and tweak via window.__MOCK__. Tests can
// pre-seed state by installing window.__MOCK_OVERRIDES__ in an earlier
// init script.
(() => {
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
  window.__MOCK__ = state;

  const snapshot = () => ({
    ...state.status,
    installed: [...state.status.installed],
    missing: [...state.status.missing],
  });

  window.__TAURI__ = {
    core: {
      async invoke(cmd, args) {
        state.calls.push([cmd, args ?? null]);
        switch (cmd) {
          case "provider_status":
            return snapshot();
          case "validate_key":
            return { ...state.validation };
          case "list_agents":
            return state.agents.map((agent) => ({ ...agent, tags: [...agent.tags] }));
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
