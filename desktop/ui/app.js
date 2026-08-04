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

function fitWindow() {
  const height = Math.min(MAX_HEIGHT, card.offsetHeight + TITLEBAR);
  appWindow.setSize(new LogicalSize(WINDOW_WIDTH, height)).catch(() => {});
}

new ResizeObserver(fitWindow).observe(card);

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
  if (!connected) return;

  const hint = document.getElementById("provider-hint");
  const list = document.getElementById("provider-list");
  const installBtn = document.getElementById("install-btn");
  document.getElementById("uninstall-btn").hidden = status.installed.length === 0;
  list.replaceChildren(
    ...status.installed.map((name) => {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = name;
      return li;
    }),
  );
  if (status.missing.length === 0) {
    hint.innerHTML = `<span class="ok-mark">✓</span> Installed in ${status.bin_dir}`;
    installBtn.textContent = "Reinstall";
    installBtn.classList.remove("primary");
    installBtn.classList.add("link");
  } else if (status.installed.length > 0) {
    hint.textContent = `Missing: ${status.missing.join(", ")}`;
    installBtn.textContent = "Install missing providers";
    installBtn.classList.add("primary");
    installBtn.classList.remove("link");
  } else {
    hint.textContent = "Install the HyperCLI backend so your agents appear in Buzz.";
    installBtn.textContent = "Install providers";
    installBtn.classList.add("primary");
    installBtn.classList.remove("link");
  }
}

async function refreshStatus() {
  try {
    render(await invoke("provider_status"));
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
    await invoke("logout");
    setStatus("Logged out — API key removed from ~/.hypercli/config.");
    await refreshStatus();
  } catch (error) {
    setStatus(String(error), true);
  }
});

document.getElementById("install-btn").addEventListener("click", async () => {
  try {
    render(await invoke("install_providers"));
    setStatus("");
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
