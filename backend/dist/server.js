// server.ts
import "dotenv/config";
import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { SupabaseVectorStoreImpl } from "./vectorstores/SupabaseVectorStoreImpl";
import { LocalDBVectorStoreImpl } from "./vectorstores/LocalDBVectorStoreImpl";
import { SQLiteVectorStoreImpl } from "./vectorstores/SQLiteVectorStoreImpl";
import { FaissSearchEngine } from "./vectorstores/FaissSearchEngine";
const app = express();
// ------------------ ENV ------------------
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_DB_URL = process.env.LOCAL_DB_URL;
// ------------------ Global State ------------------
let vectorStore = null;
let faissEngine = null;
let currentDBMode = null;
let isDbConfigured = false;
// ------------------ Database Initialization ------------------
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    console.log("🟢 Using Supabase as default database");
    vectorStore = new SupabaseVectorStoreImpl(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    currentDBMode = "supabase";
    isDbConfigured = true;
}
else if (LOCAL_DB_URL) {
    console.log("🟠 Using Local Postgres as default database");
    vectorStore = new LocalDBVectorStoreImpl(LOCAL_DB_URL);
    currentDBMode = "local";
    isDbConfigured = true;
}
else {
    console.log("🟣 No database configured yet — waiting for user configuration");
}
if (vectorStore) {
    await vectorStore.init();
    faissEngine = new FaissSearchEngine("./data/faiss.index");
}
// ------------------ Middleware ------------------
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));
// ------------------ Ingest ------------------
app.post("/ingest", async (req, res) => {
    const { docs, apiKey } = req.body;
    if (!isDbConfigured || !vectorStore)
        return res.status(400).json({ ok: false, error: "❌ No database configured." });
    if (!apiKey || !apiKey.startsWith("sk-"))
        return res.status(400).json({ ok: false, error: "❌ Missing or invalid OpenAI API key" });
    if (!Array.isArray(docs) || !docs.length)
        return res.status(400).json({ ok: false, error: "❌ Invalid or empty docs array." });
    const embedder = new OpenAIEmbeddings({ apiKey });
    try {
        const existingDocs = await vectorStore.getAllDocuments();
        const existingUrls = new Set(existingDocs.map((d) => d.metadata?.url).filter(Boolean));
        const uniqueDocs = docs.filter((d) => !existingUrls.has(d.url));
        if (uniqueDocs.length === 0)
            return res.json({ ok: true, message: "⚠️ All tabs already exist." });
        const allDocsToSave = [];
        let countTabs = 0;
        for (const doc of uniqueDocs) {
            try {
                const payload = {
                    url: doc.url,
                    formats: ["markdown"],
                    excludeTags: ["nav", "footer", "header", "script", "style"],
                    blockAds: true,
                    waitFor: 2000,
                };
                const response = await fetch(FIRECRAWL_API, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                const markdown = (data?.data?.markdown || "").trim();
                if (!markdown)
                    continue;
                // Split content
                const chunks = [];
                const maxLen = 5000;
                let buffer = "";
                const paragraphs = markdown.split(/\n{2,}/);
                for (const para of paragraphs) {
                    const trimmed = para.trim();
                    if (!trimmed)
                        continue;
                    if ((buffer + "\n\n" + trimmed).length > maxLen) {
                        if (buffer.trim().length > 50)
                            chunks.push(buffer.trim());
                        buffer = trimmed;
                    }
                    else
                        buffer += (buffer ? "\n\n" : "") + trimmed;
                }
                if (buffer.trim().length > 50)
                    chunks.push(buffer.trim());
                if (!chunks.length)
                    continue;
                countTabs++;
                const embeddings = await embedder.embedDocuments(chunks);
                chunks.forEach((chunk, i) => allDocsToSave.push({
                    text: chunk,
                    metadata: {
                        title: doc.title || "Untitled",
                        url: doc.url,
                        part: i + 1,
                    },
                    embedding: embeddings[i],
                }));
            }
            catch (err) {
                console.error(`❌ Firecrawl error for ${doc.url}:`, err);
            }
        }
        if (!allDocsToSave.length)
            return res.status(400).json({ ok: false, message: "❌ No valid content retrieved." });
        // Save to main DB
        await vectorStore.addDocuments(allDocsToSave, apiKey);
        // Sync with FAISS index
        if (!faissEngine)
            faissEngine = new FaissSearchEngine("./data/faiss.index");
        await faissEngine.syncFromDocuments(allDocsToSave, apiKey);
        res.json({
            ok: true,
            countTabs,
            countChunks: allDocsToSave.length,
            message: `✅ Saved ${allDocsToSave.length} chunks from ${countTabs} new tabs.`,
        });
    }
    catch (err) {
        console.error("❌ Ingest error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ------------------ Chat ------------------
app.post("/chat", async (req, res) => {
    const { question, apiKey, url } = req.body; // 👈 حالا url از فرانت هم میاد
    if (!question?.trim())
        return res.status(400).json({ answer: "Question required." });
    if (!apiKey || !apiKey.startsWith("sk-"))
        return res.status(400).json({ answer: "Missing or invalid OpenAI API key" });
    if (!isDbConfigured || !vectorStore)
        return res.status(400).json({ answer: "❌ No database configured." });
    try {
        const chatLLM = new ChatOpenAI({ apiKey, temperature: 0 });
        // ✅ اطمینان از آماده بودن FAISS
        if (!faissEngine) {
            faissEngine = new FaissSearchEngine("./data/faiss.index");
            await faissEngine.init(apiKey);
        }
        // 🧠 مرحله ۱: جستجو در FAISS
        let allResults = await faissEngine.search(question, apiKey, 10);
        // 🧩 فیلتر بر اساس تب فعلی
        let filteredResults = url
            ? allResults.filter((r) => r.metadata?.url === url)
            : allResults;
        // ⚙️ اگر چیزی برای تب فعلی پیدا نشد، fallback به کل ایندکس یا DB
        if (!filteredResults.length) {
            console.log("⚠️ No tab-specific FAISS results — using all FAISS data.");
            filteredResults = allResults;
        }
        // 🔁 اگر FAISS کاملاً خالی بود → fallback به vectorStore (مثلاً Supabase)
        if (!filteredResults.length && vectorStore?.similaritySearch) {
            console.log("⚠️ No FAISS results — falling back to DB vector search...");
            if (typeof vectorStore.similaritySearch === "function") {
                const dbResults = await vectorStore.similaritySearch(question, 5, apiKey);
                filteredResults = dbResults.map((r) => ({
                    text: r.text || r.content,
                    metadata: r.metadata || {},
                    score: r.score || 0,
                }));
            }
        }
        // 🧩 اگر هنوز خالی بود، پاسخ پیش‌فرض بده
        if (!filteredResults.length)
            return res.json({ answer: "No relevant information found for this tab." });
        // 🧱 ساخت context از داده‌ها
        const context = filteredResults.map((r) => r.text).join("\n\n");
        const fullPrompt = `
      Answer concisely based on the following context (from this tab only):
      ${context}

      Question: ${question}
    `;
        // 🧠 تولید پاسخ با ChatOpenAI
        const response = await chatLLM.generate([
            [
                { role: "system", content: "You are a helpful assistant that answers based on given context." },
                { role: "user", content: fullPrompt },
            ],
        ]);
        res.json({ answer: response.generations?.[0]?.[0]?.text?.trim() ?? "" });
    }
    catch (err) {
        console.error("❌ Chat error:", err);
        res.status(500).json({ answer: "Server error." });
    }
});
// ------------------ Config Switching ------------------
app.post("/config", async (req, res) => {
    const { supabaseUrl, supabaseKey, localDbUrl, sqlitePath } = req.body;
    try {
        if (supabaseUrl && supabaseKey) {
            console.log("🟢 Switching to Supabase...");
            vectorStore = new SupabaseVectorStoreImpl(supabaseUrl, supabaseKey);
            currentDBMode = "supabase";
        }
        else if (localDbUrl) {
            console.log("🟠 Switching to Local Postgres...");
            vectorStore = new LocalDBVectorStoreImpl(localDbUrl);
            currentDBMode = "local";
        }
        else if (sqlitePath) {
            console.log("🟣 Switching to SQLite...");
            vectorStore = new SQLiteVectorStoreImpl(sqlitePath);
            currentDBMode = "sqlite";
        }
        else
            throw new Error("No valid configuration provided");
        await vectorStore.init();
        isDbConfigured = true;
        res.json({ ok: true, mode: currentDBMode });
    }
    catch (err) {
        console.error("❌ Config switch failed:", err);
        res.json({ ok: false, error: err.message });
    }
});
// ------------------ Search ------------------
app.post("/search", async (req, res) => {
    const { q, apiKey } = req.body;
    if (!q?.trim())
        return res.status(400).json({ ok: false, error: "Query required" });
    if (!apiKey || !apiKey.startsWith("sk-"))
        return res.status(400).json({ ok: false, error: "Missing or invalid OpenAI API key" });
    if (!isDbConfigured || !vectorStore)
        return res.status(400).json({ ok: false, error: "❌ No database configured." });
    try {
        if (!faissEngine) {
            faissEngine = new FaissSearchEngine("./data/faiss.index");
            await faissEngine.init(apiKey);
        }
        const results = await faissEngine.search(q, apiKey, 5);
        // Filter out "init" and normalize metadata
        const cleanResults = results
            .filter((r) => r.text !== "init")
            .map((r) => ({
            content: r.text,
            metadata: {
                title: r.metadata?.title || "Untitled",
                url: r.metadata?.url || "",
                part: r.metadata?.part || 1,
            },
            score: r.score,
        }));
        res.json({ ok: true, results: cleanResults });
    }
    catch (err) {
        console.error("❌ Search error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ------------------ Start ------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
//# sourceMappingURL=server.js.map