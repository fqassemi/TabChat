// server.ts
import "dotenv/config";
import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import crypto from "crypto";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { FaissSearchEngine } from "./vectorstores/FaissSearchEngine.ts";
import { pool } from "./db.ts";
import { createToken, verifyToken } from "./auth/middleware.ts";
import { getUserByEmail, createUser } from "./repositories/users.ts";
import { getStorageProvider } from "./storage/StorageFactory.ts";
import { saveUserStorage } from "./repositories/storage.ts";
import { runExclusive } from "./jobs/PerUserQueue.ts";
const app = express();
const FAISS_PATH = "./data/faiss";
const ingestProgress = new Map();
const indexProgress = new Map();
// ------------------ ENV ------------------
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// ------------------ Global State ------------------
const faissEngines = new Map();
async function getFaissEngine(userId) {
    let engine = faissEngines.get(userId);
    if (!engine) {
        const storage = await getStorageProvider(userId);
        console.log("STORAGE PROVIDER:", storage.constructor.name);
        engine = new FaissSearchEngine(FAISS_PATH, storage);
        faissEngines.set(userId, engine);
    }
    return engine;
}
// ------------------ Middleware ------------------
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));
// ------------------ Provider Resolution ------------------
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
// نگاشت baseURL شناخته‌شده -> مدل چت پیش‌فرض
// وقتی کاربر مدل وارد نمی‌کنه، از اینجا حدس زده می‌شه
const KNOWN_CHAT_MODELS = [
    { match: "api.groq.com", model: "llama-3.3-70b-versatile" },
    { match: "openrouter.ai", model: "openai/gpt-4o-mini" },
    { match: "api.together.xyz", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { match: "api.deepseek.com", model: "deepseek-chat" },
    { match: "api.mistral.ai", model: "mistral-small-latest" },
];
function isOpenAIBaseURL(baseURL) {
    if (!baseURL)
        return true;
    const normalized = baseURL.trim().replace(/\/+$/, "").toLowerCase();
    return normalized === "" || normalized.includes("api.openai.com");
}
function pickChatModel(baseURL) {
    if (isOpenAIBaseURL(baseURL))
        return DEFAULT_OPENAI_CHAT_MODEL;
    const found = KNOWN_CHAT_MODELS.find((p) => baseURL.includes(p.match));
    if (found)
        return found.model;
    throw new Error(`Unsupported provider. We don't have a default model mapped for this endpoint yet. Please contact support, or leave Base URL empty to use OpenAI.`);
}
function resolveProviders(input) {
    let chatApiKey;
    let chatBaseURL;
    let chatModel;
    if (input?.apiKey) {
        chatApiKey = input.apiKey;
        chatBaseURL = isOpenAIBaseURL(input.baseURL) ? undefined : input.baseURL;
        chatModel = pickChatModel(input.baseURL);
    }
    else {
        if (!DEFAULT_OPENAI_API_KEY?.startsWith("sk-")) {
            throw new Error("No API key configured.");
        }
        chatApiKey = DEFAULT_OPENAI_API_KEY;
        chatModel = DEFAULT_OPENAI_CHAT_MODEL;
    }
    // Embedding: فقط اگه کلید کاربر مال OpenAI باشه ازش استفاده می‌کنیم،
    // در غیر این صورت (مثل Groq که embedding نداره) از کلید پیش‌فرض ما استفاده می‌شه
    const userKeyIsOpenAI = input?.apiKey && isOpenAIBaseURL(input.baseURL);
    let embeddingApiKey;
    if (userKeyIsOpenAI) {
        embeddingApiKey = input.apiKey;
    }
    else {
        if (!DEFAULT_OPENAI_API_KEY?.startsWith("sk-")) {
            throw new Error("No embedding API key configured.");
        }
        embeddingApiKey = DEFAULT_OPENAI_API_KEY;
    }
    return {
        chat: { apiKey: chatApiKey, baseURL: chatBaseURL, model: chatModel },
        embedding: { apiKey: embeddingApiKey, model: DEFAULT_OPENAI_EMBEDDING_MODEL },
    };
}
function interpretProviderError(err) {
    const status = err?.status || err?.response?.status;
    const rawMessage = err?.message || err?.error?.message || "";
    if (status === 401 || /invalid api key|incorrect api key/i.test(rawMessage)) {
        return "❌ Invalid or expired API key.";
    }
    if (status === 404 || /model.*(does not exist|not found)/i.test(rawMessage)) {
        return "❌ Model not found on this endpoint. This provider may not be supported yet.";
    }
    if (status === 429) {
        return "⚠️ Key looks valid, but you're rate-limited or out of quota.";
    }
    if (status === 403) {
        return "❌ Access denied. Check your key's permissions or billing status.";
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(rawMessage)) {
        return "❌ Could not reach this endpoint. Check the Base URL.";
    }
    return `❌ Validation failed: ${rawMessage || "Unknown error"}`;
}
function normalizeBaseURL(baseURL) {
    if (!baseURL)
        return undefined;
    const trimmed = baseURL.trim().replace(/\/+$/, "");
    if (!trimmed)
        return undefined;
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error("Base URL must start with http:// or https://");
    }
    return trimmed;
}
function interpretStorageError(err) {
    const rawMessage = err?.message || "";
    if (/authentication|auth fail|permission denied \(publickey|password/i.test(rawMessage)) {
        return "❌ Authentication failed. Check your username/password.";
    }
    if (/ENOTFOUND|getaddrinfo|EHOSTUNREACH/i.test(rawMessage)) {
        return "❌ Host not found. Check the server address.";
    }
    if (/ECONNREFUSED/i.test(rawMessage)) {
        return "❌ Connection refused. Check the host and port, and that SSH/SFTP is running.";
    }
    if (/ETIMEDOUT|timed out/i.test(rawMessage)) {
        return "❌ Connection timed out. Check the host address and your network/firewall.";
    }
    if (/no such file|not exist|ENOENT/i.test(rawMessage)) {
        return "❌ Remote path does not exist. Check the path or create it first.";
    }
    if (/permission denied/i.test(rawMessage)) {
        return "❌ Permission denied on the remote path.";
    }
    return `❌ Connection failed: ${rawMessage || "Unknown error"}`;
}
// ------------------ GOOGLE LOGIN ------------------
app.get("/auth/google/login", (req, res) => {
    const redirect_uri = req.query.redirect_uri;
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            response_type: "code",
            scope: "openid email profile",
            access_type: "offline",
            prompt: "consent",
            state: redirect_uri, // مهم 👈 نگه داشتن redirect extension
        });
    res.redirect(url);
});
// ------------------ GOOGLE CALLBACK ------------------
app.get("/auth/google/callback", async (req, res) => {
    const code = req.query.code;
    const redirect_uri = req.query.state;
    if (!code)
        return res.status(400).send("No code");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            grant_type: "authorization_code",
        }),
    });
    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
        },
    });
    const userInfo = await userRes.json();
    let user = await getUserByEmail(userInfo.email);
    if (!user) {
        const id = crypto.randomUUID();
        await createUser(id, userInfo.email, userInfo.name, userInfo.picture);
        user = { id, email: userInfo.email };
    }
    const jwt = createToken(user.id);
    try {
        await pool.query(`
      INSERT INTO sessions (id, user_id, token, expires_at)
      VALUES ($1, $2, $3, NOW() + interval '30 days')
      `, [crypto.randomUUID(), user.id, jwt]);
        console.log("✅ session created");
    }
    catch (err) {
        console.error("❌ session insert failed:", err);
    }
    return res.redirect(`${redirect_uri}#token=${jwt}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(userInfo.name)}`);
});
// ------------------ AUTH MIDDLEWARE ------------------
function requireAuth(req, res, next) {
    try {
        const auth = req.headers.authorization;
        const token = auth?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "No token" });
        }
        const payload = verifyToken(token);
        req.userId = payload.userId;
        next();
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}
// ------------------ Validate Provider ------------------
app.post("/validate-provider", async (req, res) => {
    const { apiKey, baseURL: rawBaseURL } = req.body;
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
        return res.status(400).json({ ok: false, error: "❌ API key is required." });
    }
    let baseURL;
    let model;
    try {
        baseURL = normalizeBaseURL(rawBaseURL);
        model = pickChatModel(baseURL);
    }
    catch (err) {
        return res.status(400).json({ ok: false, error: `❌ ${err.message}` });
    }
    try {
        const testLLM = new ChatOpenAI({
            apiKey,
            model,
            temperature: 0,
            maxTokens: 5,
            timeout: 15000,
            configuration: isOpenAIBaseURL(baseURL) ? undefined : { baseURL },
        });
        await testLLM.invoke("ping");
        res.json({ ok: true, model });
    }
    catch (err) {
        console.error("❌ Provider validation failed:", err?.message || err);
        res.status(400).json({ ok: false, error: interpretProviderError(err) });
    }
});
// ------------------ Ingest ------------------
app.post("/ingest", requireAuth, async (req, res) => {
    const { docs, chatApiKey, chatBaseURL } = req.body;
    const userId = req.userId;
    const { embedding: embeddingConfig } = resolveProviders({
        apiKey: chatApiKey,
        baseURL: chatBaseURL,
    });
    if (!Array.isArray(docs) || !docs.length)
        return res.status(400).json({ ok: false, error: "❌ Invalid or empty docs array." });
    const engine = await getFaissEngine(userId);
    try {
        const existingUrls = await engine.getExistingUrls(userId);
        const uniqueDocs = docs.filter((d) => {
            if (existingUrls.has(d.url))
                return false;
            return true;
        });
        if (uniqueDocs.length === 0)
            return res.json({ ok: true, skipped: true, message: "⚠️ All tabs already exist." });
        const allChunksToIndex = [];
        let countTabs = 0;
        let processed = 0;
        ingestProgress.set(userId, {
            processed: 0,
            total: uniqueDocs.length,
            done: false,
        });
        for (const doc of uniqueDocs) {
            try {
                const payload = {
                    url: doc.url,
                    formats: ["markdown"],
                    onlyMainContent: false,
                    excludeTags: ["header", "footer", "head", "meta", "script", "style", "noscript"],
                    blockAds: true,
                    waitFor: 3000,
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
                // ─── Chunking ───
                const chunks = [];
                const maxLen = 800;
                let buffer = "";
                const paragraphs = markdown.split(/\n{2,}/);
                for (const para of paragraphs) {
                    const trimmed = para.trim();
                    if (!trimmed)
                        continue;
                    // فقط پاراگراف‌هایی که اصلاً متن ندارن حذف میشن
                    const textOnly = trimmed.replace(/\[.*?\]\(.*?\)/g, "").replace(/!\[.*?\]\(.*?\)/g, "").trim();
                    if (textOnly.length < 2)
                        continue;
                    if ((buffer + "\n\n" + trimmed).length > maxLen) {
                        if (buffer.trim().length > 30)
                            chunks.push(buffer.trim());
                        if (trimmed.length > maxLen) {
                            if (buffer.trim()) {
                                chunks.push(buffer.trim());
                                buffer = "";
                            }
                            for (let i = 0; i < trimmed.length; i += maxLen) {
                                chunks.push(trimmed.slice(i, i + maxLen));
                            }
                            continue;
                        }
                        buffer = trimmed;
                    }
                    else {
                        buffer += (buffer ? "\n\n" : "") + trimmed;
                    }
                }
                if (buffer.trim().length > 30)
                    chunks.push(buffer.trim());
                if (!chunks.length)
                    continue;
                countTabs++;
                chunks.forEach((chunk, i) => allChunksToIndex.push({
                    text: chunk,
                    metadata: {
                        title: doc.title || "Untitled",
                        url: doc.url,
                        part: i + 1,
                    },
                }));
                processed++;
                ingestProgress.set(userId, {
                    processed,
                    total: uniqueDocs.length,
                    done: false,
                });
            }
            catch (err) {
                console.error(`❌ Firecrawl error for ${doc.url}:`, err);
            }
        }
        if (!allChunksToIndex.length)
            return res.status(400).json({ ok: false, message: "❌ No valid content retrieved." });
        // چانک‌های خام رو ذخیره می‌کنیم و urls/tabs رو همین الان ثبت می‌کنیم
        // (تا اگه یوزر دوباره Collect بزنه، این تب‌ها دوباره اسکرپ نشن)
        await engine.savePendingChunks(userId, allChunksToIndex);
        await engine.saveUrls(userId, uniqueDocs.map((d) => d.url));
        await engine.saveTabs(userId, uniqueDocs.map((d) => ({ title: d.title || "Untitled", url: d.url })));
        await engine.syncStorage(userId); // آپلود metadata/tabs/pending برای SCP
        ingestProgress.set(userId, {
            processed: uniqueDocs.length,
            total: uniqueDocs.length,
            done: true,
        });
        res.json({
            ok: true,
            countTabs,
            countChunks: allChunksToIndex.length,
            message: `✅ ${countTabs} tab collected. Indexing started in background.`,
        });
        startBackgroundIndexing(userId, embeddingConfig);
    }
    catch (err) {
        console.error("❌ Ingest error:", err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: err.message });
        }
    }
});
function startBackgroundIndexing(userId, embeddingConfig) {
    runExclusive(userId, async () => {
        const engine = await getFaissEngine(userId);
        try {
            const pending = await engine.getPendingChunks(userId);
            if (!pending.length)
                return;
            indexProgress.set(userId, { indexed: 0, total: pending.length, done: false });
            const embedder = new OpenAIEmbeddings({
                apiKey: embeddingConfig.apiKey,
                model: embeddingConfig.model,
                configuration: embeddingConfig.baseURL ? { baseURL: embeddingConfig.baseURL } : undefined,
            });
            // به‌جای یک درخواست عظیم، دسته‌ای (batch) embed می‌کنیم
            // تا هم rate-limit امن‌تر باشه هم progress قابل گزارش باشه
            const BATCH_SIZE = 50;
            const docsWithEmbeddings = [];
            for (let i = 0; i < pending.length; i += BATCH_SIZE) {
                const batch = pending.slice(i, i + BATCH_SIZE);
                const texts = batch.map((c) => c.text);
                const embeddings = await embedder.embedDocuments(texts);
                batch.forEach((c, idx) => {
                    docsWithEmbeddings.push({ text: c.text, metadata: c.metadata, embedding: embeddings[idx] });
                });
                indexProgress.set(userId, {
                    indexed: Math.min(i + BATCH_SIZE, pending.length),
                    total: pending.length,
                    done: false,
                });
            }
            await engine.syncFromDocuments(docsWithEmbeddings, embeddingConfig, userId);
            await engine.clearPendingChunks(userId);
            await engine.syncStorage(userId);
            indexProgress.set(userId, { indexed: pending.length, total: pending.length, done: true });
        }
        catch (err) {
            console.error(`❌ Background indexing failed for ${userId}:`, err);
            indexProgress.set(userId, {
                indexed: 0,
                total: 0,
                done: true,
                error: err.message,
            });
        }
        finally {
            if (engine.isTemporary()) {
                await engine.cleanup(userId);
            }
        }
    });
}
app.get("/index-status", requireAuth, (req, res) => {
    const userId = req.userId;
    const state = indexProgress.get(userId);
    if (!state) {
        return res.json({ indexed: 0, total: 0, done: true });
    }
    res.json(state);
});
app.get("/ingest-status", requireAuth, (req, res) => {
    const userId = req.userId;
    const state = ingestProgress.get(userId);
    if (!state) {
        return res.json({
            processed: 0,
            total: 0,
            done: true,
        });
    }
    res.json(state);
});
// ------------------ Get Tabs ------------------
app.get("/tabs", requireAuth, async (req, res) => {
    const userId = req.userId;
    const limit = parseInt(req.query.limit || "5");
    const offset = parseInt(req.query.offset || "0");
    const { embedding: embeddingConfig } = resolveProviders({
        apiKey: req.query.chatApiKey,
        baseURL: req.query.chatBaseURL,
    });
    await runExclusive(userId, async () => {
        const engine = await getFaissEngine(userId);
        try {
            await engine.init(embeddingConfig, userId);
            const tabs = await engine.getTabs(userId);
            const paginated = tabs.slice(offset, offset + limit);
            res.json({
                ok: true,
                total: tabs.length,
                limit,
                offset,
                tabs: paginated,
                hasMore: offset + limit < tabs.length,
            });
        }
        catch (err) {
            console.error("❌ Get tabs error:", err);
            res.status(500).json({ ok: false, error: err.message });
        }
        finally {
            if (engine.isTemporary()) {
                await engine.cleanup(userId);
            }
        }
    });
});
// ------------------ Delete Tab ------------------
app.delete("/tabs", requireAuth, async (req, res) => {
    const { url, chatApiKey, chatBaseURL } = req.body;
    const userId = req.userId;
    if (!url) {
        return res.status(400).json({ ok: false, error: "Missing url" });
    }
    const { embedding: embeddingConfig } = resolveProviders({
        apiKey: chatApiKey,
        baseURL: chatBaseURL,
    });
    await runExclusive(userId, async () => {
        const engine = await getFaissEngine(userId);
        try {
            await engine.deleteByUrl(userId, embeddingConfig, url);
            await engine.deleteTab(userId, url);
            await engine.deleteUrl(userId, url);
            await engine.syncStorage(userId);
            res.json({ ok: true, message: "Tab deleted successfully." });
        }
        catch (err) {
            console.error("Delete tab error:", err);
            res.status(500).json({ ok: false, error: err.message });
        }
        finally {
            if (engine.isTemporary()) {
                await engine.cleanup(userId);
            }
        }
    });
});
// ------------------ Chat ------------------
app.post("/chat", requireAuth, async (req, res) => {
    const { question, url, chatApiKey, chatBaseURL } = req.body;
    const userId = req.userId;
    if (!question?.trim()) {
        return res.status(400).json({ answer: "Question required." });
    }
    const { chat: chatConfig, embedding: embeddingConfig } = resolveProviders({
        apiKey: chatApiKey,
        baseURL: chatBaseURL,
    });
    await runExclusive(userId, async () => {
        let topResults = [];
        const engine = await getFaissEngine(userId);
        try {
            topResults = await engine.search(question, embeddingConfig, userId, 10, url);
            if (!topResults.length) {
                return res.json({
                    answer: "I couldn't find any indexed content for this page. Please collect this page first.",
                });
            }
            const MAX_CHUNK_SIZE = 1200;
            const context = topResults
                .map((r) => (r.text || "").slice(0, MAX_CHUNK_SIZE))
                .join("\n\n");
            const MAX_CONTEXT_SIZE = 6000;
            const safeContext = context.length > MAX_CONTEXT_SIZE
                ? context.slice(0, MAX_CONTEXT_SIZE)
                : context;
            console.log("===== Chat Config =====");
            console.log("API Key:", chatConfig.apiKey?.slice(0, 8) + "...");
            console.log("Base URL:", chatConfig.baseURL);
            console.log("Model:", chatConfig.model);
            const chatLLM = new ChatOpenAI({
                apiKey: chatConfig.apiKey,
                model: chatConfig.model,
                temperature: 0,
                configuration: chatConfig.baseURL ? { baseURL: chatConfig.baseURL } : undefined,
            });
            const response = await chatLLM.invoke([
                {
                    role: "system",
                    content: ` You are a helpful assistant. Answer questions using ONLY the provided context.
              If the answer exists in the context, answer it clearly and completely.
              Do NOT say "I don't know" if the information is present in the context.
              Answer in the language the question was asked.`,
                },
                {
                    role: "user",
                    content: `Context:\n${safeContext}\n\nQuestion: ${question}`,
                },
            ]);
            res.json({ answer: response.content });
        }
        catch (err) {
            console.error("❌ Chat error:", err);
            res.status(500).json({
                answer: "Server error",
                sources: topResults.map((r) => ({
                    score: r.score,
                    url: r.metadata?.url,
                    title: r.metadata?.title,
                    part: r.metadata?.part,
                    preview: r.text.slice(0, 150),
                })),
            });
        }
        finally {
            if (engine.isTemporary()) {
                await engine.cleanup(userId);
            }
        }
    });
});
// ------------------ Search ------------------
app.post("/search", requireAuth, async (req, res) => {
    const { q, chatApiKey, chatBaseURL } = req.body;
    const userId = req.userId;
    if (!q?.trim())
        return res.status(400).json({ ok: false, error: "Query required" });
    const { embedding: embeddingConfig } = resolveProviders({
        apiKey: chatApiKey,
        baseURL: chatBaseURL,
    });
    await runExclusive(userId, async () => {
        const engine = await getFaissEngine(userId);
        try {
            const results = await engine.search(q, embeddingConfig, userId, 5);
            const cleanResults = results
                .filter((r) => r.text !== "init" && r.metadata?.meta !== "init")
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
        finally {
            if (engine.isTemporary()) {
                await engine.cleanup(userId);
            }
        }
    });
});
app.post("/storage/config", requireAuth, async (req, res) => {
    const userId = req.userId;
    const { type, host, username, password, remote_path } = req.body;
    try {
        if (type === "scp") {
            if (!host || !username || !remote_path) {
                return res.status(400).json({
                    ok: false,
                    error: "❌ Host, username, and remote path are required.",
                });
            }
            const { ScpStorageProvider } = await import("./storage/ScpStorageProvider.ts");
            const storage = new ScpStorageProvider({
                host,
                username,
                password,
                remote_path
            });
            await storage.validate();
        }
        await saveUserStorage(userId, type, host || null, username || null, password || null, remote_path || null);
        faissEngines.delete(userId);
        res.json({
            ok: true
        });
    }
    catch (err) {
        console.error("❌ Storage validation failed:", err?.message || err);
        const message = type === "scp"
            ? interpretStorageError(err)
            : `❌ ${err.message}`;
        res.status(400).json({
            ok: false,
            error: message
        });
    }
});
// ------------------ Start ------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
//# sourceMappingURL=server.js.map