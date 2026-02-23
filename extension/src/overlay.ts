// overlay.ts
console.log("✅ overlay script loaded (shadow version)");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "openSearchOverlay") openSearchOverlay();
});

function openSearchOverlay(): void {
  // Remove previous instances
  const old = document.getElementById("tabchat-shadow-root");
  if (old) old.remove();

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
      color-scheme: light only; /* ✅ Prevent dark mode inversion */
    }

    #overlay-root {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(8px) saturate(160%) brightness(0.9);
      -webkit-backdrop-filter: blur(8px) saturate(160%) brightness(0.9);
    }

    .box {
      position: relative;
      background: #ffffff !important; /* ✅ Always white background */
      color: #000000 !important; /* ✅ Always dark text */
      border-radius: 14px;
      width: 720px;
      max-width: 90%;
      padding: 22px;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
      z-index: 1;
      display: flex;
      flex-direction: column;
    }

    input {
      width: 100%;
      font-size: 18px;
      padding: 10px 12px;
      border: 1px solid #ccc;
      border-radius: 8px;
      outline: none;
      background: #fff !important; /* ✅ Force light input */
      color: #000 !important; /* ✅ Dark text */
    }

    input::placeholder {
      color: #666;
    }

    #results {
      margin-top: 14px;
      max-height: 400px;
      overflow-y: auto;
      background: #fff; /* ✅ Fixed white background */
      color: #000;
      border-radius: 8px;
    }

    .item {
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s ease;
      background: #fff;
      color: #000;
      border: 1px solid transparent;
    }

    .item:hover {
      background: #f2f2f2;
      border-color: #ddd;
    }

    a {
      color: #007aff;
      text-decoration: none;
      word-break: break-all;
    }

    a:hover {
      text-decoration: underline;
    }
  `;
  shadow.appendChild(style);

  // Build overlay structure in Shadow DOM
  const overlay = document.createElement("div");
  overlay.id = "overlay-root";
  overlay.innerHTML = `
    <div class="backdrop" data-role="backdrop"></div>
    <div class="box">
      <input id="searchInput" type="text" placeholder="🔍 Search tabs..." autofocus />
      <div id="results"></div>
    </div>
  `;
  shadow.appendChild(overlay);

  const backdrop = shadow.querySelector('[data-role="backdrop"]') as HTMLElement;
  const input = shadow.querySelector("#searchInput") as HTMLInputElement;
  const resultsDiv = shadow.querySelector("#results") as HTMLDivElement;

  // Initial focus
  input.focus();

  // Close overlay on click or ESC
  backdrop.addEventListener("click", closeOverlay);
  document.addEventListener("keydown", onKeyDown);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") closeOverlay();
  }

  function closeOverlay() {
    document.removeEventListener("keydown", onKeyDown);
    host.remove();
  }

  // Search logic
  input.addEventListener("input", async () => {
    const q = input.value.trim();
    if (!q) {
      resultsDiv.innerHTML = "";
      return;
    }

    resultsDiv.innerHTML = "<div style='opacity:0.7;'>Searching...</div>";

    const data = await chrome.storage.local.get(["openaiKey"]);
    const apiKey = data.openaiKey as string | undefined;
    if (!apiKey) {
      resultsDiv.innerHTML = "<div style='color:red;'>❌ API key is not set</div>";
      return;
    }

    try {
      const r = await fetch("http://localhost:8000/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, apiKey }),
      });
      const j = await r.json();

      if (!j.ok || !Array.isArray(j.results)) {
        resultsDiv.innerHTML = `<div style='color:red;'>❌ Error: ${
          j.error || "Invalid response from server"
        }</div>`;
        return;
      }

      if (j.results.length === 0) {
        resultsDiv.innerHTML = "<div style='opacity:0.6;'>No results found</div>";
        return;
      }

      resultsDiv.innerHTML = j.results
        .map((r: any) => {
          const title = escapeHtml(r.metadata?.title || "Untitled");
          const url = escapeHtml(r.metadata?.url || "");
          const snippet = escapeHtml(r.content?.slice(0, 200) || "");
          return `
            <div class="item">
              <div style="font-weight:600;margin-bottom:3px;">${title}</div>
              ${
                url
                  ? `<a href="${url}" target="_blank">${url}</a><br>`
                  : ""
              }
              <small style="opacity:0.7;">${snippet}</small>
            </div>
          `;
        })
        .join("");
    } catch (err) {
      console.error("❌ Search request failed:", err);
      resultsDiv.innerHTML = "<div style='color:red;'>❌ Error connecting to server</div>";
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m: string) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[m] || m;
  });
}