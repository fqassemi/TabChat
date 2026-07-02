// popup.ts
const SERVER = "https://katelynn-nonsegmented-melvina.ngrok-free.dev";

type StorageData = {
  token?: string;
  openaiKey?: string;
};

document.addEventListener("DOMContentLoaded", () => {
  const collect = document.getElementById("collect") as HTMLButtonElement;
  const chatBtn = document.getElementById("chatBtn") as HTMLButtonElement;
  const openOverlayBtn = document.getElementById("openOverlay") as HTMLButtonElement;
  const status = document.getElementById("status") as HTMLDivElement;
  const collectStatus = document.getElementById("collectStatus") as HTMLDivElement;


  const openaiKeyInput = document.getElementById("openaiKey") as HTMLInputElement;
  const saveApiKeyBtn = document.getElementById("saveApiKey") as HTMLButtonElement;
  const apiKeyStatus = document.getElementById("apiKeyStatus") as HTMLDivElement;

  const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;

  const progressText = document.getElementById("progressText") as HTMLDivElement;
  const progressFill = document.getElementById("progressFill") as HTMLDivElement;

  const myTabsBtn = document.getElementById("myTabsBtn") as HTMLButtonElement;
  const tabsContainer = document.getElementById("tabsContainer") as HTMLDivElement;
  const tabsList = document.getElementById("tabsList") as HTMLDivElement;
  const tabsSearch = document.getElementById("tabsSearch") as HTMLInputElement;
  const loadMoreBtn = document.getElementById("loadMoreBtn") as HTMLButtonElement;
  let allTabs: { title: string; url: string }[] = [];

  let offset = 0;
  const limit = 5;
  let loading = false;
  let hasMore = true;

  console.log("Popup loaded ✅");

  // ------------------ LOAD API KEY ------------------
  chrome.storage.local.get(["openaiKey"], (data: StorageData) => {
    if (data.openaiKey) {
      openaiKeyInput.value = "********";
    }
  });

  // ------------------ SAVE API KEY ------------------
  saveApiKeyBtn.addEventListener("click", () => {
    const key = openaiKeyInput.value.trim();
    if (!key.startsWith("sk-")) {
      apiKeyStatus.textContent = "❌ Invalid API key format.";
      return;
    }
    chrome.storage.local.set({ openaiKey: key }, () => {
      apiKeyStatus.textContent = "✅ API key saved locally.";
    });
  });

  // ------------------ LOGIN (FIXED FLOW) ------------------
  loginBtn.addEventListener("click", async () => {
    const redirectURL = chrome.identity.getRedirectURL("auth");

    const authURL =
      `${SERVER}/auth/google/login` +
      `?redirect_uri=${encodeURIComponent(redirectURL)}`;

    chrome.identity.launchWebAuthFlow(
      {
        url: authURL,
        interactive: true,
      },
      (result) => {
        if (!result) {
          console.error("No auth result");
          return;
        }

        // 🔥 مهم: چون server تو redirect می‌کنه با #token=
        const url = new URL(result);

        const hash = url.hash; // "#token=..."
        const token = hash.split("token=")[1];

        if (token) {
          chrome.storage.local.set({ token }, () => {
            console.log("✅ Login success");
            status.textContent = "✅Logged in successfully";
          });
        } else {
          console.error("❌Token not found in redirect");
        }
      }
    );
  });

  // ------------------ GET TOKEN ------------------
  function getToken(): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get(["token"], (data: StorageData) => {
        resolve(data.token ?? null);
      });
    });
  }

  // Collect tabs
    collect.addEventListener("click", async () => {
      collectStatus.textContent = "Collecting tabs...";

        const apiKey = await new Promise<string | undefined>((resolve) => {
          chrome.storage.local.get(["openaiKey"], (data) => {
            const typed = data as StorageData;
            resolve(typed.openaiKey);
          });
        });

        if (!apiKey) {
          collectStatus.textContent = "❌ Please enter your OpenAI API key first.";
          return;
        }

    const token = await getToken();

    if (!token) {
      collectStatus.textContent = "❌ Please login first.";
      return;
    }

        const tabs = await new Promise<chrome.tabs.Tab[]>((res) =>
          chrome.tabs.query({}, res)
        );

        const docs = tabs
          .filter((t) => t.url?.startsWith("http"))
          .map((t) => ({
            title: t.title || "",
            url: t.url!,
            id: t.id,
          }));

        try {
          progressText.textContent = "0%";
          progressFill.style.width = "0%";
          const ingestPromise = fetch(`${SERVER}/ingest`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              docs,
              apiKey,
            }),
          });
          const interval = setInterval(async () => {
            const res = await fetch(`${SERVER}/ingest-status`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            const data = await res.json();

            const percent = data.total
              ? Math.floor((data.processed / data.total) * 100)
              : 0;

            progressFill.style.width = `${percent}%`;
            progressText.textContent = `${percent}%`;

            if (data.done) {
              clearInterval(interval);

              progressFill.style.width = "100%";
              progressText.textContent = `✅ ${data.processed}/${data.total} Tabs`;
            }
          }, 500);

          const j = await (await ingestPromise).json();

          if (j.skipped) {
              clearInterval(interval);

              progressFill.style.width = "0%";
              progressText.textContent = "";

              collectStatus.textContent = j.message;

              return;
          }

          if (!j.ok) {
              collectStatus.textContent = j.error || "❌ Error during processing.";
              return;
          }

          collectStatus.textContent = "✅ Ingest done. Closing tabs...";
          const newTab = await chrome.tabs.create({
              url: "about:blank",
              active: false,
          });
          await chrome.notifications.create({
              type: "basic",
              iconUrl: "https://www.google.com/favicon.ico",
              title: "TabChat",
              message: "Tabs collected & processed ✅",
          });

          await Promise.all(
              docs.map((doc) =>
                doc.id ? chrome.tabs.remove(doc.id) : Promise.resolve()
              )
          );

          collectStatus.textContent = "✅ Tabs collected & closed.";

        } catch (e) {
          console.error("❌ Fetch error:", e);
          collectStatus.textContent = "❌ Error connecting to server.";
        }
    });

  // Open overlay
  openOverlayBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/overlay.js"],
    });

    chrome.tabs.sendMessage(tab.id, { action: "openSearchOverlay" });

    // Close popup after injection
    window.close();
  });

  // Open chat widget
  chatBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/chatWidget.js"],
    });

    chrome.tabs.sendMessage(tab.id, { action: "openChatWidget" });
    status.textContent = "✅ Chat widget opened.";
  });

  async function loadTabs(reset = false) {
    if (loading || !hasMore) return;

    loading = true;

    const token = await getToken();

    const res = await fetch(
      `${SERVER}/tabs?limit=${limit}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await res.json();

    if (!data.ok) return;

    if (reset) {
      tabsList.innerHTML = "";
      allTabs = [];
      offset = 0;
    }

    allTabs = [...allTabs, ...data.tabs];
    renderTabs(allTabs);

    offset += limit;
    hasMore = data.hasMore;

    loading = false;

    renderLoadMore();
  }

  function renderTabs(tabs: { title: string; url: string }[]) {
    tabsList.innerHTML = "";

    tabs.forEach((tab) => {
      const div = document.createElement("div");
      div.className = "tab-item";

      const shortUrl =
        tab.url.length > 40
          ? tab.url.slice(0, 40) + "..."
          : tab.url;

      div.innerHTML = `
      <div class="tab-content">
        <div class="tab-title">${tab.title}</div>
        <div class="tab-url" title="${tab.url}">
          ${shortUrl}
        </div>
      </div>

      <button class="delete-btn">🗑</button>
      `;

      div.addEventListener("click", () => {
        chrome.tabs.create({ url: tab.url });
      });

      const deleteBtn = div.querySelector(".delete-btn") as HTMLButtonElement;

      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        if (!confirm("Delete this tab?")) {
          return;
        }

        const token = await getToken();

        const { openaiKey } = await chrome.storage.local.get(["openaiKey"]);

        const res = await fetch(`${SERVER}/tabs`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            url: tab.url,
            apiKey: openaiKey,
          }),
        });

        const data = await res.json();

        if (!data.ok) {
          alert(data.error || "Delete failed");
          return;
        }

        // حذف از لیست فعلی
        allTabs = allTabs.filter((t) => t.url !== tab.url);

        renderTabs(allTabs);
      });

      tabsList.appendChild(div);
    });
  }

  tabsSearch.addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();

    const filtered = allTabs.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.url.toLowerCase().includes(q)
    );

    renderTabs(filtered);
  });


  function renderLoadMore() {
    if (hasMore) {
      loadMoreBtn.style.display = "block";
    } else {
      loadMoreBtn.style.display = "none";
    }
  }

  loadMoreBtn.addEventListener("click", () => {
    loadTabs();
  });

  myTabsBtn.addEventListener("click", async () => {
  if (tabsContainer.style.display === "none") {
    tabsContainer.style.display = "block";

    offset = 0;
    hasMore = true;

    await loadTabs(true);
  } else {
    tabsContainer.style.display = "none";
  }
  });
});