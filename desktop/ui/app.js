const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const statusEl = document.getElementById("status");

// Window height follows content, capped. Width stays fixed.
const WINDOW_WIDTH = 440;
const MAX_HEIGHT = 720;
const TITLEBAR = 28;
const appWindow = getCurrentWindow();
const card = document.querySelector(".card");

const MIN_HEIGHT = 240;

function fitWindow() {
  const height = Math.min(
    MAX_HEIGHT,
    Math.max(MIN_HEIGHT, card.offsetHeight + TITLEBAR),
  );
  appWindow.setSize(new LogicalSize(WINDOW_WIDTH, height)).catch(() => {});
}

new ResizeObserver(fitWindow).observe(card);

// Footer: version + update state. Until the updater plugin ships with
// release CI, "up to date" is the resting state.
(async () => {
  const line = document.getElementById("version-line");
  try {
    const version = await window.__TAURI__.app.getVersion();
    line.textContent = `HyperCLI ${version} · your app is up to date`;
  } catch {
    line.textContent = "Your app is up to date";
  }
})();

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
  if (status.config_error) setStatus(status.config_error, true);
  if (!connected) return;

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
    const fresh = status.installed.length === 0;
    hint.textContent = fresh
      ? "Install the HyperCLI backend so your agents appear in Buzz."
      : "Some providers are missing:";
    installBtn.textContent = fresh ? "Install providers" : "Reinstall";
    installBtn.classList.add("primary");
    installBtn.classList.remove("link");
  }
}

// Background key check: annotate the connected line, warn on problems.
async function validateKey() {
  const detail = document.getElementById("auth-detail");
  const warning = document.getElementById("auth-warning");
  try {
    const result = await invoke("validate_key");
    if (result.valid) {
      const who = result.email ? ` as ${result.email}` : "";
      const key = result.key_name ? ` · key "${result.key_name}"` : "";
      detail.textContent = `${who}${key}`;
      warning.hidden = result.has_agents_capability;
      warning.textContent = result.has_agents_capability
        ? ""
        : "This key lacks the agents:* capability the Buzz provider needs.";
    } else {
      detail.textContent = "";
      warning.hidden = false;
      warning.textContent = result.detail || "API key check failed.";
    }
  } catch {
    // Offline or discovery race — leave the plain connected line.
  }
}

async function refreshStatus() {
  try {
    const status = await invoke("provider_status");
    render(status);
    if (status.has_api_key) void validateKey();
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
    render(await invoke("install_providers"));
    setStatus("Providers installed — you can close the app.");
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

refreshStatus();
