"use strict";
// popup.ts
const SERVER = "http://localhost:8000";
document.addEventListener("DOMContentLoaded", () => {
    const collect = document.getElementById("collect");
    const chatBtn = document.getElementById("chatBtn");
    const openOverlayBtn = document.getElementById("openOverlay");
    const status = document.getElementById("status");
    const dbSelect = document.getElementById("dbSelect");
    const supabaseConfig = document.getElementById("supabaseConfig");
    const localConfig = document.getElementById("localConfig");
    const sqliteConfig = document.getElementById("sqliteConfig");
    const saveConfig = document.getElementById("saveConfig");
    const configStatus = document.getElementById("configStatus");
    const openaiKeyInput = document.getElementById("openaiKey");
    const saveApiKeyBtn = document.getElementById("saveApiKey");
    const apiKeyStatus = document.getElementById("apiKeyStatus");
    const moorchehKeyInput = document.getElementById("moorchehKey");
    const moorchehNamespaceInput = document.getElementById("moorchehNamespace");
    const saveMoorchehBtn = document.getElementById("saveMoorcheh");
    const moorchehStatus = document.getElementById("moorchehStatus");
    console.log("Popup loaded ✅");
    // Change form based on selected database type
    dbSelect.addEventListener("change", () => {
        supabaseConfig.style.display = dbSelect.value === "supabase" ? "block" : "none";
        localConfig.style.display = dbSelect.value === "local" ? "block" : "none";
        sqliteConfig.style.display = dbSelect.value === "sqlite" ? "block" : "none";
    });
    // Load saved settings
    chrome.storage.local.get(["dbConfig", "openaiKey", "moorchehKey", "moorchehNamespace"], (data) => {
        const conf = data.dbConfig || { type: "sqlite" };
        dbSelect.value = conf.type;
        if (conf.type === "supabase") {
            supabaseConfig.style.display = "block";
            document.getElementById("supabaseUrl").value = conf.supabaseUrl || "";
            document.getElementById("supabaseKey").value = conf.supabaseKey || "";
        }
        else if (conf.type === "local") {
            localConfig.style.display = "block";
            document.getElementById("localDbUrl").value = conf.localDbUrl || "";
        }
        else if (conf.type === "sqlite") {
            sqliteConfig.style.display = "block";
            document.getElementById("sqlitePath").value = conf.sqlitePath || "";
        }
        if (data.openaiKey)
            openaiKeyInput.value = "********";
        if (data.moorchehKey)
            moorchehKeyInput.value = "********";
        moorchehNamespaceInput.value = (data?.moorchehNamespace ?? "");
    });
    // Save API Key (OpenAI)
    saveApiKeyBtn.addEventListener("click", () => {
        const key = openaiKeyInput.value.trim();
        if (!key.startsWith("sk-")) {
            apiKeyStatus.textContent = "❌ Invalid API key format.";
            return;
        }
        chrome.storage.local.set({ openaiKey: key }, () => {
            apiKeyStatus.textContent = "✅ OpenAI API key saved locally.";
        });
    });
    // Save Moorcheh Config
    saveMoorchehBtn.addEventListener("click", () => {
        const moorKey = moorchehKeyInput.value.trim();
        const ns = moorchehNamespaceInput.value.trim();
        if (!ns) {
            moorchehStatus.textContent = "❌ Namespace is required.";
            return;
        }
        chrome.storage.local.set({ moorchehKey: moorKey, moorchehNamespace: ns }, () => {
            moorchehStatus.textContent = "✅ Moorcheh configuration saved.";
        });
    });
    // Save database configuration
    saveConfig.addEventListener("click", async () => {
        const selected = dbSelect.value;
        let payload = { type: selected };
        if (selected === "supabase") {
            const supabaseUrl = document.getElementById("supabaseUrl").value.trim();
            const supabaseKey = document.getElementById("supabaseKey").value.trim();
            payload = { ...payload, supabaseUrl, supabaseKey };
        }
        else if (selected === "local") {
            const localDbUrl = document.getElementById("localDbUrl").value.trim();
            payload = { ...payload, localDbUrl };
        }
        else if (selected === "sqlite") {
            const sqlitePath = document.getElementById("sqlitePath").value.trim();
            payload = { ...payload, sqlitePath };
        }
        try {
            const res = await fetch(`${SERVER}/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (json.ok)
                configStatus.textContent = `✅ Database configured: ${json.mode}`;
            else
                configStatus.textContent = `❌ Server error: ${json.error || "Unknown error"}`;
            chrome.storage.local.set({ dbConfig: payload });
        }
        catch (err) {
            configStatus.textContent = "❌ Error connecting to server.";
        }
    });
    // Collect tabs
    collect.addEventListener("click", async () => {
        status.textContent = "Collecting tabs...";
        chrome.storage.local.get(["openaiKey", "moorchehKey", "moorchehNamespace"], async (data) => {
            const apiKey = data.openaiKey;
            const moorchehKey = data.moorchehKey;
            const moorchehNamespace = data.moorchehNamespace;
            if (!apiKey) {
                status.textContent = "❌ Please enter your OpenAI API key first.";
                return;
            }
            const tabs = await new Promise((res) => chrome.tabs.query({}, res));
            const docs = tabs
                .filter((t) => t.url?.startsWith("http"))
                .map((t) => ({ title: t.title || "", url: t.url }));
            try {
                const r = await fetch(`${SERVER}/ingest`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ docs, apiKey, moorchehKey, moorchehNamespace }),
                });
                const j = await r.json();
                if (!j.ok) {
                    status.textContent = j.error || "❌ Error during processing.";
                }
                else {
                    status.textContent = j.message || `✅ ${j.count} tabs saved.`;
                }
            }
            catch (e) {
                console.error("❌ Fetch error:", e);
                status.textContent = "❌ Error connecting to server.";
            }
        });
    });
    // Open overlay
    openOverlayBtn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id)
            return;
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["dist/overlay.js"],
        });
        chrome.tabs.sendMessage(tab.id, { action: "openSearchOverlay" });
        window.close();
    });
    // Open chat widget
    chatBtn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id)
            return;
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["dist/chatWidget.js"],
        });
        chrome.tabs.sendMessage(tab.id, { action: "openChatWidget" });
        status.textContent = "✅ Chat widget opened.";
    });
});
//# sourceMappingURL=popup.js.map