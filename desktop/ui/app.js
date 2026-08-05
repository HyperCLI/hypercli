const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const statusEl = document.getElementById("status");
const agentListEl = document.getElementById("agent-list");
const agentsEmptyEl = document.getElementById("agents-empty");
const agentsSummaryEl = document.getElementById("agents-summary");
let agents = [];
let agentFilter = "buzz";
let agentsLoading = false;
let agentActionInFlight = false;
let editingAgent = null;
let editingDetail = null;
let buzzConnections = [];
let runtimeLoginToken = 0;
let runtimeLoginActive = false;
let channelLoadToken = 0;

const dashboardView = document.getElementById("dashboard-view");
const agentScreen = document.getElementById("agent-screen");
const agentForm = document.getElementById("agent-form");
const nativeRuntimes = new Set(["claude-code", "codex", "kimi-code"]);

// Window height follows content, capped. Width stays fixed.
const WINDOW_WIDTH = 440;
const MAX_HEIGHT = 720;
const TITLEBAR = 28;
const appWindow = getCurrentWindow();
const card = document.querySelector(".card");

// No artificial minimum beyond sanity: the shorter the window, the clearer
// it is that the user is done here.
const MIN_HEIGHT = 160;

function fitWindow() {
  const height = Math.min(
    MAX_HEIGHT,
    Math.max(MIN_HEIGHT, card.offsetHeight + TITLEBAR),
  );
  appWindow.setSize(new LogicalSize(WINDOW_WIDTH, height)).catch(() => {});
}

new ResizeObserver(fitWindow).observe(card);

// Footer: version + update state. "Up to date" is the resting state; the
// updater section (bottom of this file) revises it when an update is staged.
const versionLine = document.getElementById("version-line");

async function showRestingVersion() {
  try {
    const version = await window.__TAURI__.app.getVersion();
    versionLine.textContent = `HyperCLI ${version} · your app is up to date`;
  } catch {
    versionLine.textContent = "Your app is up to date";
  }
}
showRestingVersion();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

// Two-state FSM: disconnected (auth only) / connected (providers visible).
function render(status) {
  const connected = status.has_api_key;
  document.getElementById("auth-disconnected").hidden = connected;
  document.getElementById("auth-connected").hidden = !connected;
  document.getElementById("provider-section").hidden = !connected;
  document.getElementById("agents-section").hidden = !connected;
  if (status.config_error) setStatus(status.config_error, true);
  if (!connected) {
    agents = [];
    renderAgents();
    return;
  }

  const hint = document.getElementById("provider-hint");
  const list = document.getElementById("provider-list");
  const installBtn = document.getElementById("install-btn");
  document.getElementById("uninstall-btn").hidden = status.installed.length === 0;
  if (status.missing.length === 0) {
    // All good: one quiet line, nothing else.
    list.replaceChildren();
    hint.innerHTML = `<span class="ok-mark">✓</span> Providers installed in ${status.bin_dir}`;
    installBtn.textContent = "Reinstall";
    installBtn.classList.remove("primary");
    installBtn.classList.add("link");
  } else {
    // Show only what's wrong; Reinstall installs everything.
    list.replaceChildren(
      ...status.missing.map((name) => {
        const li = document.createElement("li");
        li.className = "miss";
        li.textContent = name;
        return li;
      }),
    );
    const broken = status.broken && status.broken.length > 0;
    const fresh = status.installed.length === 0 && !broken;
    hint.textContent = broken
      ? "Previously installed providers stopped working — reinstall to repair:"
      : fresh
        ? "Install the HyperCLI backend so your agents appear in Buzz."
        : "Some providers are missing:";
    installBtn.textContent = fresh ? "Install providers" : "Reinstall";
    installBtn.classList.add("primary");
    installBtn.classList.remove("link");
  }
}

function humanize(value) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}

function actionIcon(action) {
  const paths = {
    start: '<path d="M8 5.5v13l10-6.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    restart: '<path d="M19 8a7 7 0 1 0 1.2 7M19 8V3m0 5h-5"/>',
    delete: '<path d="M8 9v9m4-9v9m4-9v9M5 6h14M9 6V3h6v3m2 15H7L6 6h12z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[action]}</svg>`;
}

function actionButton(agent, action, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.agentId = agent.id;
  button.dataset.action = action;
  button.className = `agent-action ${className}`.trim();
  const accessibleLabel = `${label} ${agent.name || agent.handle || "agent"}`;
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
  button.innerHTML = actionIcon(action);
  button.disabled = agentsLoading || agentActionInFlight;
  return button;
}

function agentCard(agent) {
  const card = document.createElement("article");
  card.className = "agent-card";
  card.dataset.agentId = agent.id;
  if (agent.agent_public_key) card.dataset.agentPublicKey = agent.agent_public_key;
  card.setAttribute("aria-label", agent.name || agent.handle || "Agent");

  const main = document.createElement("div");
  main.className = "agent-main";
  const identity = document.createElement("div");
  identity.className = "agent-card-identity";
  const avatar = document.createElement("span");
  avatar.className = "agent-card-avatar";
  avatar.textContent = (agent.name?.trim()?.[0] || "H").toUpperCase();
  loadAvatar(avatar, agent.avatar_url);
  const name = document.createElement("span");
  name.className = "agent-name";
  name.textContent = agent.name || agent.handle || "Unnamed agent";
  name.title = name.textContent;
  const state = document.createElement("span");
  state.className = `agent-state ${agent.state}`;
  state.textContent = humanize(agent.state);
  identity.append(avatar, name);
  main.append(identity, state);
  card.append(main);

  const meta = document.createElement("div");
  meta.className = "agent-meta";
  for (const value of [
    agent.runtime && humanize(agent.runtime),
    agent.requested_size,
    agent.is_buzz && "Buzz",
  ].filter(Boolean)) {
    const item = document.createElement("span");
    item.textContent = value;
    meta.append(item);
  }
  card.append(meta);

  if (agent.last_error) {
    const error = document.createElement("p");
    error.className = "agent-error";
    error.textContent = agent.last_error;
    error.title = agent.last_error;
    card.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "agent-actions";
  if (agent.can_start) actions.append(actionButton(agent, "start", "Start"));
  if (agent.can_stop) actions.append(actionButton(agent, "stop", "Stop"));
  if (agent.can_restart) actions.append(actionButton(agent, "restart", "Restart"));
  if (agent.can_delete) {
    actions.append(actionButton(agent, "delete", "Delete", "danger"));
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "agent-edit";
  edit.dataset.agentId = agent.id;
  edit.dataset.action = "edit";
  edit.setAttribute("aria-label", `Edit ${agent.name || agent.handle || "agent"}`);
  edit.textContent = "Edit";
  actions.prepend(edit);
  if (actions.childElementCount) card.append(actions);

  return card;
}

function renderAgents() {
  const visible = agents.filter((agent) => agentFilter === "all" || agent.is_buzz);
  const buzzCount = agents.filter((agent) => agent.is_buzz).length;
  agentsSummaryEl.textContent = agentsLoading
    ? "Refreshing your agents…"
    : `${buzzCount} Buzz · ${agents.length} total`;
  agentListEl.replaceChildren(...visible.map(agentCard));
  agentsEmptyEl.hidden = agentsLoading || visible.length > 0;
  agentsEmptyEl.textContent = agentFilter === "buzz"
    ? "No Buzz agents yet. Create one in Buzz and it will appear here."
    : "No saved agents yet.";
  for (const button of document.querySelectorAll(".segmented [data-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.filter === agentFilter));
  }
}

async function refreshAgents() {
  if (agentsLoading || agentActionInFlight || document.getElementById("agents-section").hidden || dashboardView.hidden) return;
  agentsLoading = true;
  renderAgents();
  document.getElementById("agents-refresh").disabled = true;
  try {
    agents = await invoke("list_agents");
  } catch (error) {
    setStatus(`Could not load agents: ${String(error)}`, true);
  } finally {
    agentsLoading = false;
    document.getElementById("agents-refresh").disabled = false;
    renderAgents();
  }
}

for (const button of document.querySelectorAll(".segmented [data-filter]")) {
  button.addEventListener("click", () => {
    agentFilter = button.dataset.filter;
    renderAgents();
  });
}

document.getElementById("agents-refresh").addEventListener("click", refreshAgents);

agentListEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    const card = event.target.closest(".agent-card[data-agent-id]");
    if (card) void openAgentEditor(card.dataset.agentId);
    return;
  }
  event.stopPropagation();
  const agent = agents.find((candidate) => candidate.id === button.dataset.agentId);
  if (!agent) return;
  const action = button.dataset.action;
  if (action === "edit") {
    void openAgentEditor(agent.id);
    return;
  }
  if (action === "delete" && !window.confirm(`Delete ${agent.name || "this agent"}? This cannot be undone.`)) {
    return;
  }

  for (const actionButton of agentListEl.querySelectorAll("button")) {
    actionButton.disabled = true;
  }
  agentActionInFlight = true;
  const presentParticiple = {
    start: "Starting",
    stop: "Stopping",
    restart: "Restarting",
    delete: "Deleting",
  }[action];
  setStatus(`${presentParticiple} ${agent.name || "agent"}…`);
  try {
    await invoke(`${action}_agent`, { agentId: agent.id });
    setStatus(`${agent.name || "Agent"}: ${action} requested.`);
    agentActionInFlight = false;
    await refreshAgents();
  } catch (error) {
    setStatus(String(error), true);
    agentActionInFlight = false;
    await refreshAgents();
  }
});

function normalizeEnvironment(value) {
  if (Array.isArray(value)) return value.join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => `${key}=${item}`).join("\n");
  }
  return value || "";
}

function editorValue(detail, key, fallback = "") {
  if (detail?.[key] !== undefined && detail[key] !== null) return detail[key];
  if (detail?.launch_config?.[key] !== undefined && detail.launch_config[key] !== null) {
    return detail.launch_config[key];
  }
  return fallback;
}

function setEditorField(id, value) {
  document.getElementById(id).value = value ?? "";
}

function connectionChannels(connection) {
  return connection?.channels || connection?.communities || [];
}

function renderConnectionChannels(connection, extra = []) {
  const select = document.getElementById("agent-community");
  const selected = select.value;
  const channels = [...connectionChannels(connection), ...extra].filter((item, index, all) => {
    const value = typeof item === "string" ? item : item.id || item.channel || item.community;
    return value && all.findIndex((candidate) =>
      (typeof candidate === "string" ? candidate : candidate.id || candidate.channel || candidate.community) === value
    ) === index;
  });
  select.replaceChildren(
    Object.assign(document.createElement("option"), {
      value: "",
      textContent: channels.length ? "Choose a channel…" : "No visible channels",
    }),
    ...channels.map((item) => {
      const option = document.createElement("option");
      if (typeof item === "string") {
        option.value = item;
        option.textContent = item;
      } else {
        option.value = item.id || item.channel || item.community || "";
        option.textContent = item.name || item.label || option.value;
      }
      return option;
    }),
  );
  if (selected && channels.some((item) => (typeof item === "string" ? item : item.id || item.channel || item.community) === selected)) {
    select.value = selected;
  }
}

function renderConnectionSelect(selectedId = "") {
  const select = document.getElementById("agent-connection");
  select.replaceChildren(
    ...buzzConnections.map((connection) => {
      const option = document.createElement("option");
      option.value = connection.id;
      option.textContent = connection.label || connection.name || connection.relay_url || connection.relay;
      return option;
    }),
    Object.assign(document.createElement("option"), {
      value: "__add__",
      textContent: "Add connection…",
    }),
  );
  if (selectedId && buzzConnections.some((item) => item.id === selectedId)) {
    select.value = selectedId;
  } else if (selectedId) {
    select.prepend(Object.assign(document.createElement("option"), {
      value: selectedId,
      textContent: "Current connection (unavailable)",
    }));
    select.value = selectedId;
  } else if (buzzConnections.length) {
    select.value = buzzConnections[0].id;
  } else {
    select.value = "__add__";
  }
  updateSelectedConnection();
}

async function updateSelectedConnection() {
  const select = document.getElementById("agent-connection");
  const adding = select.value === "__add__";
  document.getElementById("add-connection-panel").hidden = !adding;
  const connection = buzzConnections.find((item) => item.id === select.value);
  if (!editingAgent) {
    setEditorField("agent-relay", connection?.relay_url || connection?.relay || "");
    renderConnectionChannels(connection);
    if (connection) {
      const token = ++channelLoadToken;
      try {
        const channels = await invoke("list_buzz_channels", { connectionId: connection.id });
        if (token === channelLoadToken && select.value === connection.id) {
          connection.channels = channels;
          renderConnectionChannels(connection);
        }
      } catch (error) {
        if (token === channelLoadToken) setStatus(`Could not refresh Buzz channels: ${String(error)}`, true);
      }
    }
  }
}

async function loadBuzzConnections() {
  const result = await invoke("list_buzz_connections");
  buzzConnections = Array.isArray(result) ? result : result?.connections || [];
  return buzzConnections;
}

function updateEditorAvatar() {
  const name = document.getElementById("agent-name").value.trim();
  const avatarUrl = document.getElementById("agent-avatar-url").value.trim();
  const avatar = document.getElementById("agent-avatar");
  avatar.textContent = (name[0] || "H").toUpperCase();
  loadAvatar(avatar, avatarUrl);
}

function loadAvatar(element, avatarUrl) {
  const request = String(avatarUrl || "").trim();
  element.style.backgroundImage = "";
  element.classList.remove("has-image");
  element.dataset.avatarRequest = request;
  if (!request) return;
  const image = new Image();
  image.addEventListener("load", () => {
    if (element.dataset.avatarRequest !== request) return;
    element.style.backgroundImage = `url(${JSON.stringify(request)})`;
    element.classList.add("has-image");
  });
  image.src = request;
}

function updateAllowlistVisibility() {
  document.getElementById("allowlist-field").hidden =
    document.getElementById("agent-respond-to").value !== "allowlist";
}

function hypercliInferenceEnabled() {
  return document.getElementById("agent-env").value
    .split("\n")
    .some((line) => line.trim() === "HYPERCLI_RUNTIME_INFERENCE=hypercli");
}

function updateModelAvailability() {
  const runtime = document.getElementById("agent-runtime").value;
  const native = nativeRuntimes.has(runtime);
  const compatibility = hypercliInferenceEnabled();
  const model = document.getElementById("agent-model");
  const help = document.getElementById("agent-model-help");
  model.disabled = native && !compatibility;
  model.placeholder = native && !compatibility ? "Native default" : "kimi-k2.6";
  help.textContent = native
    ? (compatibility
      ? "HyperCLI compatibility inference is explicitly enabled in Advanced."
      : "The native account chooses its model. To override it, add HYPERCLI_RUNTIME_INFERENCE=hypercli in Advanced.")
    : "";
}

function resetRuntimeLoginUi() {
  runtimeLoginToken += 1;
  runtimeLoginActive = false;
  document.getElementById("runtime-login-challenge").hidden = true;
  document.getElementById("runtime-login-input-row").hidden = true;
  document.getElementById("runtime-login-input").value = "";
  for (const id of ["runtime-login-instructions", "runtime-login-url", "runtime-login-code"]) {
    const element = document.getElementById(id);
    element.textContent = "";
    if (id !== "runtime-login-instructions") element.hidden = true;
  }
}

function renderRuntimeAuth(result) {
  const title = document.getElementById("runtime-auth-title");
  const detail = document.getElementById("runtime-auth-detail");
  const button = document.getElementById("runtime-login-btn");
  const stopped = result?.status === "stopped";
  const authenticated = result === true || result?.authenticated === true || result?.status === "authenticated";
  title.textContent = stopped ? "Agent stopped" : (authenticated ? "Logged in" : "Login required");
  detail.textContent = result?.detail || result?.message || (authenticated
    ? "This agent can use the runtime's native account."
    : "Use your own runtime account and model access.");
  button.textContent = authenticated ? "Log in again" : "Log in";
  button.dataset.mode = "login";
  button.disabled = stopped;
  if (authenticated) resetRuntimeLoginUi();
}

async function refreshRuntimeAuth() {
  const runtime = document.getElementById("agent-runtime").value;
  const card = document.getElementById("runtime-auth-card");
  card.hidden = !nativeRuntimes.has(runtime);
  updateModelAvailability();
  if (card.hidden) return;
  if (!editingAgent) {
    renderRuntimeAuth({
      authenticated: false,
      detail: "Launch the agent first, then log in from its agent screen.",
    });
    document.getElementById("runtime-login-btn").disabled = true;
    return;
  }
  document.getElementById("runtime-auth-title").textContent = "Checking login…";
  document.getElementById("runtime-auth-detail").textContent = "Contacting the runtime.";
  document.getElementById("runtime-login-btn").disabled = true;
  try {
    renderRuntimeAuth(await invoke("runtime_auth_status", {
      agentId: editingAgent.id,
      runtime,
    }));
  } catch (error) {
    renderRuntimeAuth({ authenticated: false, detail: String(error) });
  }
}

async function refreshSshStatus() {
  const title = document.getElementById("ssh-status-title");
  const detail = document.getElementById("ssh-status-detail");
  const buttons = [document.getElementById("ssh-generate-btn"), document.getElementById("ssh-import-btn")];
  if (!editingAgent || editingAgent.state !== "running") {
    title.textContent = "Available after launch";
    detail.textContent = editingAgent
      ? "Start this agent before adding an outbound SSH identity."
      : "Launch this agent before adding an outbound SSH identity.";
    buttons.forEach((button) => { button.disabled = true; });
    return;
  }
  buttons.forEach((button) => { button.disabled = false; });
  try {
    const result = await invoke("ssh_key_status", { agentId: editingAgent.id });
    const configured = result === true || result?.configured;
    title.textContent = configured ? "SSH key installed" : "Not configured";
    detail.textContent = result?.public_key || result?.fingerprint || (configured
      ? "The public key is ready to add to your Git host."
      : "Add an outbound key for Git hosts and coding workflows.");
  } catch (error) {
    title.textContent = "Could not check SSH";
    detail.textContent = String(error);
  }
}

function showEditor(detail, agent = null) {
  resetRuntimeLoginUi();
  editingAgent = agent;
  editingDetail = detail;
  const creating = !agent;
  document.getElementById("agent-screen-title").textContent = creating ? "Create agent" : (detail.name || agent.name || "Edit agent");
  document.getElementById("agent-screen-subtitle").textContent = creating
    ? "Launch a Buzz agent in a few focused steps."
    : "Runtime, Buzz connection, and launch settings.";
  document.getElementById("agent-save").textContent = creating ? "Create agent" : "Save changes";
  document.getElementById("draft-agent-prompt").hidden = !creating;
  setEditorField("agent-name", editorValue(detail, "name", agent?.name || ""));
  setEditorField("agent-avatar-url", editorValue(detail, "avatar_url", agent?.avatar_url || ""));
  setEditorField("agent-instructions", editorValue(detail, "instructions"));
  setEditorField("agent-runtime", editorValue(detail, "runtime", agent?.runtime || "buzz-agent"));
  document.getElementById("agent-runtime").disabled = !creating;
  setEditorField("agent-size", editorValue(detail, "size", agent?.requested_size || ""));
  setEditorField("agent-model", editorValue(detail, "model"));
  setEditorField("agent-concurrency", editorValue(detail, "concurrency"));
  const selectedConnectionId = editorValue(detail, "connection_id");
  renderConnectionSelect(selectedConnectionId);
  const connectionSelect = document.getElementById("agent-connection");
  const community = document.getElementById("agent-community");
  const relay = document.getElementById("agent-relay");
  connectionSelect.disabled = !creating;
  if (!creating && !selectedConnectionId) {
    const current = document.createElement("option");
    current.value = "";
    current.textContent = "Current Buzz deployment";
    connectionSelect.prepend(current);
    connectionSelect.value = "";
  }
  relay.readOnly = true;
  community.disabled = !creating;
  community.required = creating;
  document.getElementById("agent-instructions").required = creating;
  document.getElementById("add-connection-panel").hidden = !creating || connectionSelect.value !== "__add__";
  document.getElementById("connection-move-hint").hidden = creating;
  setEditorField("agent-relay", editorValue(detail, "relay", relay.value));
  const detailCommunity = editorValue(detail, "community", editorValue(detail, "channel", ""));
  setEditorField("agent-community", detailCommunity);
  setEditorField("agent-respond-to", editorValue(detail, "respond_to", "owner"));
  const allowlist = editorValue(detail, "allowlist", []);
  setEditorField("agent-allowlist", Array.isArray(allowlist) ? allowlist.join("\n") : allowlist);
  setEditorField("agent-env", normalizeEnvironment(editorValue(detail, "env", {})));
  const secretEnv = detail.secret_env_keys || [];
  const secretEnvLine = document.getElementById("stored-secret-env");
  secretEnvLine.hidden = secretEnv.length === 0;
  secretEnvLine.textContent = secretEnv.length
    ? `Stored secret variables: ${secretEnv.join(", ")} (values hidden). Enter the same key to replace it.`
    : "";
  document.getElementById("agent-runtime-state").textContent = agent
    ? `${humanize(agent.runtime)} · ${humanize(agent.state)}`
    : "Buzz-managed remote agent";
  renderConnectionChannels(
    buzzConnections.find((item) => item.id === connectionSelect.value),
    detail.recent_communities || [],
  );
  if (!creating && !detailCommunity) {
    community.options[0].textContent = "Current channel unavailable";
  }
  setEditorField("agent-community", detailCommunity);
  updateEditorAvatar();
  updateAllowlistVisibility();
  updateModelAvailability();
  dashboardView.hidden = true;
  agentScreen.hidden = false;
  document.getElementById("footer").hidden = true;
  document.getElementById("agent-advanced").open = false;
  agentScreen.scrollIntoView({ block: "start" });
  void refreshRuntimeAuth();
  void refreshSshStatus();
}

async function openAgentEditor(agentId) {
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) return;
  setStatus(`Loading ${agent.name || "agent"}…`);
  try {
    const [detail] = await Promise.all([
      invoke("get_agent_detail", { agentId }),
      loadBuzzConnections().catch(() => []),
    ]);
    setStatus("");
    showEditor(detail || {}, agent);
  } catch (error) {
    setStatus(`Could not open agent: ${String(error)}`, true);
  }
}

function closeAgentEditor(preserveStatus = false) {
  if (typeof preserveStatus !== "boolean") preserveStatus = false;
  const shouldCancelLogin = runtimeLoginActive && editingAgent;
  const loginAgentId = editingAgent?.id;
  resetRuntimeLoginUi();
  if (shouldCancelLogin) void invoke("cancel_runtime_login", { agentId: loginAgentId }).catch(() => {});
  editingAgent = null;
  editingDetail = null;
  agentScreen.hidden = true;
  dashboardView.hidden = false;
  document.getElementById("footer").hidden = false;
  if (!preserveStatus) setStatus("");
  void refreshAgents();
}

function parseEnvironment(source) {
  const result = {};
  for (const [index, raw] of source.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Environment line ${index + 1} must be KEY=value.`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment key on line ${index + 1}.`);
    result[key] = line.slice(separator + 1);
  }
  return result;
}

function editorPayload() {
  const concurrencySource = document.getElementById("agent-concurrency").value;
  const channel = document.getElementById("agent-community").value.trim();
  const connectionId = document.getElementById("agent-connection").value;
  const model = document.getElementById("agent-model");
  return {
    name: document.getElementById("agent-name").value.trim(),
    instructions: document.getElementById("agent-instructions").value.trim(),
    avatar_url: document.getElementById("agent-avatar-url").value.trim() || null,
    runtime: document.getElementById("agent-runtime").value,
    size: document.getElementById("agent-size").value || null,
    model: model.disabled ? null : model.value.trim() || null,
    concurrency: concurrencySource ? Number(concurrencySource) : null,
    relay: document.getElementById("agent-relay").value.trim(),
    connection_id: connectionId && connectionId !== "__add__" ? connectionId : null,
    channels: channel ? [channel] : [],
    community: channel,
    respond_to: document.getElementById("agent-respond-to").value,
    allowlist: document.getElementById("agent-allowlist").value.split("\n").map((item) => item.trim()).filter(Boolean),
    env: parseEnvironment(document.getElementById("agent-env").value),
  };
}

document.getElementById("create-agent-btn").addEventListener("click", async () => {
  setStatus("Loading Buzz connections…");
  try {
    await loadBuzzConnections();
    setStatus("");
    showEditor({});
  } catch (error) {
    setStatus(`Could not load Buzz connections: ${String(error)}`, true);
  }
});
document.getElementById("agent-back").addEventListener("click", closeAgentEditor);
document.getElementById("agent-cancel").addEventListener("click", closeAgentEditor);
document.getElementById("agent-name").addEventListener("input", updateEditorAvatar);
document.getElementById("agent-avatar-url").addEventListener("input", updateEditorAvatar);
document.getElementById("agent-runtime").addEventListener("change", () => {
  resetRuntimeLoginUi();
  void refreshRuntimeAuth();
});
document.getElementById("agent-respond-to").addEventListener("change", updateAllowlistVisibility);
document.getElementById("agent-env").addEventListener("input", updateModelAvailability);
document.getElementById("agent-connection").addEventListener("change", updateSelectedConnection);

document.getElementById("draft-agent-prompt").addEventListener("click", async () => {
  const button = document.getElementById("draft-agent-prompt");
  const instructions = document.getElementById("agent-instructions");
  const keywords = instructions.value.trim() || document.getElementById("agent-name").value.trim();
  if (!keywords) {
    setStatus("Add a name or a few keywords before drafting.", true);
    return;
  }
  const previous = instructions.value;
  button.disabled = true;
  button.textContent = "Drafting…";
  setStatus("Drafting concise agent instructions…");
  try {
    const result = await invoke("draft_agent_prompt", { keywords });
    const prompt = typeof result === "string" ? result : result?.prompt;
    if (!prompt?.trim()) throw new Error("Prompt drafting returned an empty response.");
    instructions.value = prompt.trim();
    setStatus("Draft ready. Review it before creating the agent.");
  } catch (error) {
    instructions.value = previous;
    setStatus(String(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "✦ Draft";
  }
});

document.getElementById("connection-cancel").addEventListener("click", () => {
  if (buzzConnections.length) {
    document.getElementById("agent-connection").value = buzzConnections[0].id;
    updateSelectedConnection();
  }
});

document.getElementById("connection-save").addEventListener("click", async () => {
  const nsecInput = document.getElementById("connection-nsec");
  const input = {
    label: document.getElementById("connection-label").value.trim(),
    relay: document.getElementById("connection-relay").value.trim(),
    nsec: nsecInput.value,
  };
  if (!input.label || !input.relay || !input.nsec) {
    setStatus("Connection name, relay, and owner nsec are required.", true);
    return;
  }
  const button = document.getElementById("connection-save");
  button.disabled = true;
  setStatus("Saving Buzz connection…");
  try {
    nsecInput.value = "";
    const connection = await invoke("save_buzz_connection", { input });
    buzzConnections = [connection, ...buzzConnections.filter((item) => item.id !== connection.id)];
    renderConnectionSelect(connection.id);
    setStatus("Buzz connection saved.");
  } catch (error) {
    setStatus(String(error), true);
  } finally {
    nsecInput.value = "";
    button.disabled = false;
  }
});

function renderRuntimeLoginProgress(result = {}) {
  const challenge = document.getElementById("runtime-login-challenge");
  const instructions = document.getElementById("runtime-login-instructions");
  const url = document.getElementById("runtime-login-url");
  const code = document.getElementById("runtime-login-code");
  challenge.hidden = false;
  instructions.textContent = result.instructions || result.detail || "Complete the runtime login instructions.";
  url.textContent = result.url || "";
  url.hidden = !result.url;
  code.textContent = result.code ? `Code: ${result.code}` : "";
  code.hidden = !result.code;
  document.getElementById("runtime-login-input-row").hidden = !result.interactive_required;
}

function runtimeLoginCompleted(result) {
  return result?.completed === true || result?.authenticated === true || ["completed", "authenticated", "success"].includes(result?.status);
}

async function pollRuntimeLogin(token) {
  if (!runtimeLoginActive || token !== runtimeLoginToken || !editingAgent) return;
  try {
    const result = await invoke("poll_runtime_login", {
      agentId: editingAgent.id,
    });
    if (token !== runtimeLoginToken) return;
    if (runtimeLoginCompleted(result)) {
      runtimeLoginActive = false;
      setStatus("Runtime login complete.");
      resetRuntimeLoginUi();
      await refreshRuntimeAuth();
      return;
    }
    if (result?.failed || result?.status === "failed") {
      runtimeLoginActive = false;
      document.getElementById("runtime-auth-detail").textContent = result.detail || "Runtime login failed.";
      setStatus(result.detail || "Runtime login failed.", true);
      return;
    }
    renderRuntimeLoginProgress(result);
  } catch (error) {
    if (token !== runtimeLoginToken) return;
    runtimeLoginActive = false;
    document.getElementById("runtime-login-btn").disabled = false;
    setStatus(`Could not check runtime login: ${String(error)}`, true);
  }
  if (runtimeLoginActive && token === runtimeLoginToken) {
    setTimeout(() => { void pollRuntimeLogin(token); }, 1_000);
  }
}

document.getElementById("runtime-login-btn").addEventListener("click", async () => {
  if (!editingAgent) return;
  const runtime = document.getElementById("agent-runtime").value;
  const button = document.getElementById("runtime-login-btn");
  button.disabled = true;
  setStatus(`Opening ${humanize(runtime)} login…`);
  try {
    const result = await invoke("begin_runtime_login", { agentId: editingAgent.id, runtime });
    if (runtimeLoginCompleted(result)) {
      setStatus("Runtime login complete.");
      resetRuntimeLoginUi();
      await refreshRuntimeAuth();
      return;
    }
    runtimeLoginToken += 1;
    runtimeLoginActive = true;
    renderRuntimeLoginProgress(result);
    setStatus("Login started. Complete the runtime instructions below.");
    button.textContent = "Login running";
    const token = runtimeLoginToken;
    setTimeout(() => { void pollRuntimeLogin(token); }, 1_000);
  } catch (error) {
    setStatus(String(error), true);
    button.disabled = false;
  }
});

document.getElementById("runtime-login-send").addEventListener("click", async () => {
  if (!runtimeLoginActive || !editingAgent) return;
  const input = document.getElementById("runtime-login-input");
  const value = input.value;
  input.value = "";
  if (!value) return;
  try {
    await invoke("send_runtime_login_input", { agentId: editingAgent.id, value });
    setStatus("Login input sent.");
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("runtime-login-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  document.getElementById("runtime-login-send").click();
});

document.getElementById("runtime-login-cancel").addEventListener("click", async () => {
  if (!editingAgent) return;
  const agentId = editingAgent.id;
  resetRuntimeLoginUi();
  try {
    await invoke("cancel_runtime_login", { agentId });
    setStatus("Runtime login cancelled.");
    await refreshRuntimeAuth();
  } catch (error) {
    setStatus(String(error), true);
  }
});

for (const [id, command] of [["ssh-generate-btn", "generate_ssh_key"], ["ssh-import-btn", "import_ssh_key"]]) {
  document.getElementById(id).addEventListener("click", async () => {
    if (!editingAgent) return;
    setStatus(command === "generate_ssh_key" ? "Generating SSH key…" : "Choosing SSH key…");
    try {
      await invoke(command, { agentId: editingAgent.id });
      setStatus(command === "generate_ssh_key" ? "SSH key generated." : "SSH key imported.");
      await refreshSshStatus();
    } catch (error) {
      setStatus(String(error), true);
    }
  });
}

agentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = document.getElementById("agent-save");
  try {
    const input = editorPayload();
    if (!editingAgent && !input.connection_id) {
      throw new Error("Select or add a Buzz connection.");
    }
    if (!editingAgent && input.channels.length === 0) {
      throw new Error("Select a channel for this agent.");
    }
    if (input.respond_to === "allowlist" && input.allowlist.length === 0) {
      throw new Error("Add at least one npub or nickname to the allowlist.");
    }
    save.disabled = true;
    setStatus(editingAgent ? `Saving ${input.name}…` : `Creating ${input.name}…`);
    if (editingAgent) {
      await invoke("save_agent", { agentId: editingAgent.id, input });
      setStatus(`${input.name} saved.`);
    } else {
      await invoke("create_buzz_agent", { input });
      setStatus(`${input.name} is launching.`);
    }
    closeAgentEditor(true);
  } catch (error) {
    setStatus(String(error), true);
  } finally {
    save.disabled = false;
  }
});

// Background key check: annotate the connected line, warn on problems.
async function validateKey() {
  const detail = document.getElementById("auth-detail");
  const warning = document.getElementById("auth-warning");
  try {
    const result = await invoke("validate_key");
    const keyLine = document.getElementById("key-line");
    const planLine = document.getElementById("plan-line");
    const editorWarning = document.getElementById("editor-auth-warning");
    if (result.valid) {
      detail.textContent = result.email ? ` as ${result.email}` : "";
      keyLine.hidden = !result.key_name;
      document.getElementById("key-name").textContent = result.key_name || "";
      // Tri-state: only an explicit "no plan" shows the hint; unknown
      // (scoped key, offline) stays hidden.
      planLine.hidden = result.has_active_plan !== false;
      warning.hidden = result.has_agents_capability;
      warning.textContent = result.has_agents_capability
        ? ""
        : "This key lacks the agents:* capability the Buzz provider needs.";
      editorWarning.hidden = result.has_editor_capability !== false;
    } else {
      detail.textContent = "";
      warning.hidden = false;
      warning.textContent = result.detail || "API key check failed.";
      editorWarning.hidden = true;
    }
  } catch {
    // Offline or discovery race — leave the plain connected line.
  }
}

async function refreshStatus() {
  try {
    const status = await invoke("provider_status");
    render(status);
    if (status.has_api_key) {
      void validateKey();
      void refreshAgents();
    }
  } catch (error) {
    setStatus(String(error), true);
  }
}

document.getElementById("login-btn").addEventListener("click", async () => {
  try {
    await invoke("start_login");
    setStatus("Complete the sign-in in your browser…");
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("reauthorize-btn").addEventListener("click", async () => {
  try {
    await invoke("start_login");
    setStatus("Sign in again to create an upgraded machine key…");
  } catch (error) {
    setStatus(String(error), true);
  }
});

listen("auth-token", async (event) => {
  setStatus("Creating API key…");
  try {
    const keyName = await invoke("mint_api_key", { sessionToken: event.payload });
    setStatus(`API key "${keyName}" created and saved.`);
    await refreshStatus();
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("key-input");
  try {
    await invoke("save_api_key", { apiKey: input.value });
    input.value = "";
    setStatus("API key saved.");
    await refreshStatus();
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("plans-btn").addEventListener("click", async () => {
  try {
    await invoke("open_plans");
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  try {
    const envKeyActive = await invoke("logout");
    if (envKeyActive) {
      setStatus(
        "Config cleared, but your shell environment exports HYPER_API_KEY — unset it to fully log out.",
        true,
      );
    } else {
      setStatus("Logged out.");
    }
    await refreshStatus();
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("install-btn").addEventListener("click", async () => {
  try {
    const status = await invoke("install_providers");
    render(status);
    setStatus(
      status.translocated
        ? "Providers installed. macOS is running HyperCLI from a temporary copy — drag HyperCLI.app to Applications to stop the warning on each launch."
        : "Providers installed — you can close the app.",
      status.translocated,
    );
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("uninstall-btn").addEventListener("click", async () => {
  try {
    render(await invoke("uninstall_providers"));
    setStatus("");
  } catch (error) {
    setStatus(String(error), true);
  }
});

// Auto-updater — vanilla port of Buzz's use-updater.ts. On load and every
// six hours: if the updater plugin is present (release builds only — dev
// builds compile it out, so window.__TAURI__.updater is absent), check for an
// update, auto-download it, and reveal #update-btn, which installs and
// relaunches on click. Linux non-AppImage installs (.deb) cannot swap the
// binary in place, so they stay resting, as do all errors — silently.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const updateBtn = document.getElementById("update-btn");
let pendingUpdate = null;
let updateCheckInFlight = false;
let installInFlight = false;

function resetUpdateUi() {
  pendingUpdate = null;
  updateBtn.hidden = true;
  updateBtn.disabled = false;
  updateBtn.textContent = "Update the HyperCLI app";
  showRestingVersion();
}

async function checkForUpdate() {
  const updater = window.__TAURI__.updater;
  if (!updater || updateCheckInFlight || pendingUpdate || installInFlight) {
    return;
  }
  updateCheckInFlight = true;
  try {
    // Check support BEFORE any network call: a .deb install would find an
    // update it cannot apply (Buzz shows a manual-download card here; we
    // deliberately stay resting).
    if (!(await invoke("is_auto_update_supported"))) return;
    const update = await updater.check({
      headers: { "Cache-Control": "no-cache" },
    });
    if (!update) return;
    try {
      await update.download();
    } catch (error) {
      await update.close().catch(() => {});
      throw error;
    }
    pendingUpdate = update;
    versionLine.textContent = `HyperCLI ${update.version} is ready to install`;
    updateBtn.hidden = false;
  } catch {
    // Offline, missing manifest, dev races — back to resting, quietly. The
    // next six-hour cycle retries.
    resetUpdateUi();
  } finally {
    updateCheckInFlight = false;
  }
}

updateBtn.addEventListener("click", async () => {
  if (!pendingUpdate || installInFlight) return;
  installInFlight = true;
  updateBtn.disabled = true;
  updateBtn.textContent = "Updating…";
  const update = pendingUpdate;
  try {
    await update.install();
    await window.__TAURI__.process.relaunch();
  } catch {
    // Failed install: drop the stale handle and rest; the periodic check
    // will stage the update again.
    await update.close().catch(() => {});
    installInFlight = false;
    resetUpdateUi();
  }
});

checkForUpdate();
setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

refreshStatus();
setInterval(refreshAgents, 15_000);
