"use strict";
const SERVER = "http://localhost:8000";
document.addEventListener("DOMContentLoaded", () => {
    const collect = document.getElementById("collect");
    const searchBtn = document.getElementById("searchBtn");
    const chatBtn = document.getElementById("chatBtn");
    const searchInput = document.getElementById("search");
    const status = document.getElementById("status");
    const resultsDiv = document.getElementById("results");
    // ------------------ جمع‌آوری تب‌ها ------------------
    collect.addEventListener("click", async () => {
        status.textContent = "Collecting tabs...";
        const tabs = await new Promise((res) => chrome.tabs.query({}, res));
        const docs = [];
        for (const t of tabs) {
            if (!t.id || !t.url || !t.url.startsWith("http"))
                continue;
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: t.id },
                    files: ["dist/content.js"],
                });
                const text = await new Promise((res) => {
                    chrome.tabs.sendMessage(t.id, { type: "getText" }, (response) => {
                        res(response || "");
                    });
                });
                docs.push({ title: t.title || "", url: t.url, text });
            }
            catch (err) {
                console.warn("❌ Error reading tab:", t.url, err);
            }
        }
        try {
            const r = await fetch(`${SERVER}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docs }),
            });
            const j = await r.json();
            status.textContent = `Inserted: ${j.inserted || docs.length}`;
        }
        catch (e) {
            console.error(e);
            status.textContent = "Error sending to server";
        }
    });
    // ------------------ جستجو ------------------
    searchBtn.addEventListener("click", async () => {
        const q = searchInput.value.trim();
        if (!q)
            return;
        status.textContent = "Searching...";
        searchBtn.disabled = true;
        resultsDiv.innerHTML = "";
        try {
            const r = await fetch(`${SERVER}/search?q=${encodeURIComponent(q)}`);
            const j = await r.json();
            const results = j.results;
            const grouped = results.reduce((acc, r) => {
                if (!acc[r.url])
                    acc[r.url] = { ...r, scores: [r.score] };
                else
                    acc[r.url].scores.push(r.score);
                return acc;
            }, {});
            const finalResults = Object.values(grouped).map((r) => ({
                title: r.title,
                url: r.url,
                score: r.scores.reduce((a, b) => a + b, 0) / r.scores.length,
            }));
            finalResults.sort((a, b) => b.score - a.score);
            resultsDiv.innerHTML = finalResults
                .map((r) => `
          <div>
            <a href="${r.url}" target="_blank">${r.title}</a>
            <small>(${r.score.toFixed(2)})</small>
          </div>`)
                .join("");
            status.textContent = `Found ${finalResults.length} result(s)`;
        }
        catch (err) {
            console.error(err);
            status.textContent = "Search error";
        }
        finally {
            searchBtn.disabled = false;
        }
    });
    // ------------------ باز کردن Chat روی تب فعلی ------------------
    chatBtn.addEventListener("click", async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id)
            return;
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["dist/chatWidget.js"], // chatWidget باید کد JS چت باشه
            });
            status.textContent = "Chat opened on this tab.";
        }
        catch (err) {
            console.error(err);
            status.textContent = "Failed to open chat.";
        }
    });
});
//# sourceMappingURL=popup.js.map