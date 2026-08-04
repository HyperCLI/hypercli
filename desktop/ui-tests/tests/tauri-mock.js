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
      has_active_subscription: true,
      detail: null,
    },
    envKeyActive: false,
    calls: [],
    listeners: {},
  };
  const overrides = window.__MOCK_OVERRIDES__ || {};
  if (overrides.envKeyActive !== undefined) {
    state.envKeyActive = overrides.envKeyActive;
  }
  state.status = { ...state.status, ...(overrides.status || {}) };
  state.validation = { ...state.validation, ...(overrides.validation || {}) };
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
          case "install_providers":
            state.status.installed = NAMES.slice();
            state.status.missing = [];
            return snapshot();
          case "uninstall_providers":
            state.status.installed = [];
            state.status.missing = NAMES.slice();
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
