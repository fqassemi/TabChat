chrome.runtime.onInstalled.addListener(() => {
  console.log("Tab Collector installed");
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === "chatQuery") {
    try {
      const r = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: msg.url, question: msg.question }),
      });
      const j = await r.json();
      sendResponse(j);
    } catch (err) {
      console.error("❌ Chat error:", err);
      sendResponse({ answer: "Error talking to server." });
    }
  }
  return true;
});
