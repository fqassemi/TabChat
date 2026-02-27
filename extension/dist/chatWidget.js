"use strict";
// chatWidget.ts
(() => {
    if (window.chatWidgetInjected)
        return;
    window.chatWidgetInjected = true;
    async function injectChatWidget() {
        const apiKey = await new Promise((resolve) => chrome.storage.local.get(["openaiKey"], (data) => {
            const key = data.openaiKey;
            resolve(typeof key === "string" ? key : "");
        }));
        if (!apiKey) {
            alert("❌ Please save your OpenAI API key first.");
            return;
        }
        if (document.getElementById("chat-widget"))
            return;
        const chatDiv = document.createElement("div");
        chatDiv.id = "chat-widget";
        Object.assign(chatDiv.style, {
            position: "fixed",
            bottom: "20px",
            right: "20px",
            width: "300px",
            height: "400px",
            backgroundColor: "white",
            border: "1px solid #ccc",
            borderRadius: "8px",
            boxShadow: "0 0 10px rgba(0,0,0,0.2)",
            zIndex: "99999",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "sans-serif",
        });
        // Header
        const header = document.createElement("div");
        Object.assign(header.style, {
            backgroundColor: "#007bff",
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
            lineHeight: "1",
        });
        closeBtn.title = "Close chat";
        closeBtn.addEventListener("click", () => {
            chatDiv.remove();
            window.chatWidgetInjected = false;
        });
        header.appendChild(title);
        header.appendChild(closeBtn);
        chatDiv.appendChild(header);
        const messages = document.createElement("div");
        Object.assign(messages.style, {
            flex: "1",
            padding: "8px",
            overflowY: "auto",
        });
        chatDiv.appendChild(messages);
        const inputDiv = document.createElement("div");
        Object.assign(inputDiv.style, {
            display: "flex",
            borderTop: "1px solid #ccc",
        });
        const input = document.createElement("input");
        input.type = "text";
        input.style.flex = "1";
        input.style.border = "none";
        input.style.padding = "8px";
        input.placeholder = "Ask something...";
        inputDiv.appendChild(input);
        const sendBtn = document.createElement("button");
        sendBtn.textContent = "Send";
        Object.assign(sendBtn.style, {
            border: "none",
            backgroundColor: "#007bff",
            color: "white",
            padding: "8px 12px",
        });
        inputDiv.appendChild(sendBtn);
        chatDiv.appendChild(inputDiv);
        document.body.appendChild(chatDiv);
        function addMessage(text, fromUser = true) {
            const msg = document.createElement("div");
            msg.textContent = text;
            Object.assign(msg.style, {
                margin: "4px 0",
                textAlign: fromUser ? "right" : "left",
                backgroundColor: fromUser ? "#DCF8C6" : "#F1F0F0",
                padding: "4px 8px",
                borderRadius: "4px",
            });
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
        }
        async function sendQuestion() {
            const question = input.value.trim();
            if (!question)
                return;
            addMessage(question, true);
            input.value = "";
            try {
                const response = await fetch("http://localhost:8000/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        question,
                        apiKey,
                        url: window.location.href, // ✅ اینجا URL تب فرستاده می‌شود
                    }),
                });
                const data = await response.json();
                addMessage(data.answer || "No answer.", false);
            }
            catch (err) {
                console.error(err);
                addMessage("Error contacting server.", false);
            }
        }
        sendBtn.addEventListener("click", sendQuestion);
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter")
                sendQuestion();
        });
    }
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "openChatWidget")
            injectChatWidget();
    });
})();
//# sourceMappingURL=chatWidget.js.map