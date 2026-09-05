

const OPEN_TABS_KEY = "openTabUrls";

chrome.runtime.onInstalled.addListener(() => {
  console.log("TabChat installed");

  chrome.contextMenus.create({
    id: "pin-this",
    title: "📌 Pin this",
    contexts: ["selection"],
  });
});


// =========================
// 📌 Pin
// =========================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "pin-this") {
    return;
  }

  const selectedText = info.selectionText?.trim();

  if (!selectedText || !tab?.url) {
    return;
  }

  const pin = {
    id: crypto.randomUUID(),
    text: selectedText,
    url: tab.url,
    title: tab.title || "Untitled",
    tabId: tab.id ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await chrome.storage.local.get("pins");

    const pins = result.pins || [];

    pins.push(pin);

    await chrome.storage.local.set({
      pins,
    });

    console.log("📌 Pin saved:", pin);
  } catch (err) {
    console.error("❌ Failed to save pin:", err);
  }
});


// =========================
// 💬 Chat
// =========================

chrome.runtime.onMessage.addListener(
  async (msg, sender, sendResponse) => {
    if (msg.type === "chatQuery") {
      try {
        const r = await fetch("http://localhost:8000/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: msg.url,
            question: msg.question,
          }),
        });

        const j = await r.json();

        sendResponse(j);
      } catch (err) {
        console.error("❌ Chat error:", err);

        sendResponse({
          answer: "Error talking to server.",
        });
      }
    }

    return true;
  }
);


// =========================
// 🗂️ Open Tabs Tracking
// =========================

async function saveTabUrl(tabId, url) {
  if (tabId == null || !url) {
    return;
  }

  const result = await chrome.storage.local.get(OPEN_TABS_KEY);

  const openTabUrls = result[OPEN_TABS_KEY] || {};

  openTabUrls[String(tabId)] = url;

  await chrome.storage.local.set({
    [OPEN_TABS_KEY]: openTabUrls,
  });
}


async function getTabUrl(tabId) {
  const result = await chrome.storage.local.get(OPEN_TABS_KEY);

  const openTabUrls = result[OPEN_TABS_KEY] || {};

  return openTabUrls[String(tabId)] || null;
}


async function removeTabUrl(tabId) {
  const result = await chrome.storage.local.get(OPEN_TABS_KEY);

  const openTabUrls = result[OPEN_TABS_KEY] || {};

  delete openTabUrls[String(tabId)];

  await chrome.storage.local.set({
    [OPEN_TABS_KEY]: openTabUrls,
  });
}


// =========================
// 🔄 Tab Updated
// =========================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;

  if (!url) {
    return;
  }

  try {
    await saveTabUrl(tabId, url);

    console.log("🗂️ Tab URL saved:", {
      tabId,
      url,
    });
  } catch (err) {
    console.error("❌ Failed to save tab URL:", err);
  }
});


// =========================
// 🗑️ Tab Closed
// =========================

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    console.log("🗑️ Tab closed:", tabId);

    const url = await getTabUrl(tabId);

    console.log("🔎 URL found for closed tab:", url);

    await removeTabUrl(tabId);

    console.log("✅ Tab mapping removed:", tabId);

    if (!url) {
      console.log("⚠️ No URL found for closed tab:", tabId);
      return;
    }

    const openTabs = await chrome.tabs.query({});

    console.log("🔍 Checking remaining open tabs...");

    const normalizeUrl = (value) => {
      if (!value) {
        return "";
      }

      try {
        const parsed = new URL(value);

        parsed.search = "";
        parsed.hash = "";

        return parsed.toString().replace(/\/$/, "").toLowerCase();
      } catch {
        return value.toLowerCase().replace(/\/$/, "");
      }
    };

    const closedUrl = normalizeUrl(url);

    const sameUrlStillOpen = openTabs.some((tab) => {
      if (!tab.url) {
        return false;
      }

      return normalizeUrl(tab.url) === closedUrl;
    });

    if (sameUrlStillOpen) {
      console.log(
        "ℹ️ Same URL is still open in another tab. Cleanup skipped:",
        url
      );

      return;
    }

    console.log("🧹 No duplicate tab found. Starting backend cleanup...");

    const result = await chrome.storage.local.get([
      "token",
      "chatApiKey",
      "chatBaseUrl",
    ]);

    console.log("🔐 Auth data loaded:", {
      hasToken: !!result.token,
      hasChatApiKey: !!result.chatApiKey,
      hasChatBaseUrl: !!result.chatBaseUrl,
    });

    const token = result.token;

    if (!token) {
      console.log("⚠️ No auth token found. Cleanup skipped.");
      return;
    }

    console.log("🚀 Sending DELETE /tabs:", url);

    const response = await fetch("http://localhost:8000/tabs", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        chatApiKey: result.chatApiKey,
        chatBaseURL: result.chatBaseUrl,
      }),
    });

    console.log("📡 Backend response status:", response.status);

    const data = await response.json();

    console.log("📦 Backend response:", data);

    if (!response.ok) {
      console.error("❌ Tab cleanup failed:", data);
      return;
    }

    console.log("✅ Closed tab cleaned up successfully:", url);
  } catch (err) {
    console.error("❌ Failed to handle closed tab:", err);
  }
});