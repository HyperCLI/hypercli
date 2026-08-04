const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const statusEl = document.getElementById("status");
const providerList = document.getElementById("provider-list");
const providerHint = document.getElementById("provider-hint");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function refreshStatus() {
  try {
    const status = await invoke("provider_status");
    providerList.replaceChildren(
      ...status.installed.map((name) => {
        const li = document.createElement("li");
        li.className = "ok";
        li.textContent = name;
        return li;
      }),
    );
    if (status.missing.length === 0) {
      providerHint.textContent = `Installed in ${status.bin_dir}`;
      document.getElementById("install-btn").textContent = "Reinstall providers";
    } else if (!status.bin_dir_exists) {
      providerHint.textContent = `${status.bin_dir} does not exist yet — it will be created on install.`;
    }
    if (status.has_api_key) {
      document.getElementById("key-input").placeholder = "API key configured ✓";
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

document.getElementById("install-btn").addEventListener("click", async () => {
  try {
    await invoke("install_providers");
    setStatus("Providers installed. Restart Buzz or use Settings → Agents → Check again.");
    await refreshStatus();
  } catch (error) {
    setStatus(String(error), true);
  }
});

refreshStatus();
