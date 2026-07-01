// popup.ts
const SERVER = "https://katelynn-nonsegmented-melvina.ngrok-free.dev";

type StorageData = {
  token?: string;
  openaiKey?: string;
};

document.addEventListener("DOMContentLoaded", () => {
  const collect = document.getElementById("collect") as HTMLButtonElement;
  const chatBtn = document.getElementById("chatBtn") as HTMLButtonElement;
  const openOverlayBtn = document.getElementById("openOverlay") as HTMLButtonElement;
  const status = document.getElementById("status") as HTMLDivElement;


  const openaiKeyInput = document.getElementById("openaiKey") as HTMLInputElement;
  const saveApiKeyBtn = document.getElementById("saveApiKey") as HTMLButtonElement;
  const apiKeyStatus = document.getElementById("apiKeyStatus") as HTMLDivElement;

  const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;

  console.log("Popup loaded ✅");

  // ------------------ LOAD API KEY ------------------
  chrome.storage.local.get(["openaiKey"], (data: StorageData) => {
    if (data.openaiKey) {
      openaiKeyInput.value = "********";
    }
  });

  // ------------------ SAVE API KEY ------------------
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

  // ------------------ LOGIN (FIXED FLOW) ------------------
  loginBtn.addEventListener("click", async () => {
    const redirectURL = chrome.identity.getRedirectURL("auth");

    const authURL =
      `${SERVER}/auth/google/login` +
      `?redirect_uri=${encodeURIComponent(redirectURL)}`;

    chrome.identity.launchWebAuthFlow(
      {
        url: authURL,
        interactive: true,
      },
      (result) => {
        if (!result) {
          console.error("No auth result");
          return;
        }

        // 🔥 مهم: چون server تو redirect می‌کنه با #token=
        const url = new URL(result);

        const hash = url.hash; // "#token=..."
        const token = hash.split("token=")[1];

        if (token) {
          chrome.storage.local.set({ token }, () => {
            console.log("✅ Login success");
            status.textContent = "✅Logged in successfully";
          });
        } else {
          console.error("❌Token not found in redirect");
        }
      }
    );
  });

  // ------------------ GET TOKEN ------------------
  function getToken(): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get(["token"], (data: StorageData) => {
        resolve(data.token ?? null);
      });
    });
  }

  // Collect tabs
    collect.addEventListener("click", async () => {
      status.textContent = "Collecting tabs...";

        const apiKey = await new Promise<string | undefined>((resolve) => {
          chrome.storage.local.get(["openaiKey"], (data) => {
            const typed = data as StorageData;
            resolve(typed.openaiKey);
          });
        });

        if (!apiKey) {
          status.textContent = "❌ Please enter your OpenAI API key first.";
          return;
        }

    const token = await getToken();

    if (!token) {
      status.textContent = "❌ Please login first.";
      return;
    }

        const tabs = await new Promise<chrome.tabs.Tab[]>((res) =>
          chrome.tabs.query({}, res)
        );

        const docs = tabs
          .filter((t) => t.url?.startsWith("http"))
          .map((t) => ({
            title: t.title || "",
            url: t.url!,
          }));

        try {
          const r = await fetch(`${SERVER}/ingest`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              docs,
              apiKey,
            }),
          });

          const j = await r.json();

          if (!j.ok) {
            status.textContent =
              j.error || "❌ Error during processing.";
          } else {
              status.textContent = j.message || "✅ Done";
          }
        } catch (e) {
          console.error("❌ Fetch error:", e);
          status.textContent = "❌ Error connecting to server.";
        }
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