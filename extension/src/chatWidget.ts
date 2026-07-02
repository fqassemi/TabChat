// chatWidget.ts
(() => {
  if ((window as any).chatWidgetInjected) return;
  (window as any).chatWidgetInjected = true;
  function isRTL(text: string) {
    return /[\u0600-\u06FF]/.test(text);
  }

  async function injectChatWidget() {
    const apiKey: string = await new Promise((resolve) =>
      chrome.storage.local.get(["openaiKey"], (data) => {
        const key = data.openaiKey;
        resolve(typeof key === "string" ? key : "");
      })
    );

    if (!apiKey) {
      alert("❌ Please save your OpenAI API key first.");
      return;
    }

    if (document.getElementById("chat-widget")) return;

    // ===== STYLE (THEME SYSTEM) =====
    const style = document.createElement("style");
    style.textContent = `
      #chat-widget {
        --bg: #ffffff;
        --text: #111111;
        --border: #ddd;
        --user-msg: #DCF8C6;
        --bot-msg: #F1F0F0;
        --input-bg: #ffffff;
        --header-bg: #007bff;
      }

      #chat-widget.dark {
        --bg: #1e1e1e;
        --text: #f5f5f5;
        --border: #333;
        --user-msg: #2e7d32;
        --bot-msg: #2a2a2a;
        --input-bg: #2b2b2b;
        --header-bg: #0d6efd;
      }

      #chat-widget input {
        outline: none;
      }
    `;
    document.head.appendChild(style);

    const chatDiv = document.createElement("div");
    chatDiv.id = "chat-widget";
    Object.assign(chatDiv.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: "300px",
      height: "400px",
      backgroundColor: "var(--bg)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      boxShadow: "0 0 10px rgba(0,0,0,0.2)",
      zIndex: "99999",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "sans-serif",
    });

    // ===== DARK MODE DETECTION =====
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      chatDiv.classList.add("dark");
    }

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (e.matches) chatDiv.classList.add("dark");
        else chatDiv.classList.remove("dark");
      });

    // ===== HEADER =====
    const header = document.createElement("div");
    Object.assign(header.style, {
      backgroundColor: "var(--header-bg)",
      color: "white",
      padding: "8px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    });

    const title = document.createElement("span");
    title.textContent = "Chat with RAG";
    title.style.fontWeight = "bold";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
      background: "transparent",
      color: "white",
      border: "none",
      cursor: "pointer",
      fontSize: "16px",
    });

    closeBtn.addEventListener("click", () => {
      chatDiv.remove();
      (window as any).chatWidgetInjected = false;
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    chatDiv.appendChild(header);

    // ===== MESSAGES =====
    const messages = document.createElement("div");
    Object.assign(messages.style, {
      flex: "1",
      padding: "8px",
      overflowY: "auto",
      backgroundColor: "var(--bg)",
      color: "var(--text)",
    });
    chatDiv.appendChild(messages);

    function addMessage(text: string, fromUser = true) {
      const msg = document.createElement("div");

      const rtl = isRTL(text);
      const dir = rtl ? "rtl" : "ltr";

      msg.textContent = text;

      Object.assign(msg.style, {
        margin: "4px 0",
        backgroundColor: fromUser ? "var(--user-msg)" : "var(--bot-msg)",
        color: "#000",
        padding: "6px 10px",
        borderRadius: "6px",
        maxWidth: "90%",
        alignSelf: fromUser ? "flex-end" : "flex-start",
        direction: dir,
        textAlign: dir === "rtl" ? "right" : "left",
      });

      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
    }

    // ===== INPUT =====
    const inputDiv = document.createElement("div");
    Object.assign(inputDiv.style, {
      display: "flex",
      borderTop: "1px solid var(--border)",
      backgroundColor: "var(--bg)",
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ask something...";

    Object.assign(input.style, {
      flex: "1",
      border: "none",
      padding: "8px",
      backgroundColor: "var(--input-bg)",
      color: "var(--text)",
    });

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send";

    Object.assign(sendBtn.style, {
      border: "none",
      backgroundColor: "#007bff",
      color: "white",
      padding: "8px 12px",
      cursor: "pointer",
    });

    inputDiv.appendChild(input);
    inputDiv.appendChild(sendBtn);
    chatDiv.appendChild(inputDiv);

    document.body.appendChild(chatDiv);

    // ===== SEND LOGIC =====
    async function sendQuestion() {
      const question = input.value.trim();
      if (!question) return;

      addMessage(question, true);
      input.value = "";

      try {
        const storage = await chrome.storage.local.get([
          "token",
          "openaiKey",
        ]);

        const token = storage.token;

        if (!token) {
          addMessage("❌ Please login first.", false);
          return;
        }

        const response = await fetch("https://katelynn-nonsegmented-melvina.ngrok-free.dev/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question,
            apiKey,
            url: window.location.href,
          }),
        });

        const data = await response.json();
        addMessage(data.answer || "No answer.", false);
      } catch (err) {
        console.error(err);
        addMessage("Error contacting server.", false);
      }
    }

    sendBtn.addEventListener("click", sendQuestion);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendQuestion();
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "openChatWidget") injectChatWidget();
  });
})();