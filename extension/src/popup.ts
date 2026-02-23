// popup.ts
const SERVER = "http://localhost:8000";

interface DBConfig {
  type: "supabase" | "local" | "sqlite";
  supabaseUrl?: string;
  supabaseKey?: string;
  localDbUrl?: string;
  sqlitePath?: string;
}

document.addEventListener("DOMContentLoaded", () => {
  const collect = document.getElementById("collect") as HTMLButtonElement;
  const chatBtn = document.getElementById("chatBtn") as HTMLButtonElement;
  const openOverlayBtn = document.getElementById("openOverlay") as HTMLButtonElement;
  const status = document.getElementById("status") as HTMLDivElement;

  const dbSelect = document.getElementById("dbSelect") as HTMLSelectElement;
  const supabaseConfig = document.getElementById("supabaseConfig") as HTMLDivElement;
  const localConfig = document.getElementById("localConfig") as HTMLDivElement;
  const sqliteConfig = document.getElementById("sqliteConfig") as HTMLDivElement;
  const saveConfig = document.getElementById("saveConfig") as HTMLButtonElement;
  const configStatus = document.getElementById("configStatus") as HTMLDivElement;

  const openaiKeyInput = document.getElementById("openaiKey") as HTMLInputElement;
  const saveApiKeyBtn = document.getElementById("saveApiKey") as HTMLButtonElement;
  const apiKeyStatus = document.getElementById("apiKeyStatus") as HTMLDivElement;

  console.log("Popup loaded ✅");

  // Change form based on selected database type
  dbSelect.addEventListener("change", () => {
    supabaseConfig.style.display = dbSelect.value === "supabase" ? "block" : "none";
    localConfig.style.display = dbSelect.value === "local" ? "block" : "none";
    sqliteConfig.style.display = dbSelect.value === "sqlite" ? "block" : "none";
  });

  // Load saved settings
  chrome.storage.local.get(["dbConfig", "openaiKey"], (data) => {
    const conf = (data.dbConfig as DBConfig) || { type: "sqlite" };
    dbSelect.value = conf.type;

    if (conf.type === "supabase") {
      supabaseConfig.style.display = "block";
      (document.getElementById("supabaseUrl") as HTMLInputElement).value = conf.supabaseUrl || "";
      (document.getElementById("supabaseKey") as HTMLInputElement).value = conf.supabaseKey || "";
    } else if (conf.type === "local") {
      localConfig.style.display = "block";
      (document.getElementById("localDbUrl") as HTMLInputElement).value = conf.localDbUrl || "";
    } else if (conf.type === "sqlite") {
      sqliteConfig.style.display = "block";
      (document.getElementById("sqlitePath") as HTMLInputElement).value = conf.sqlitePath || "";
    }

    if (data.openaiKey) openaiKeyInput.value = "********";
  });

  // Save API Key
  saveApiKeyBtn.addEventListener("click", () => {
    const key = openaiKeyInput.value.trim();
    if (!key.startsWith("sk-")) {
      apiKeyStatus.textContent = "❌ Invalid API key format.";
      return;
    }
    chrome.storage.local.set({ openaiKey: key }, () => {
      apiKeyStatus.textContent = "✅ API key saved locally.";
    });
  });

  // Save database configuration
  saveConfig.addEventListener("click", async () => {
    const selected = dbSelect.value as DBConfig["type"];
    let payload: Partial<DBConfig> = { type: selected };

    if (selected === "supabase") {
      const supabaseUrl = (document.getElementById("supabaseUrl") as HTMLInputElement).value.trim();
      const supabaseKey = (document.getElementById("supabaseKey") as HTMLInputElement).value.trim();
      payload = { ...payload, supabaseUrl, supabaseKey };
    } else if (selected === "local") {
      const localDbUrl = (document.getElementById("localDbUrl") as HTMLInputElement).value.trim();
      payload = { ...payload, localDbUrl };
    } else if (selected === "sqlite") {
      const sqlitePath = (document.getElementById("sqlitePath") as HTMLInputElement).value.trim();
      payload = { ...payload, sqlitePath };
    }

    try {
      const res = await fetch(`${SERVER}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) configStatus.textContent = `✅ Database configured: ${json.mode}`;
      else configStatus.textContent = `❌ Server error: ${json.error || "Unknown error"}`;
      chrome.storage.local.set({ dbConfig: payload });
    } catch (err) {
      configStatus.textContent = "❌ Error connecting to server.";
    }
  });

  // Collect tabs
  collect.addEventListener("click", async () => {
    status.textContent = "Collecting tabs...";

    chrome.storage.local.get(["openaiKey"], async (data) => {
      const apiKey = data.openaiKey;
      if (!apiKey) {
        status.textContent = "❌ Please enter your OpenAI API key first.";
        return;
      }

      const tabs = await new Promise<chrome.tabs.Tab[]>((res) => chrome.tabs.query({}, res));
      const docs = tabs
        .filter((t) => t.url?.startsWith("http"))
        .map((t) => ({ title: t.title || "", url: t.url! }));

      try {
        const r = await fetch(`${SERVER}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docs, apiKey }),
        });
        const j = await r.json();

        // 🔹 Handle different responses:
        if (!j.ok) {
          status.textContent = j.error || "❌ Error during processing.";
        }
        else if (j.message) {
          // Server returned a custom message (e.g., "All tabs already saved")
          status.textContent = j.message;
        }
        else if (typeof j.count === "number") {
          // Default: show number of tabs saved
          status.textContent = `✅ ${j.count} tabs saved.`;
        }
        else {
          status.textContent = "✅ Operation completed successfully.";
        }

      } catch (e) {
        console.error("❌ Fetch error:", e);
        status.textContent = "❌ Error connecting to server.";
      }
    });
  });

  // Open overlay
  openOverlayBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/overlay.js"],
    });

    chrome.tabs.sendMessage(tab.id, { action: "openSearchOverlay" });

    // Close popup after injection
    window.close();
  });

  // Open chat widget
  chatBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/chatWidget.js"],
    });

    chrome.tabs.sendMessage(tab.id, { action: "openChatWidget" });
    status.textContent = "✅ Chat widget opened.";
  });
});