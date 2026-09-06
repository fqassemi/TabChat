
"use strict";

// chatWidget.js
(() => {
  if (window.chatWidgetInjected) return;

  window.chatWidgetInjected = true;

  function isRTL(text) {
    return /[\u0600-\u06FF]/.test(text);
  }

  async function injectChatWidget() {
    if (document.getElementById("chat-widget")) return;

    // ===== STYLE =====
    const style = document.createElement("style");

    style.textContent = `
      #chat-widget {
        --bg: #ffffff;
        --text: #111111;
        --border: #e5e7eb;
        --user-msg: #3b82f6;
        --user-msg-text: #ffffff;
        --bot-msg: #f1f3f5;
        --bot-msg-text: #111111;
        --input-bg: #f5f6f8;
        --header-bg: linear-gradient(135deg, #3b82f6, #2563eb);
        --muted: #9aa0a6;
      }

      #chat-widget.dark {
        --bg: #1e1e1e;
        --text: #f5f5f5;
        --border: #333;
        --user-msg: #2563eb;
        --user-msg-text: #ffffff;
        --bot-msg: #2a2a2a;
        --bot-msg-text: #f5f5f5;
        --input-bg: #2b2b2b;
        --header-bg: linear-gradient(135deg, #1d4ed8, #1e3a8a);
        --muted: #888;
      }

      #chat-widget * {
        box-sizing: border-box;
        font-family: system-ui, sans-serif;
      }

      #chat-widget input {
        outline: none;
      }

      #chat-widget {
        opacity: 0;
        transform: translateY(16px) scale(0.97);
        animation: cw-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes cw-pop {
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      #cw-header {
        background: var(--header-bg);
        color: #fff;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: default;
      }

      #cw-header .cw-avatar {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
      }

      #cw-header .cw-titles {
        flex: 1;
        min-width: 0;
      }

      #cw-header .cw-title {
        font-weight: 700;
        font-size: 13px;
        line-height: 1.2;
      }

      #cw-header .cw-subtitle {
        font-size: 10.5px;
        opacity: 0.85;
        line-height: 1.2;
      }

      #cw-header button {
        background: transparent;
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 15px;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.9;
        transition: background 0.15s ease;
      }

      #cw-header button:hover {
        background: rgba(255,255,255,0.18);
        opacity: 1;
      }

      #cw-messages {
        scrollbar-width: thin;
        scrollbar-color: #c1c1c1 transparent;
      }

      #cw-messages::-webkit-scrollbar {
        width: 6px;
      }

      #cw-messages::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 999px;
      }

      .cw-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--muted);
        font-size: 12px;
        text-align: center;
        gap: 6px;
        padding: 0 20px;
      }

      .cw-empty .cw-empty-icon {
        font-size: 26px;
      }

      .cw-bubble {
        margin: 5px 0;
        padding: 8px 12px;
        border-radius: 14px;
        max-width: 85%;
        font-size: 13px;
        line-height: 1.4;
        word-wrap: break-word;
        opacity: 0;
        transform: translateY(6px);
        animation: cw-bubble-in 0.18s ease forwards;
        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
      }

      @keyframes cw-bubble-in {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .cw-bubble.user {
        background: var(--user-msg);
        color: var(--user-msg-text);
        margin-left: auto;
        border-bottom-right-radius: 4px;
      }

      .cw-bubble.bot {
        background: var(--bot-msg);
        color: var(--bot-msg-text);
        margin-right: auto;
        border-bottom-left-radius: 4px;
      }

      .cw-bubble.rtl {
        direction: rtl;
        text-align: right;
      }

      .cw-bubble.ltr {
        direction: ltr;
        text-align: left;
      }

      .cw-typing {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 9px 12px;
        background: var(--bot-msg);
        border-radius: 14px;
        border-bottom-left-radius: 4px;
        width: fit-content;
        margin: 5px 0;
      }

      .cw-typing span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--muted);
        animation: cw-blink 1.2s infinite ease-in-out;
      }

      .cw-typing span:nth-child(2) {
        animation-delay: 0.2s;
      }

      .cw-typing span:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes cw-blink {
        0%, 80%, 100% {
          opacity: 0.25;
          transform: scale(0.85);
        }

        40% {
          opacity: 1;
          transform: scale(1);
        }
      }

      #cw-input-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
        border-top: 1px solid var(--border);
        background: var(--bg);
      }

      #cw-input {
        flex: 1;
        border: none;
        border-radius: 999px;
        padding: 9px 14px;
        background: var(--input-bg);
        color: var(--text);
        font-size: 13px;
      }

      #cw-send {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: var(--user-msg);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.15s ease, transform 0.1s ease;
      }

      #cw-send:disabled {
        opacity: 0.4;
        cursor: default;
      }

      #cw-send:not(:disabled):hover {
        transform: scale(1.06);
      }
    `;

    document.head.appendChild(style);

    // ===== ROOT =====
    const chatDiv = document.createElement("div");

    chatDiv.id = "chat-widget";

    Object.assign(chatDiv.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      width: "310px",
      height: "420px",
      backgroundColor: "var(--bg)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: "16px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
      zIndex: "99999",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "sans-serif",
    });

    // Dark mode detection
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      chatDiv.classList.add("dark");
    }

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (e.matches) {
          chatDiv.classList.add("dark");
        } else {
          chatDiv.classList.remove("dark");
        }
      });

    // ===== HEADER =====
    const header = document.createElement("div");

    header.id = "cw-header";

    header.innerHTML = `
      <div class="cw-avatar">🤖</div>
      <div class="cw-titles">
        <div class="cw-title">TabChat</div>
        <div class="cw-subtitle">Ask about this page</div>
      </div>
      <button id="cw-minimize" title="Minimize">─</button>
      <button id="cw-close" title="Close">✕</button>
    `;

    chatDiv.appendChild(header);

    // ===== MESSAGES =====
    const messages = document.createElement("div");

    messages.id = "cw-messages";

    Object.assign(messages.style, {
      flex: "1",
      padding: "10px",
      overflowY: "auto",
      backgroundColor: "var(--bg)",
      color: "var(--text)",
      display: "flex",
      flexDirection: "column",
    });

    chatDiv.appendChild(messages);

    function showEmptyState() {
      messages.innerHTML = `
        <div class="cw-empty">
          <div class="cw-empty-icon">💬</div>
          <div>
            Ask me anything about this page.<br>
            I'll answer using its saved content.
          </div>
        </div>
      `;
    }

    showEmptyState();

    function addMessage(text, fromUser = true) {
      if (messages.querySelector(".cw-empty")) {
        messages.innerHTML = "";
      }

      const msg = document.createElement("div");
      const rtl = isRTL(text);

      msg.textContent = text;

      msg.className = `cw-bubble ${
        fromUser ? "user" : "bot"
      } ${rtl ? "rtl" : "ltr"}`;

      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
    }

    let typingEl = null;

    function showTyping() {
      if (messages.querySelector(".cw-empty")) {
        messages.innerHTML = "";
      }

      typingEl = document.createElement("div");

      typingEl.className = "cw-typing";

      typingEl.innerHTML =
        "<span></span><span></span><span></span>";

      messages.appendChild(typingEl);
      messages.scrollTop = messages.scrollHeight;
    }

    function hideTyping() {
      if (typingEl) {
        typingEl.remove();
        typingEl = null;
      }
    }

    // ===== INPUT =====
    const inputRow = document.createElement("div");

    inputRow.id = "cw-input-row";

    const input = document.createElement("input");

    input.id = "cw-input";
    input.type = "text";
    input.placeholder = "Ask something...";

    const sendBtn = document.createElement("button");

    sendBtn.id = "cw-send";
    sendBtn.disabled = true;

    sendBtn.innerHTML = `
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 11.5L21 3L13 21L11 13L3 11.5Z"
          fill="currentColor"
        />
      </svg>
    `;

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    chatDiv.appendChild(inputRow);

    document.body.appendChild(chatDiv);

    input.focus();

    input.addEventListener("input", () => {
      sendBtn.disabled = input.value.trim().length === 0;
    });

    // ===== HEADER ACTIONS =====
    let minimized = false;

    const minimizeBtn =
      header.querySelector("#cw-minimize");

    const closeBtn =
      header.querySelector("#cw-close");

    minimizeBtn.addEventListener("click", () => {
      minimized = !minimized;

      if (minimized) {
        messages.style.display = "none";
        inputRow.style.display = "none";
        chatDiv.style.height = "auto";
        minimizeBtn.textContent = "▢";
      } else {
        messages.style.display = "flex";
        inputRow.style.display = "flex";
        chatDiv.style.height = "420px";
        minimizeBtn.textContent = "─";
      }
    });

    closeBtn.addEventListener("click", () => {
      chatDiv.style.transition =
        "opacity 0.15s ease, transform 0.15s ease";

      chatDiv.style.opacity = "0";
      chatDiv.style.transform =
        "translateY(10px) scale(0.97)";

      setTimeout(() => {
        chatDiv.remove();
        window.chatWidgetInjected = false;
      }, 150);
    });

    // ===== SEND LOGIC =====
    async function sendQuestion() {
      const question = input.value.trim();

      if (!question) return;

      addMessage(question, true);

      input.value = "";
      sendBtn.disabled = true;

      showTyping();

      try {
        const storage = await chrome.storage.local.get([
          "token",
          "chatApiKey",
          "chatBaseUrl",
        ]);

        const token = storage.token;

        if (!token) {
          hideTyping();
          addMessage("❌ Please login first.", false);
          return;
        }

        // ===== GET CURRENT WINDOW ID =====
        const windowId = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "getCurrentWindowId",
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error(
                  "❌ Failed to get windowId:",
                  chrome.runtime.lastError.message
                );

                resolve(undefined);
                return;
              }

              console.log(
                "📥 windowId response:",
                response
              );

              resolve(response?.windowId);
            }
          );
        });

        console.log(
          "🪟 Chat windowId:",
          windowId
        );

        // ===== CHAT REQUEST =====
        const response = await fetch(
          "https://tabchat-production-f7d0.up.railway.app/chat",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              question,
              url: window.location.href,
              windowId,
              chatApiKey: storage.chatApiKey,
              chatBaseURL: storage.chatBaseUrl,
            }),
          }
        );

        const data = await response.json();

        hideTyping();

        addMessage(
          data.answer || "No answer.",
          false
        );
      } catch (err) {
        console.error(err);

        hideTyping();

        addMessage(
          "Error contacting server.",
          false
        );
      }
    }

    sendBtn.addEventListener(
      "click",
      sendQuestion
    );

    input.addEventListener(
      "keypress",
      (e) => {
        if (e.key === "Enter") {
          sendQuestion();
        }
      }
    );
  }

  chrome.runtime.onMessage.addListener(
    (msg) => {
      if (msg.action === "openChatWidget") {
        injectChatWidget();
      }
    }
  );
})();
