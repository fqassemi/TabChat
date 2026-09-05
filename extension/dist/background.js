chrome.runtime.onInstalled.addListener(() => {
  console.log("TabChat installed");

  chrome.contextMenus.create({
    id: "pin-this",
    title: "📌 Pin this",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "pin-this") {
    return;
  }

  const selectedText = info.selectionText?.trim();

  if (!selectedText || !tab?.url) {
    return;
  }

  const pin = {
    text: selectedText,
    url: tab.url,
    title: tab.title || "Untitled",
    tabId: tab.id ?? null,
    timestamp: new Date().toISOString(),
  };

  console.log("📌 Pin created:", pin);
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
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
});