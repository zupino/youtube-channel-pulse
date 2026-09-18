const apiKeyInput = document.getElementById("api-key");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");
const toggleKeyButton = document.getElementById("toggle-key");
const demoToggle = document.getElementById("demo-toggle");
const demoPanel = document.getElementById("demo-panel");

restore();

toggleKeyButton.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  toggleKeyButton.textContent = showing ? "Show" : "Hide";
});

saveButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  setStatus("Testing key…", "");
  saveButton.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_KEY", apiKey });
    if (!result?.ok) throw new Error(result?.error?.message || "The key could not be validated.");
    await chrome.storage.local.set({ youtubeApiKey: apiKey });
    await clearPulseCache();
    setStatus("Connected. Reload an open YouTube video to see its pulse.", "success");
  } catch (error) {
    setStatus(error.message || "The key could not be validated.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

demoToggle.addEventListener("click", () => {
  demoPanel.hidden = !demoPanel.hidden;
  demoToggle.setAttribute("aria-expanded", String(!demoPanel.hidden));
});

async function restore() {
  const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
  if (youtubeApiKey) apiKeyInput.value = youtubeApiKey;
}

async function clearPulseCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith("pulse:"));
  if (cacheKeys.length) await chrome.storage.local.remove(cacheKeys);
}

function setStatus(message, state) {
  status.textContent = message;
  status.className = state;
}
