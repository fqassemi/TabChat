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
import {
  saveUserStorage
} from "./repositories/storage.ts";
import { runExclusive } from "./jobs/PerUserQueue.ts";

const app = express();

const FAISS_PATH = "./data/faiss";
const ingestProgress = new Map<string, { processed: number; total: number; done: boolean }>();
const indexProgress = new Map<string, { indexed: number; total: number; done: boolean; error?: string }>();

// ------------------ ENV ------------------
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ------------------ Global State ------------------
const faissEngines = new Map<string, FaissSearchEngine>();

async function getFaissEngine(userId: string) {

  let engine = faissEngines.get(userId);


  if (!engine) {

    const storage = await getStorageProvider(userId);
    console.log("STORAGE PROVIDER:", storage.constructor.name);

    engine = new FaissSearchEngine(
      FAISS_PATH,
      storage
    );


    faissEngines.set(
      userId,
      engine
    );
  }


  return engine;
}

// ------------------ Middleware ------------------
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));


function resolveApiKey(apiKey?: string) {

  if (apiKey?.startsWith("sk-")) {
    return apiKey;
  }

  if (DEFAULT_OPENAI_API_KEY?.startsWith("sk-")) {
    return DEFAULT_OPENAI_API_KEY;
  }

  throw new Error("No OpenAI API key configured.");
}

// ------------------ GOOGLE LOGIN ------------------
app.get("/auth/google/login", (req, res) => {
  const redirect_uri = req.query.redirect_uri as string;

  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
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
  const code = req.query.code as string;
  const redirect_uri = req.query.state as string;

  if (!code) return res.status(400).send("No code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  const tokenData: any = await tokenRes.json();

  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    }
  );

  const userInfo: any = await userRes.json();

  let user = await getUserByEmail(userInfo.email);

  if (!user) {
    const id = crypto.randomUUID();
    await createUser(id, userInfo.email, userInfo.name, userInfo.picture);
    user = { id, email: userInfo.email };
  }

  const jwt = createToken(user.id);

  try {
    await pool.query(
      `
      INSERT INTO sessions (id, user_id, token, expires_at)
      VALUES ($1, $2, $3, NOW() + interval '30 days')
      `,
      [crypto.randomUUID(), user.id, jwt]
    );

    console.log("✅ session created");
  } catch (err) {
    console.error("❌ session insert failed:", err);
  }


  return res.redirect(
    `${redirect_uri}#token=${jwt}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(userInfo.name)}`
  );
});

// ------------------ AUTH MIDDLEWARE ------------------
function requireAuth(req: any, res: any, next: any) {
  try {
    const auth = req.headers.authorization;
    const token = auth?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token" });
    }

    const payload = verifyToken(token);
    req.userId = payload.userId;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ------------------ Ingest ------------------
app.post("/ingest", requireAuth, async (req: any, res) => {
  const { docs, apiKey } = req.body;
  const userId = req.userId;
  const key = resolveApiKey(apiKey);

  if (!Array.isArray(docs) || !docs.length)
    return res.status(400).json({ ok: false, error: "❌ Invalid or empty docs array." });

  const engine = await getFaissEngine(userId);

  try {
    const existingUrls = await engine.getExistingUrls(userId);

    const uniqueDocs = docs.filter((d) => {
      if (existingUrls.has(d.url)) return false;
      return true;
    });

    if (uniqueDocs.length === 0)
      return res.json({ ok: true, skipped: true, message: "⚠️ All tabs already exist." });

    const allChunksToIndex: { text: string; metadata: any }[] = [];
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
        if (!markdown) continue;

        // ─── Chunking ───
        const chunks: string[] = [];
        const maxLen = 800;
        let buffer = "";
        const paragraphs = markdown.split(/\n{2,}/);

        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;

          // فقط پاراگراف‌هایی که اصلاً متن ندارن حذف میشن
          const textOnly = trimmed.replace(/\[.*?\]\(.*?\)/g, "").replace(/!\[.*?\]\(.*?\)/g, "").trim();
          if (textOnly.length < 2) continue;

          if ((buffer + "\n\n" + trimmed).length > maxLen) {
            if (buffer.trim().length > 30) chunks.push(buffer.trim());
            buffer = trimmed;
          } else {
            buffer += (buffer ? "\n\n" : "") + trimmed;
          }
        }
        if (buffer.trim().length > 30) chunks.push(buffer.trim());
        if (!chunks.length) continue;

        countTabs++;
        chunks.forEach((chunk, i) =>
          allChunksToIndex.push({
              text: chunk,
              metadata: {
                  title: doc.title || "Untitled",
                  url: doc.url,
                  part: i + 1,
              },
          })
        );
        processed++;
        ingestProgress.set(userId, {
          processed,
          total: uniqueDocs.length,
          done: false,
        });
      } catch (err) {
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
    startBackgroundIndexing(userId, key);
  } catch (err: any) {
    console.error("❌ Ingest error:", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});


function startBackgroundIndexing(userId: string, apiKey: string) {
  runExclusive(userId, async () => {
    const engine = await getFaissEngine(userId);

    try {
      const pending = await engine.getPendingChunks(userId);
      if (!pending.length) return;

      indexProgress.set(userId, { indexed: 0, total: pending.length, done: false });

      const embedder = new OpenAIEmbeddings({ apiKey });

      // به‌جای یک درخواست عظیم، دسته‌ای (batch) embed می‌کنیم
      // تا هم rate-limit امن‌تر باشه هم progress قابل گزارش باشه
      const BATCH_SIZE = 50;
      const docsWithEmbeddings: { text: string; metadata: any; embedding: number[] }[] = [];

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const texts = batch.map((c: any) => c.text);
        const embeddings = await embedder.embedDocuments(texts);

        batch.forEach((c: any, idx: number) => {
          docsWithEmbeddings.push({ text: c.text, metadata: c.metadata, embedding: embeddings[idx] });
        });

        indexProgress.set(userId, {
          indexed: Math.min(i + BATCH_SIZE, pending.length),
          total: pending.length,
          done: false,
        });
      }

      await engine.syncFromDocuments(docsWithEmbeddings, apiKey, userId);
      await engine.clearPendingChunks(userId);
      await engine.syncStorage(userId);

      indexProgress.set(userId, { indexed: pending.length, total: pending.length, done: true });
    } catch (err: any) {
      console.error(`❌ Background indexing failed for ${userId}:`, err);
      indexProgress.set(userId, {
        indexed: 0,
        total: 0,
        done: true,
        error: err.message,
      });
    } finally {
      if (engine.isTemporary()) {
        await engine.cleanup(userId);
      }
    }
  });
}


app.get("/index-status", requireAuth, (req: any, res) => {
  const userId = req.userId;
  const state = indexProgress.get(userId);

  if (!state) {
    return res.json({ indexed: 0, total: 0, done: true });
  }

  res.json(state);
});


app.get("/ingest-status", requireAuth, (req: any, res) => {
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
app.get("/tabs", requireAuth, async (req: any, res) => {
  const userId = req.userId;

  const limit = parseInt(req.query.limit || "5");
  const offset = parseInt(req.query.offset || "0");

  const key = resolveApiKey(req.query.apiKey as string | undefined);

  await runExclusive(userId, async () => {
    const engine = await getFaissEngine(userId);
    try {
      await engine.init(key, userId);

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
    } catch (err: any) {
      console.error("❌ Get tabs error:", err);
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      if (engine.isTemporary()) {
        await engine.cleanup(userId);
      }
    }
  });
});


// ------------------ Delete Tab ------------------
app.delete("/tabs", requireAuth, async (req: any, res) => {
  const { url, apiKey } = req.body;
  const userId = req.userId;

  if (!url) {
    return res.status(400).json({ ok: false, error: "Missing url" });
  }

  const key = resolveApiKey(apiKey);

  await runExclusive(userId, async () => {
    const engine = await getFaissEngine(userId);
    try {
      await engine.deleteByUrl(userId, key, url);
      await engine.deleteTab(userId, url);
      await engine.deleteUrl(userId, url);
      await engine.syncStorage(userId);

      res.json({ ok: true, message: "Tab deleted successfully." });
    } catch (err: any) {
      console.error("Delete tab error:", err);
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      if (engine.isTemporary()) {
        await engine.cleanup(userId);
      }
    }
  });
});

// ------------------ Chat ------------------
app.post("/chat", requireAuth, async (req: any, res) => {
  const { question, apiKey, url } = req.body;
  const userId = req.userId;

  if (!question?.trim()) {
    return res.status(400).json({ answer: "Question required." });
  }

  const key = resolveApiKey(apiKey);

  await runExclusive(userId, async () => {
    let topResults: any[] = [];
    const engine = await getFaissEngine(userId);
    try {
      topResults = await engine.search(question, key, userId, 10, url);

      if (!topResults.length) {
        return res.json({
          answer:
            "I couldn't find any indexed content for this page. Please collect this page first.",
        });
      }

      const MAX_CHUNK_SIZE = 1200;
      const context = topResults
        .map((r) => (r.text || "").slice(0, MAX_CHUNK_SIZE))
        .join("\n\n");

      const MAX_CONTEXT_SIZE = 6000;
      const safeContext =
        context.length > MAX_CONTEXT_SIZE
          ? context.slice(0, MAX_CONTEXT_SIZE)
          : context;

      const chatLLM = new ChatOpenAI({ key, temperature: 0 });

      const response = await chatLLM.invoke([
        {
          role: "system",
          content:
            ` You are a helpful assistant. Answer questions using ONLY the provided context.
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
    } catch (err: any) {
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
    } finally {
      if (engine.isTemporary()) {
        await engine.cleanup(userId);
      }
    }
  });
});


// ------------------ Search ------------------
app.post("/search", requireAuth, async (req: any, res) => {
  const { q, apiKey } = req.body;
  const userId = req.userId;
  if (!q?.trim()) return res.status(400).json({ ok: false, error: "Query required" });
  const key = resolveApiKey(apiKey);

  await runExclusive(userId, async () => {
    const engine = await getFaissEngine(userId);
    try {
      const results = await engine.search(q, key, userId, 5);

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
    } catch (err: any) {
      console.error("❌ Search error:", err);
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      if (engine.isTemporary()) {
        await engine.cleanup(userId);
      }
    }
  });
});

app.post(
  "/storage/config",
  requireAuth,
  async (req: any, res) => {

    const userId = req.userId;

    const {
      type,
      host,
      username,
      password,
      remote_path
    } = req.body;

    try {

      await saveUserStorage(
        userId,
        type,
        host || null,
        username || null,
        password || null,
        remote_path || null
      );
      faissEngines.delete(userId);

      res.json({
        ok: true
      });

    } catch (err: any) {

      res.status(500).json({
        ok: false,
        error: err.message
      });

    }

  }
);

// ------------------ Start ------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));