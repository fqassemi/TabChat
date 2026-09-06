
"use strict";

const OPEN_TABS_KEY = "openTabUrls";

// =========================
// 🚀 Extension Installed
// =========================

chrome.runtime.onInstalled.addListener(() => {
  console.log("TabChat installed");

  chrome.contextMenus.create({
    id: "pin-this",
    title: "📌 Pin this",
    contexts: ["selection"],
  });
});

// =========================
// 📌 Pin Selected Text
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
// 💬 Runtime Messages
// =========================

chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    // =========================
    // 🪟 Get Current Window ID
    // =========================

    if (msg.action === "getCurrentWindowId") {
      const windowId = sender.tab?.windowId;

      console.log("🪟 getCurrentWindowId:", {
        tabId: sender.tab?.id,
        windowId,
        url: sender.tab?.url,
      });

      sendResponse({
        windowId,
      });

      return true;
    }

    // =========================
    // 💬 Chat Query
    // =========================

    if (msg.type === "chatQuery") {
      (async () => {
        try {
          console.log("💬 chatQuery received:", {
            question: msg.question,
            url: msg.url,
            windowId: msg.windowId,
          });

          const response = await fetch(
            "https://tabchat-production-f7d0.up.railway.app/chat",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(msg.token
                  ? {
                      Authorization: `Bearer ${msg.token}`,
                    }
                  : {}),
              },
              body: JSON.stringify({
                url: msg.url,
                question: msg.question,
                windowId: msg.windowId,
                chatApiKey: msg.chatApiKey,
                chatBaseURL: msg.chatBaseURL,
              }),
            }
          );

          console.log(
            "📡 Chat response status:",
            response.status
          );

          const data = await response.json();

          console.log("📦 Chat response:", data);

          sendResponse(data);
        } catch (err) {
          console.error("❌ Chat error:", err);

          sendResponse({
            answer: "Error talking to server.",
          });
        }
      })();

      return true;
    }

    return false;
  }
);

// =========================
// 🗂️ Open Tabs Tracking
// =========================

async function saveTabUrl(tabId, url) {
  if (tabId == null || !url) {
    return;
  }

  try {
    const result = await chrome.storage.local.get(
      OPEN_TABS_KEY
    );

    const openTabUrls =
      result[OPEN_TABS_KEY] || {};

    openTabUrls[String(tabId)] = url;

    await chrome.storage.local.set({
      [OPEN_TABS_KEY]: openTabUrls,
    });

    console.log("🗂️ Tab URL saved:", {
      tabId,
      url,
    });
  } catch (err) {
    console.error(
      "❌ Failed to save tab URL:",
      err
    );
  }
}

// =========================
// 🔎 Get Tab URL
// =========================

async function getTabUrl(tabId) {
  try {
    const result = await chrome.storage.local.get(
      OPEN_TABS_KEY
    );

    const openTabUrls =
      result[OPEN_TABS_KEY] || {};

    return (
      openTabUrls[String(tabId)] || null
    );
  } catch (err) {
    console.error(
      "❌ Failed to get tab URL:",
      err
    );

    return null;
  }
}

// =========================
// 🗑️ Remove Tab URL
// =========================

async function removeTabUrl(tabId) {
  try {
    const result = await chrome.storage.local.get(
      OPEN_TABS_KEY
    );

    const openTabUrls =
      result[OPEN_TABS_KEY] || {};

    delete openTabUrls[String(tabId)];

    await chrome.storage.local.set({
      [OPEN_TABS_KEY]: openTabUrls,
    });
  } catch (err) {
    console.error(
      "❌ Failed to remove tab URL:",
      err
    );
  }
}

// =========================
// 🔄 Tab Updated
// =========================

chrome.tabs.onUpdated.addListener(
  async (tabId, changeInfo, tab) => {
    const url =
      changeInfo.url || tab.url;

    if (!url) {
      return;
    }

    try {
      await saveTabUrl(tabId, url);
    } catch (err) {
      console.error(
        "❌ Failed to handle tab update:",
        err
      );
    }
  }
);

// =========================
// 🗑️ Tab Closed
// =========================

chrome.tabs.onRemoved.addListener(
  async (tabId) => {
    try {
      console.log("🗑️ Tab closed:", tabId);

      // =========================
      // Get URL of closed tab
      // =========================

      const url = await getTabUrl(tabId);

      console.log(
        "🔎 URL found for closed tab:",
        url
      );

      // Remove local mapping immediately
      await removeTabUrl(tabId);

      console.log(
        "✅ Tab mapping removed:",
        tabId
      );

      if (!url) {
        console.log(
          "⚠️ No URL found for closed tab:",
          tabId
        );

        return;
      }

      // =========================
      // Get Remaining Tabs
      // =========================

      const openTabs =
        await chrome.tabs.query({});

      console.log(
        "🔍 Checking remaining open tabs..."
      );

      // =========================
      // Normalize URL
      // =========================

      const normalizeUrl = (value) => {
        if (!value) {
          return "";
        }

        try {
          const parsed = new URL(value);

          parsed.search = "";
          parsed.hash = "";

          return parsed
            .toString()
            .replace(/\/$/, "")
            .toLowerCase();
        } catch {
          return value
            .toLowerCase()
            .replace(/\/$/, "");
        }
      };

      const closedUrl =
        normalizeUrl(url);

      // =========================
      // Check Duplicate URL
      // =========================

      const sameUrlStillOpen =
        openTabs.some((tab) => {
          if (!tab.url) {
            return false;
          }

          return (
            normalizeUrl(tab.url) ===
            closedUrl
          );
        });

      if (sameUrlStillOpen) {
        console.log(
          "ℹ️ Same URL is still open in another tab. Cleanup skipped:",
          url
        );

        return;
      }

      console.log(
        "🧹 No duplicate tab found. Starting backend cleanup..."
      );

      // =========================
      // Get Auth Data
      // =========================

      const result =
        await chrome.storage.local.get([
          "token",
          "chatApiKey",
          "chatBaseUrl",
        ]);

      console.log(
        "🔐 Auth data loaded:",
        {
          hasToken: !!result.token,
          hasChatApiKey:
            !!result.chatApiKey,
          hasChatBaseUrl:
            !!result.chatBaseUrl,
        }
      );

      const token = result.token;

      if (!token) {
        console.log(
          "⚠️ No auth token found. Cleanup skipped."
        );

        return;
      }

      // =========================
      // Backend Cleanup
      // =========================

      console.log(
        "🚀 Sending DELETE /tabs:",
        url
      );

      const response = await fetch(
        "https://tabchat-production-f7d0.up.railway.app/tabs",
        {
          method: "DELETE",

          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            url,
            chatApiKey:
              result.chatApiKey,
            chatBaseURL:
              result.chatBaseUrl,
          }),
        }
      );

      console.log(
        "📡 Backend response status:",
        response.status
      );

      const data =
        await response.json();

      console.log(
        "📦 Backend response:",
        data
      );

      if (!response.ok) {
        console.error(
          "❌ Tab cleanup failed:",
          data
        );

        return;
      }

      console.log(
        "✅ Closed tab cleaned up successfully:",
        url
      );
    } catch (err) {
      console.error(
        "❌ Failed to handle closed tab:",
        err
      );
    }
  }
);

