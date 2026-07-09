"use strict";
// overlay.ts
console.log("✅ overlay script loaded (shadow version)");
// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === "openSearchOverlay")
        openSearchOverlay();
});
function openSearchOverlay() {
    // Remove previous instances
    const old = document.getElementById("tabchat-shadow-root");
    if (old)
        old.remove();
    // Create container for Shadow DOM
    const host = document.createElement("div");
    host.id = "tabchat-shadow-root";
    host.style.all = "unset";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "all";
    document.documentElement.appendChild(host);
    // Create isolated shadow root
    const shadow = host.attachShadow({ mode: "open" });
    // Add isolated CSS inside shadow
    const style = document.createElement("style");
    style.textContent = `
    * {
      box-sizing: border-box;
      font-family: system-ui, sans-serif;
      color-scheme: light only;
    }

    #overlay-root {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
      z-index: 2147483647;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px) saturate(160%) brightness(0.9);
      -webkit-backdrop-filter: blur(8px) saturate(160%) brightness(0.9);
      opacity: 0;
      animation: fadeIn 0.18s ease forwards;
    }

    .box {
      position: relative;
      background: #ffffff !important;
      color: #000000 !important;
      border-radius: 16px;
      width: 640px;
      max-width: 90%;
      max-height: 70vh;
      padding: 18px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0,0,0,0.04);
      z-index: 1;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translateY(-12px) scale(0.98);
      animation: popIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes fadeIn { to { opacity: 1; } }
    @keyframes popIn { to { opacity: 1; transform: translateY(0) scale(1); } }

    .search-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    input#searchInput {
      flex: 1;
      width: 100%;
      font-size: 16px;
      padding: 12px 14px;
      border: 1.5px solid #e5e7eb;
      border-radius: 12px;
      outline: none;
      background: #f9fafb !important;
      color: #000 !important;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    input#searchInput:focus {
      border-color: #3b82f6;
      background: #fff !important;
    }

    input::placeholder { color: #9aa0a6; }

    .close-btn {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      border: none;
      background: #f1f3f5;
      color: #555;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
    }
    .close-btn:hover { background: #e5e7eb; }

    #results {
      margin-top: 12px;
      overflow-y: auto;
      background: #fff;
      color: #000;
      border-radius: 8px;
    }

    .item {
      display: flex;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s ease;
      background: #fff;
      color: #000;
      border: 1px solid transparent;
      margin-bottom: 4px;
    }
    .item:hover {
      background: #f5f7fa;
      border-color: #e9ecef;
    }

    .favicon {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      margin-top: 2px;
      flex-shrink: 0;
      background: #eee;
    }

    .item-body { min-width: 0; flex: 1; }

    .item-title {
      font-weight: 600;
      font-size: 13.5px;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-url {
      font-size: 11.5px;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-decoration: none;
    }
    .item-url:hover { text-decoration: underline; }

    .item-snippet {
      font-size: 12px;
      color: #4b5563;
      margin-top: 3px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .empty-state, .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 30px 10px;
      color: #9aa0a6;
      font-size: 13px;
      gap: 6px;
    }
    .empty-state .icon, .loading-state .icon {
      font-size: 26px;
      margin-bottom: 4px;
    }

    .skeleton {
      height: 52px;
      border-radius: 10px;
      margin-bottom: 6px;
      background: linear-gradient(90deg, #f0f0f0 25%, #f7f7f7 37%, #f0f0f0 63%);
      background-size: 400% 100%;
      animation: skeletonLoad 1.4s ease infinite;
    }
    @keyframes skeletonLoad {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }

    .error-state {
      color: #dc2626;
      font-size: 13px;
      text-align: center;
      padding: 16px;
    }
  `;
    shadow.appendChild(style);
    // Build overlay structure in Shadow DOM
    const overlay = document.createElement("div");
    overlay.id = "overlay-root";
    overlay.innerHTML = `
    <div class="backdrop" data-role="backdrop"></div>
    <div class="box">
      <div class="search-row">
        <input id="searchInput" type="text" placeholder="🔍 Search your tabs..." autofocus />
        <button class="close-btn" data-role="close" title="Close (Esc)">✕</button>
      </div>
      <div id="results"></div>
    </div>
  `;
    shadow.appendChild(overlay);
    const backdrop = shadow.querySelector('[data-role="backdrop"]');
    const closeBtn = shadow.querySelector('[data-role="close"]');
    closeBtn.addEventListener("click", closeOverlay);
    const input = shadow.querySelector("#searchInput");
    const resultsDiv = shadow.querySelector("#results");
    // Initial focus
    input.focus();
    // Close overlay on click or ESC
    backdrop.addEventListener("click", closeOverlay);
    document.addEventListener("keydown", onKeyDown);
    function onKeyDown(e) {
        if (e.key === "Escape")
            closeOverlay();
    }
    function closeOverlay() {
        document.removeEventListener("keydown", onKeyDown);
        const box = shadow.querySelector(".box");
        const bd = shadow.querySelector(".backdrop");
        box.style.transition = "opacity 0.15s ease, transform 0.15s ease";
        box.style.opacity = "0";
        box.style.transform = "translateY(-8px) scale(0.98)";
        bd.style.transition = "opacity 0.15s ease";
        bd.style.opacity = "0";
        setTimeout(() => host.remove(), 150);
    }
    // Search logic
    let debounceTimer = null;
    input.addEventListener("input", () => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runSearch(), 300);
    });
    async function runSearch() {
        const q = input.value.trim();
        if (!q) {
            resultsDiv.innerHTML = "";
            return;
        }
        resultsDiv.innerHTML = `
      <div class="skeleton"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
    `;
        try {
            const storage = await chrome.storage.local.get([
                "token",
                "chatApiKey",
                "chatBaseUrl",
            ]);
            const token = storage.token;
            if (!token) {
                resultsDiv.innerHTML = `
        <div class="error-state">🔒 Please login first.</div>
      `;
                return;
            }
            const r = await fetch("http://localhost:8000/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    q,
                    chatApiKey: storage.chatApiKey,
                    chatBaseURL: storage.chatBaseUrl,
                }),
            });
            const j = await r.json();
            if (!j.ok || !Array.isArray(j.results)) {
                resultsDiv.innerHTML = `
        <div class="error-state">⚠️ ${j.error || "Invalid response from server"}</div>
      `;
                return;
            }
            if (j.results.length === 0) {
                resultsDiv.innerHTML = `
        <div class="empty-state">
          <div class="icon">🔍</div>
          No results found
        </div>
      `;
                return;
            }
            resultsDiv.innerHTML = j.results
                .map((r) => {
                const title = escapeHtml(r.metadata?.title || "Untitled");
                const url = escapeHtml(r.metadata?.url || "");
                const snippet = escapeHtml(r.content?.slice(0, 200) || "");
                const favicon = url
                    ? `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(url)}`
                    : "";
                return `
        <div class="item" data-url="${url}">
          ${favicon ? `<img class="favicon" src="${favicon}" alt="" />` : `<div class="favicon"></div>`}
          <div class="item-body">
            <div class="item-title">${title}</div>
            ${url ? `<a class="item-url" href="${url}" target="_blank">${url}</a>` : ""}
            <div class="item-snippet">${snippet}</div>
          </div>
        </div>
      `;
            })
                .join("");
            // کلیک روی هرجای کارت باز کنه، نه فقط لینک
            resultsDiv.querySelectorAll(".item").forEach((el) => {
                el.addEventListener("click", (e) => {
                    if (e.target.tagName === "A")
                        return; // خود لینک جدا هندل میشه
                    const url = el.dataset.url;
                    if (url)
                        window.open(url, "_blank");
                });
            });
        }
        catch (err) {
            console.error("❌ Search request failed:", err);
            resultsDiv.innerHTML =
                "<div style='color:red;'>❌ Error connecting to server</div>";
        }
    }
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => {
        const map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return map[m] || m;
    });
}
//# sourceMappingURL=overlay.js.map