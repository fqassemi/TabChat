
"use strict";

// popup.ts

const SERVER = "https://tabchat-production-f7d0.up.railway.app";

const EXCLUDED_DOMAINS = [
    // AI
    "claude.ai",
    "chat.openai.com",
    "chatgpt.com",
    "gemini.google.com",
    "copilot.microsoft.com",
    "perplexity.ai",

    // Email
    "mail.google.com",
    "mail.yahoo.com",
    "outlook.live.com",
    "outlook.office.com",
    "mail.proton.me",
    "proton.me",
    "mail.aol.com",
    "icloud.com",

    // Messaging
    "web.whatsapp.com",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",

    // Browser pages
    "chrome://",
    "edge://",
    "about:",
];

function isExcludedUrl(url) {
    try {
        const hostname = new URL(url).hostname;

        return EXCLUDED_DOMAINS.some(
            (domain) =>
                hostname === domain ||
                hostname.endsWith(`.${domain}`)
        );
    }
    catch {
        return true;
    }
}

document.addEventListener("DOMContentLoaded", () => {

    // ------------------ MY PINS ------------------

    const myPinsBtn = document.getElementById("myPinsBtn");
    const pinsContainer = document.getElementById("pinsContainer");
    const pinsList = document.getElementById("pinsList");

    // ------------------ GENERAL ------------------

    const collect = document.getElementById("collect");
    const chatBtn = document.getElementById("chatBtn");
    const openOverlayBtn = document.getElementById("openOverlay");

    const status = document.getElementById("status");
    const collectStatus = document.getElementById("collectStatus");

    // ------------------ CHAT SETTINGS ------------------

    const chatApiKeyInput = document.getElementById("chatApiKey");
    const chatBaseUrlInput = document.getElementById("chatBaseUrl");
    const saveChatBtn = document.getElementById("saveChatSettings");
    const chatSettingsStatus = document.getElementById("chatSettingsStatus");

    // ------------------ LOGIN ------------------

    const loginBtn = document.getElementById("loginBtn");
    const loginStatus = document.getElementById("loginStatus");
    const logoutBtn = document.getElementById("logoutBtn");

    // ------------------ PROGRESS ------------------

    const progressText = document.getElementById("progressText");
    const progressFill = document.getElementById("progressFill");

    const closeTabsContainer =
        document.getElementById("closeTabsContainer");

    const closeTabStatus =
        document.getElementById("closeTabStatus");

    // ------------------ MY TABS ------------------

    const myTabsBtn = document.getElementById("myTabsBtn");
    const tabsContainer = document.getElementById("tabsContainer");
    const tabsList = document.getElementById("tabsList");
    const tabsSearch = document.getElementById("tabsSearch");
    const loadMoreBtn = document.getElementById("loadMoreBtn");

    let allTabs = [];
    let offset = 0;

    const limit = 5;

    let loading = false;
    let hasMore = true;

    // ------------------ STORAGE SETTINGS ------------------

    const storageType = document.getElementById("storageType");
    const scpSettings = document.getElementById("scpSettings");
    const scpHost = document.getElementById("scpHost");
    const scpUsername = document.getElementById("scpUsername");
    const scpPassword = document.getElementById("scpPassword");
    const scpRemotePath = document.getElementById("scpRemotePath");
    const saveStorage = document.getElementById("saveStorage");
    const storageStatus = document.getElementById("storageStatus");

    console.log("Popup loaded ✅");

    // =========================================================
    // CHAT SETTINGS
    // =========================================================

    chrome.storage.local.get(
        ["chatApiKey", "chatBaseUrl"],
        (data) => {

            if (data.chatApiKey) {
                chatApiKeyInput.value = "********";
            }

            if (data.chatBaseUrl) {
                chatBaseUrlInput.value = data.chatBaseUrl;
            }
        }
    );

    saveChatBtn.addEventListener("click", async () => {

        const key = chatApiKeyInput.value.trim();
        const baseUrl = chatBaseUrlInput.value.trim();

        // حالت پیش‌فرض:
        // کلید خالی یا ماسک‌شده → حذف تنظیمات
        if (!key || key === "********") {

            chrome.storage.local.remove(
                ["chatApiKey", "chatBaseUrl"],
                () => {

                    chatSettingsStatus.textContent =
                        "✅ Using our default AI provider.";

                    chatSettingsStatus.style.color = "#16a34a";
                }
            );

            return;
        }

        setSavingState(true);

        chatSettingsStatus.textContent = "";

        try {

            const res = await fetch(
                `${SERVER}/validate-provider`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                    },

                    body: JSON.stringify({
                        apiKey: key,
                        baseURL: baseUrl || undefined,
                    }),
                }
            );

            const data = await res.json();

            if (!data.ok) {

                chatSettingsStatus.textContent =
                    data.error || "❌ Validation failed.";

                chatSettingsStatus.style.color = "#dc2626";

                return;
            }

            chrome.storage.local.set(
                {
                    chatApiKey: key,
                    chatBaseUrl: baseUrl,
                },
                () => {

                    chatSettingsStatus.textContent =
                        "✅ Verified & saved.";

                    chatSettingsStatus.style.color = "#16a34a";
                }
            );
        }
        catch (err) {

            console.error(
                "❌ Validation request failed:",
                err
            );

            chatSettingsStatus.textContent =
                "❌ Could not reach validation server.";

            chatSettingsStatus.style.color = "#dc2626";
        }
        finally {

            setSavingState(false);
        }
    });

    function setSavingState(saving) {

        saveChatBtn.disabled = saving;

        saveChatBtn.classList.toggle(
            "saving",
            saving
        );

        saveChatBtn.innerHTML = saving
            ? `<span class="spinner"></span> Verifying...`
            : `Save`;
    }

    function getProviderSettings() {

        return new Promise((resolve) => {

            chrome.storage.local.get(
                ["chatApiKey", "chatBaseUrl"],
                (data) => resolve(data)
            );
        });
    }

    // =========================================================
    // LOGIN
    // =========================================================

    loginBtn.addEventListener("click", async () => {

        const redirectURL =
            chrome.identity.getRedirectURL("auth");

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

                    console.error(
                        "No auth result"
                    );

                    return;
                }

                const url = new URL(result);

                const params =
                    new URLSearchParams(
                        url.hash.substring(1)
                    );

                const token = params.get("token");
                const email = params.get("email");
                const name = params.get("name");

                if (token) {

                    chrome.storage.local.set(
                        {
                            token,
                            userEmail: email,
                            userName: name,
                        },
                        async () => {

                            console.log(
                                "✅ Login success"
                            );

                            await updateLoginUI();
                        }
                    );
                }
                else {

                    console.error(
                        "❌Token not found in redirect"
                    );
                }
            }
        );
    });

    // =========================================================
    // LOGOUT
    // =========================================================

    logoutBtn.addEventListener(
        "click",
        () => {

            chrome.storage.local.remove(
                [
                    "token",
                    "userName",
                    "userEmail",
                ],
                async () => {

                    await updateLoginUI();
                }
            );
        }
    );

    // =========================================================
    // GET TOKEN
    // =========================================================

    function getToken() {

        return new Promise((resolve) => {

            chrome.storage.local.get(
                ["token"],
                (data) => {

                    resolve(
                        data.token ?? null
                    );
                }
            );
        });
    }

    // =========================================================
    // LOGIN UI
    // =========================================================

    async function updateLoginUI() {

        const data =
            await chrome.storage.local.get(
                [
                    "token",
                    "userName",
                    "userEmail",
                ]
            );

        if (data.token) {

            loginBtn.style.display = "none";

            logoutBtn.style.display = "block";

            const name =
                data.userName || "User";

            const initial =
                name.trim().charAt(0).toUpperCase() || "U";

            loginStatus.innerHTML = `
                <div class="logged-in">

                    <div class="avatar">
                        ${initial}
                    </div>

                    <div class="info">

                        <span class="name">
                            ${name}
                        </span>

                        <span class="email">
                            ${data.userEmail || ""}
                        </span>

                    </div>

                </div>
            `;
        }
        else {

            loginBtn.style.display = "flex";

            logoutBtn.style.display = "none";

            loginStatus.innerHTML = `
                <div class="logged-out">

                    <span class="status-dot"></span>

                    Not signed in

                </div>
            `;
        }
    }

    updateLoginUI();

    // =========================================================
    // STORAGE SETTINGS
    // =========================================================

    storageType.addEventListener(
        "change",
        () => {

            if (storageType.value === "scp") {

                scpSettings.style.display =
                    "block";
            }
            else {

                scpSettings.style.display =
                    "none";
            }
        }
    );

    saveStorage.addEventListener(
        "click",
        async () => {

            const token = await getToken();

            if (!token) {

                storageStatus.textContent =
                    "❌ Please login first.";

                storageStatus.style.color =
                    "#dc2626";

                return;
            }

            setStorageSavingState(true);

            storageStatus.textContent = "";

            try {

                const res = await fetch(
                    `${SERVER}/storage/config`,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Authorization:
                                `Bearer ${token}`,
                        },

                        body: JSON.stringify({
                            type:
                                storageType.value,

                            host:
                                scpHost.value.trim(),

                            username:
                                scpUsername.value.trim(),

                            password:
                                scpPassword.value,

                            remote_path:
                                scpRemotePath.value.trim(),
                        }),
                    }
                );

                const data = await res.json();

                if (data.ok) {

                    storageStatus.textContent =
                        storageType.value === "scp"
                            ? "✅ Connected & saved."
                            : "✅ Saved.";

                    storageStatus.style.color =
                        "#16a34a";
                }
                else {

                    storageStatus.textContent =
                        data.error ||
                        "❌ Failed to save.";

                    storageStatus.style.color =
                        "#dc2626";
                }
            }
            catch (err) {

                console.error(
                    "❌ Storage save request failed:",
                    err
                );

                storageStatus.textContent =
                    "❌ Could not reach server.";

                storageStatus.style.color =
                    "#dc2626";
            }
            finally {

                setStorageSavingState(false);
            }
        }
    );

    function setStorageSavingState(saving) {

        saveStorage.disabled = saving;

        saveStorage.innerHTML = saving
            ? `<span class="spinner"></span> Connecting...`
            : `Save`;
    }

    // =========================================================
    // COLLECT TABS
    // =========================================================

    collect.addEventListener(
        "click",
        async () => {

            document.getElementById(
                "progressContainer"
            ).style.display = "block";

            collectStatus.textContent =
                "Collecting tabs...";

            const providerSettings =
                await getProviderSettings();

            const token =
                await getToken();

            if (!token) {

                collectStatus.textContent =
                    "❌ Please login first.";

                return;
            }

            const tabs =
                await new Promise((res) =>
                    chrome.tabs.query(
                        {},
                        res
                    )
                );

            const docs = tabs

                .filter((t) =>
                    t.url?.startsWith("http")
                )

                .filter((t) =>
                    !isExcludedUrl(t.url)
                )

                .map((t) => ({
                    title:
                        t.title || "",

                    url:
                        t.url,

                    id:
                        t.id,
                }));

            try {

                progressText.textContent =
                    "0%";

                progressFill.style.width =
                    "0%";

                progressFill.classList.remove(
                    "done"
                );

                document.getElementById(
                    "progressContainer"
                ).style.display = "block";

                const ingestPromise =
                    fetch(
                        `${SERVER}/ingest`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json",

                                Authorization:
                                    `Bearer ${token}`,
                            },

                            body: JSON.stringify({
                                docs,

                                chatApiKey:
                                    providerSettings.chatApiKey,

                                chatBaseURL:
                                    providerSettings.chatBaseUrl,
                            }),
                        }
                    );

                const interval =
                    setInterval(
                        async () => {

                            const res =
                                await fetch(
                                    `${SERVER}/ingest-status`,
                                    {
                                        headers: {
                                            Authorization:
                                                `Bearer ${token}`,
                                        },
                                    }
                                );

                            const data =
                                await res.json();

                            const percent =
                                data.total
                                    ? Math.floor(
                                        (data.processed /
                                            data.total) *
                                        100
                                    )
                                    : 0;

                            progressFill.style.width =
                                `${percent}%`;

                            progressText.textContent =
                                `${percent}%`;

                            if (data.done) {

                                clearInterval(
                                    interval
                                );

                                progressFill.style.width =
                                    "100%";

                                progressFill.classList.add(
                                    "done"
                                );

                                progressText.textContent =
                                    `✅ ${data.processed}/${data.total} Tabs`;
                            }
                        },
                        500
                    );

                const j =
                    await (
                        await ingestPromise
                    ).json();

                if (j.skipped) {

                    clearInterval(
                        interval
                    );

                    progressFill.style.width =
                        "0%";

                    progressText.textContent =
                        "";

                    collectStatus.textContent =
                        j.message;

                    return;
                }

                if (!j.ok) {

                    clearInterval(
                        interval
                    );

                    collectStatus.textContent =
                        j.error ||
                        "❌ Error during processing.";

                    return;
                }

                clearInterval(interval);

                progressFill.style.width =
                    "100%";

                collectStatus.textContent =
                    j.message ||
                    "✅ Tabs collected. Indexing in background...";

                // ------------------
                // Index polling
                // ------------------

                const indexInterval =
                    setInterval(
                        async () => {

                            try {

                                const idxRes =
                                    await fetch(
                                        `${SERVER}/index-status`,
                                        {
                                            headers: {
                                                Authorization:
                                                    `Bearer ${token}`,
                                            },
                                        }
                                    );

                                const idxData =
                                    await idxRes.json();

                                const percent =
                                    idxData.total
                                        ? Math.floor(
                                            (idxData.indexed /
                                                idxData.total) *
                                            100
                                        )
                                        : 100;

                                progressFill.style.width =
                                    `${percent}%`;

                                progressText.textContent =
                                    idxData.error
                                        ? `❌ ${idxData.error}`
                                        : `Indexing: ${percent}%`;

                                if (idxData.done) {

                                    clearInterval(
                                        indexInterval
                                    );

                                    progressFill.classList.add(
                                        idxData.error
                                            ? ""
                                            : "done"
                                    );

                                    collectStatus.textContent =
                                        idxData.error
                                            ? "❌ Indexing failed."
                                            : "✅ Indexing complete. Ready to chat.";

                                    await chrome.notifications.create(
                                        {
                                            type: "basic",

                                            iconUrl:
                                                "https://www.google.com/favicon.ico",

                                            title:
                                                "TabChat",

                                            message:
                                                idxData.error
                                                    ? "Indexing failed ❌"
                                                    : "Tabs indexed & ready to chat ✅",
                                        }
                                    );
                                }
                            }
                            catch (err) {

                                console.error(
                                    "❌ Index status poll failed:",
                                    err
                                );
                            }
                        },
                        1000
                    );

                renderCloseTabsPrompt(
                    docs
                );
            }
            catch (e) {

                console.error(
                    "❌ Fetch error:",
                    e
                );

                collectStatus.textContent =
                    "❌ Error connecting to server.";
            }
        }
    );

    // =========================================================
    // SEARCH OVERLAY
    // =========================================================

    openOverlayBtn.addEventListener(
        "click",
        async () => {

            const [tab] =
                await chrome.tabs.query(
                    {
                        active: true,
                        currentWindow: true,
                    }
                );

            if (!tab?.id) {
                return;
            }

            await chrome.scripting.executeScript(
                {
                    target: {
                        tabId: tab.id,
                    },

                    files: [
                        "dist/overlay.js",
                    ],
                }
            );

            chrome.tabs.sendMessage(
                tab.id,
                {
                    action:
                        "openSearchOverlay",
                }
            );

            window.close();
        }
    );

    // =========================================================
    // CHAT WIDGET
    // =========================================================

    chatBtn.addEventListener(
        "click",
        async () => {

            const [tab] =
                await chrome.tabs.query(
                    {
                        active: true,
                        currentWindow: true,
                    }
                );

            if (!tab?.id) {
                return;
            }

            await chrome.scripting.executeScript(
                {
                    target: {
                        tabId: tab.id,
                    },

                    files: [
                        "dist/chatWidget.js",
                    ],
                }
            );

            chrome.tabs.sendMessage(
                tab.id,
                {
                    action:
                        "openChatWidget",
                }
            );

            status.textContent =
                "✅ Chat widget opened.";
        }
    );

    // =========================================================
    // LOAD TABS
    // =========================================================

    async function loadTabs(
        reset = false
    ) {

        if (loading || !hasMore) {
            return;
        }

        loading = true;

        setLoadMoreLoading(true);

        try {

            const token =
                await getToken();

            const providerSettings =
                await getProviderSettings();

            const qs =
                new URLSearchParams(
                    {
                        limit:
                            String(limit),

                        offset:
                            String(offset),
                    }
                );

            if (
                providerSettings.chatApiKey
            ) {

                qs.set(
                    "chatApiKey",
                    providerSettings.chatApiKey
                );
            }

            if (
                providerSettings.chatBaseUrl
            ) {

                qs.set(
                    "chatBaseURL",
                    providerSettings.chatBaseUrl
                );
            }

            const res =
                await fetch(
                    `${SERVER}/tabs?${qs.toString()}`,
                    {
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    }
                );

            const data =
                await res.json();

            if (!data.ok) {
                return;
            }

            const previousCount =
                allTabs.length;

            if (reset) {

                tabsList.innerHTML = "";

                allTabs = [];

                offset = 0;
            }

            allTabs = [
                ...allTabs,
                ...data.tabs,
            ];

            renderTabs(
                allTabs
            );

            offset += limit;

            hasMore =
                data.hasMore;

            if (
                !reset &&
                data.tabs.length > 0
            ) {

                const newItems =
                    Array.from(
                        tabsList.querySelectorAll(
                            ".tab-item"
                        )
                    ).slice(
                        previousCount
                    );

                newItems.forEach(
                    (el) =>
                        el.classList.add(
                            "new-item"
                        )
                );

                newItems[0]?.scrollIntoView(
                    {
                        behavior:
                            "smooth",

                        block:
                            "start",
                    }
                );
            }
        }
        finally {

            loading = false;

            setLoadMoreLoading(
                false
            );

            renderLoadMore();
        }
    }

    function setLoadMoreLoading(
        isLoading
    ) {

        loadMoreBtn.disabled =
            isLoading;

        loadMoreBtn.innerHTML =
            isLoading
                ? `<span class="spinner"></span> Loading...`
                : `Load more...`;
    }

    // =========================================================
    // CLOSE TABS PROMPT
    // =========================================================

    function renderCloseTabsPrompt(
        docs
    ) {

        const closable =
            docs.filter(
                (d) => d.id
            );

        closeTabsContainer.style.display =
            "block";

        closeTabsContainer.innerHTML = `
            <hr />

            <div style="font-weight:bold; margin-bottom:6px;">
                Which tabs should be closed?
            </div>

            <div style="margin-bottom:6px; display:flex; gap:6px;">

                <button
                    id="selectAllBtn"
                    type="button"
                >
                    Select All
                </button>

                <button
                    id="selectNoneBtn"
                    type="button"
                >
                    Select None
                </button>

            </div>

            <div
                id="closeTabsList"
                style="
                    max-height:200px;
                    overflow-y:auto;
                    border:1px solid #ddd;
                    padding:4px;
                "
            ></div>

            <button
                id="confirmCloseBtn"
                style="margin-top:8px;"
            >
                Close checked tabs
            </button>

            <button
                id="cancelCloseBtn"
                style="margin-top:4px;"
            >
                Don't close anything
            </button>
        `;

        const listDiv =
            document.getElementById(
                "closeTabsList"
            );

        closable.forEach(
            (doc) => {

                const row =
                    document.createElement(
                        "label"
                    );

                Object.assign(
                    row.style,
                    {
                        display:
                            "flex",

                        alignItems:
                            "center",

                        gap:
                            "6px",

                        padding:
                            "4px 0",

                        fontSize:
                            "12px",

                        borderBottom:
                            "1px solid #eee",
                    }
                );

                const checkbox =
                    document.createElement(
                        "input"
                    );

                checkbox.type =
                    "checkbox";

                checkbox.dataset.tabId =
                    String(doc.id);

                checkbox.checked =
                    false;

                const text =
                    document.createElement(
                        "span"
                    );

                text.textContent =
                    `${doc.title || "Untitled"} — ${doc.url}`;

                text.style.overflow =
                    "hidden";

                text.style.textOverflow =
                    "ellipsis";

                text.style.whiteSpace =
                    "nowrap";

                row.appendChild(
                    checkbox
                );

                row.appendChild(
                    text
                );

                listDiv.appendChild(
                    row
                );
            }
        );

        document
            .getElementById(
                "selectAllBtn"
            )
            .addEventListener(
                "click",
                () => {

                    listDiv
                        .querySelectorAll(
                            "input[type=checkbox]"
                        )
                        .forEach(
                            (cb) =>
                                (cb.checked =
                                    true)
                        );
                }
            );

        document
            .getElementById(
                "selectNoneBtn"
            )
            .addEventListener(
                "click",
                () => {

                    listDiv
                        .querySelectorAll(
                            "input[type=checkbox]"
                        )
                        .forEach(
                            (cb) =>
                                (cb.checked =
                                    false)
                        );
                }
            );

        document
            .getElementById(
                "cancelCloseBtn"
            )
            .addEventListener(
                "click",
                () => {

                    closeTabsContainer.style.display =
                        "none";

                    closeTabsContainer.innerHTML =
                        "";

                    closeTabStatus.textContent =
                        "✅ Tabs saved (nothing closed).";
                }
            );

        document
            .getElementById(
                "confirmCloseBtn"
            )
            .addEventListener(
                "click",
                async () => {

                    const checked =
                        Array.from(
                            listDiv.querySelectorAll(
                                "input[type=checkbox]:checked"
                            )
                        );

                    const idsToClose =
                        checked
                            .map(
                                (cb) =>
                                    Number(
                                        cb.dataset.tabId
                                    )
                            )
                            .filter(
                                (id) =>
                                    !Number.isNaN(
                                        id
                                    )
                            );

                    if (
                        idsToClose.length ===
                        0
                    ) {

                        closeTabStatus.textContent =
                            "No tab was selected to close.";

                        return;
                    }

                    await Promise.all(
                        idsToClose.map(
                            (id) =>
                                chrome.tabs
                                    .remove(id)
                                    .catch(
                                        () => {}
                                    )
                        )
                    );

                    closeTabStatus.textContent =
                        `✅ ${idsToClose.length} closed`;

                    closeTabsContainer.style.display =
                        "none";

                    closeTabsContainer.innerHTML =
                        "";
                }
            );
    }

    // =========================================================
    // RENDER TABS
    // =========================================================

    function renderTabs(
        tabs
    ) {

        tabsList.innerHTML =
            "";

        tabs.forEach(
            (tab) => {

                const div =
                    document.createElement(
                        "div"
                    );

                div.className =
                    "tab-item";

                const shortUrl =
                    tab.url.length > 40
                        ? tab.url.slice(
                            0,
                            40
                        ) + "..."
                        : tab.url;

                div.innerHTML = `
                    <div class="tab-content">

                        <div class="tab-title">
                            ${tab.title}
                        </div>

                        <div
                            class="tab-url"
                            title="${tab.url}"
                        >
                            ${shortUrl}
                        </div>

                    </div>

                    <button class="delete-btn">
                        🗑
                    </button>
                `;

                div.addEventListener(
                    "click",
                    () => {

                        chrome.tabs.create(
                            {
                                url:
                                    tab.url,
                            }
                        );
                    }
                );

                const deleteBtn =
                    div.querySelector(
                        ".delete-btn"
                    );

                deleteBtn.addEventListener(
                    "click",
                    async (e) => {

                        e.stopPropagation();

                        if (
                            !confirm(
                                "Delete this tab?"
                            )
                        ) {
                            return;
                        }

                        const token =
                            await getToken();

                        const providerSettings =
                            await getProviderSettings();

                        const res =
                            await fetch(
                                `${SERVER}/tabs`,
                                {
                                    method:
                                        "DELETE",

                                    headers: {
                                        "Content-Type":
                                            "application/json",

                                        Authorization:
                                            `Bearer ${token}`,
                                    },

                                    body:
                                        JSON.stringify(
                                            {
                                                url:
                                                    tab.url,

                                                chatApiKey:
                                                    providerSettings.chatApiKey,

                                                chatBaseURL:
                                                    providerSettings.chatBaseUrl,
                                            }
                                        ),
                                }
                            );

                        const data =
                            await res.json();

                        if (!data.ok) {

                            alert(
                                data.error ||
                                "Delete failed"
                            );

                            return;
                        }

                        allTabs =
                            allTabs.filter(
                                (t) =>
                                    t.url !==
                                    tab.url
                            );

                        renderTabs(
                            allTabs
                        );
                    }
                );

                tabsList.appendChild(
                    div
                );
            }
        );
    }

    // =========================================================
    // TABS SEARCH
    // =========================================================

    tabsSearch.addEventListener(
        "input",
        (e) => {

            const q =
                e.target.value.toLowerCase();

            const filtered =
                allTabs.filter(
                    (t) =>
                        t.title
                            .toLowerCase()
                            .includes(q) ||
                        t.url
                            .toLowerCase()
                            .includes(q)
                );

            renderTabs(
                filtered
            );
        }
    );

    // =========================================================
    // LOAD MORE
    // =========================================================

    function renderLoadMore() {

        if (hasMore) {

            loadMoreBtn.style.display =
                "block";
        }
        else {

            loadMoreBtn.style.display =
                "none";
        }
    }

    loadMoreBtn.addEventListener(
        "click",
        () => {
            loadTabs();
        }
    );

    // =========================================================
    // MY TABS BUTTON
    // =========================================================

    myTabsBtn.addEventListener(
        "click",
        async () => {

            if (
                tabsContainer.style.display ===
                "none"
            ) {

                tabsContainer.style.display =
                    "block";

                offset = 0;

                hasMore = true;

                await loadTabs(
                    true
                );
            }
            else {

                tabsContainer.style.display =
                    "none";
            }
        }
    );

    // =========================================================
    // MY PINS
    // =========================================================

    async function loadPins() {

        try {

            const result =
                await chrome.storage.local.get(
                    "pins"
                );

            const pins =
                result.pins || [];

            renderPins(
                pins
            );
        }
        catch (err) {

            console.error(
                "❌ Failed to load pins:",
                err
            );

            if (pinsList) {

                pinsList.innerHTML = `
                    <div class="empty-pins">
                        Failed to load pins.
                    </div>
                `;
            }
        }
    }

    function renderPins(
        pins
    ) {

        if (!pinsList) {
            return;
        }

        pinsList.innerHTML =
            "";

        if (!pins.length) {

            pinsList.innerHTML = `
                <div class="empty-pins">
                    📌 No pinned passages yet.
                </div>
            `;

            return;
        }

        // جدیدترین Pin اول نمایش داده شود
        [...pins]
            .reverse()
            .forEach(
                (pin) => {

                    const div =
                        document.createElement(
                            "div"
                        );

                    div.className =
                        "pin-item";

                    // ------------------
                    // Pin Text
                    // ------------------

                    const pinText =
                        document.createElement(
                            "div"
                        );

                    pinText.className =
                        "pin-text";

                    const text =
                        pin.text || "";

                    const shortText =
                        text.length > 180
                            ? `${text.slice(
                                0,
                                180
                            )}...`
                            : text;

                    // مهم:
                    // textContent استفاده شده
                    // تا HTML احتمالی متن اجرا نشود
                    pinText.textContent =
                        shortText;

                    // ------------------
                    // Title
                    // ------------------

                    const pinTitle =
                        document.createElement(
                            "div"
                        );

                    pinTitle.className =
                        "pin-title";

                    pinTitle.textContent =
                        pin.title ||
                        "Untitled";

                    // ------------------
                    // URL
                    // ------------------

                    const pinUrl =
                        document.createElement(
                            "div"
                        );

                    pinUrl.className =
                        "pin-url";

                    pinUrl.textContent =
                        pin.url || "";

                    // ------------------
                    // Timestamp
                    // ------------------

                    const pinMeta =
                        document.createElement(
                            "div"
                        );

                    pinMeta.className =
                        "pin-meta";

                    if (
                        pin.timestamp
                    ) {

                        pinMeta.textContent =
                            new Date(
                                pin.timestamp
                            ).toLocaleString();
                    }

                    // ------------------
                    // Actions
                    // ------------------

                    const actions =
                        document.createElement(
                            "div"
                        );

                    actions.className =
                        "pin-actions";

                    // Open button
                    const openBtn =
                        document.createElement(
                            "button"
                        );

                    openBtn.className =
                        "pin-open-btn";

                    openBtn.type =
                        "button";

                    openBtn.textContent =
                        "🔗 Open";

                    // Delete button
                    const deleteBtn =
                        document.createElement(
                            "button"
                        );

                    deleteBtn.className =
                        "pin-delete-btn";

                    deleteBtn.type =
                        "button";

                    deleteBtn.textContent =
                        "🗑 Delete";

                    // ------------------
                    // OPEN PIN
                    // ------------------

                    openBtn.addEventListener(
                        "click",
                        () => {

                            if (!pin.url) {
                                return;
                            }

                            chrome.tabs.create(
                                {
                                    url:
                                        pin.url,
                                }
                            );
                        }
                    );

                    // ------------------
                    // DELETE PIN
                    // ------------------

                    deleteBtn.addEventListener(
                        "click",
                        async () => {

                            if (
                                !confirm(
                                    "Delete this pin?"
                                )
                            ) {
                                return;
                            }

                            try {

                                const result =
                                    await chrome.storage.local.get(
                                        "pins"
                                    );

                                const currentPins =
                                    result.pins ||
                                    [];

                                const updatedPins =
                                    currentPins.filter(
                                        (item) =>
                                            item.id !==
                                            pin.id
                                    );

                                await chrome.storage.local.set(
                                    {
                                        pins:
                                            updatedPins,
                                    }
                                );

                                renderPins(
                                    updatedPins
                                );
                            }
                            catch (err) {

                                console.error(
                                    "❌ Failed to delete pin:",
                                    err
                                );

                                alert(
                                    "Failed to delete pin."
                                );
                            }
                        }
                    );

                    // ------------------
                    // Append
                    // ------------------

                    actions.appendChild(
                        openBtn
                    );

                    actions.appendChild(
                        deleteBtn
                    );

                    div.appendChild(
                        pinText
                    );

                    div.appendChild(
                        pinTitle
                    );

                    div.appendChild(
                        pinUrl
                    );

                    div.appendChild(
                        pinMeta
                    );

                    div.appendChild(
                        actions
                    );

                    pinsList.appendChild(
                        div
                    );
                }
            );
    }

    // =========================================================
    // MY PINS BUTTON
    // =========================================================

    myPinsBtn.addEventListener(
        "click",
        async () => {

            if (
                pinsContainer.style.display ===
                "none"
            ) {

                pinsContainer.style.display =
                    "block";

                await loadPins();
            }
            else {

                pinsContainer.style.display =
                    "none";
            }
        }
    );
});

