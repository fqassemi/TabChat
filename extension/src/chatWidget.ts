// chatWidget.ts
(() => {
  // جلوگیری از تزریق دوباره
  if ((window as any).chatWidgetInjected) return;
  (window as any).chatWidgetInjected = true;

  // ساخت div اصلی
  const chatDiv = document.createElement("div");
  chatDiv.id = "chat-widget";
  chatDiv.style.position = "fixed";
  chatDiv.style.bottom = "20px";
  chatDiv.style.right = "20px";
  chatDiv.style.width = "300px";
  chatDiv.style.height = "400px";
  chatDiv.style.backgroundColor = "white";
  chatDiv.style.border = "1px solid #ccc";
  chatDiv.style.borderRadius = "8px";
  chatDiv.style.boxShadow = "0 0 10px rgba(0,0,0,0.2)";
  chatDiv.style.zIndex = "99999";
  chatDiv.style.display = "flex";
  chatDiv.style.flexDirection = "column";

  // header
  const header = document.createElement("div");
  header.textContent = "Chat with RAG";
  header.style.backgroundColor = "#007bff";
  header.style.color = "white";
  header.style.padding = "8px";
  header.style.fontWeight = "bold";
  chatDiv.appendChild(header);

  // area نمایش پیام‌ها
  const messages = document.createElement("div");
  messages.style.flex = "1";
  messages.style.padding = "8px";
  messages.style.overflowY = "auto";
  chatDiv.appendChild(messages);

  // input و دکمه
  const inputDiv = document.createElement("div");
  inputDiv.style.display = "flex";
  inputDiv.style.borderTop = "1px solid #ccc";

  const input = document.createElement("input");
  input.type = "text";
  input.style.flex = "1";
  input.style.border = "none";
  input.style.padding = "8px";
  input.placeholder = "Ask something...";
  inputDiv.appendChild(input);

  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  sendBtn.style.border = "none";
  sendBtn.style.backgroundColor = "#007bff";
  sendBtn.style.color = "white";
  sendBtn.style.padding = "8px 12px";
  inputDiv.appendChild(sendBtn);

  chatDiv.appendChild(inputDiv);
  document.body.appendChild(chatDiv);

  // تابع اضافه کردن پیام
  function addMessage(text: string, fromUser = true) {
    const msg = document.createElement("div");
    msg.textContent = text;
    msg.style.margin = "4px 0";
    msg.style.textAlign = fromUser ? "right" : "left";
    msg.style.backgroundColor = fromUser ? "#DCF8C6" : "#F1F0F0";
    msg.style.padding = "4px 8px";
    msg.style.borderRadius = "4px";
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  // ارسال سوال
  sendBtn.addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) return;
    addMessage(question, true);
    input.value = "";

    // ارسال به سرور
    try {
      const r = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: window.location.href,
          question,
        }),
      });
      const j = await r.json();
      addMessage(j.answer || "No answer.", false);
    } catch (err) {
      console.error(err);
      addMessage("Error contacting server.", false);
    }
  });

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });
})();
