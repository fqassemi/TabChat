"use strict";
// popup.ts
const SERVER = "https://katelynn-nonsegmented-melvina.ngrok-free.dev";
function getOrCreateUserId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["userId"], (data) => {
            const existingUserId = data.userId;
            if (existingUserId) {
                resolve(existingUserId);
                return;
            }
            const userId = crypto.randomUUID();
            chrome.storage.local.set({ userId }, () => {
                resolve(userId);
            });
        });
    });
}
document.addEventListener("DOMContentLoaded", () => {
    const collect = document.getElementById("collect");
    const chatBtn = document.getElementById("chatBtn");
    const openOverlayBtn = document.getElementById("openOverlay");
    const status = document.getElementById("status");
    const openaiKeyInput = document.getElementById("openaiKey");
    const saveApiKeyBtn = document.getElementById("saveApiKey");
    const apiKeyStatus = document.getElementById("apiKeyStatus");
    console.log("Popup loaded ✅");
    // Load saved settings
    chrome.storage.local.get(["openaiKey"], (data) => {
        if (data.openaiKey)
            openaiKeyInput.value = "********";
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
    // Collect tabs
    collect.addEventListener("click", async () => {
        status.textContent = "Collecting tabs...";
        chrome.storage.local.get(["openaiKey"], async (data) => {
            const apiKey = data.openaiKey;
            if (!apiKey) {
                status.textContent = "❌ Please enter your OpenAI API key first.";
                return;
            }
            const tabs = await new Promise((res) => chrome.tabs.query({}, res));
            const docs = tabs
                .filter((t) => t.url?.startsWith("http"))
                .map((t) => ({
                title: t.title || "",
                url: t.url,
            }));
            try {
                const userId = await getOrCreateUserId();
                const r = await fetch(`${SERVER}/ingest`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        docs,
                        apiKey,
                        userId,
                    }),
                });
                const j = await r.json();
                if (!j.ok) {
                    status.textContent =
                        j.error || "❌ Error during processing.";
                }
                else if (j.message) {
                    status.textContent = j.message;
                }
                else if (typeof j.count === "number") {
                    status.textContent = `✅ ${j.count} tabs saved.`;
                }
                else {
                    status.textContent = "✅ Operation completed successfully.";
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
        // Close popup after injection
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