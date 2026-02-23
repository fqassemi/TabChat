// server.ts
import "dotenv/config";
import fetch from "node-fetch";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { similaritySearchLocal } from "./vectorstores/cosineUtils.ts";
import type { IVectorStore } from "./IVectorStore.ts";
import { SupabaseVectorStoreImpl } from "./vectorstores/SupabaseVectorStoreImpl.ts";
import { LocalDBVectorStoreImpl } from "./vectorstores/LocalDBVectorStoreImpl.ts";
import { SQLiteVectorStoreImpl } from "./vectorstores/SQLiteVectorStoreImpl.ts";

const app = express();

// ------------------ ENV ------------------
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_DB_URL = process.env.LOCAL_DB_URL;

// ------------------ Global State ------------------
let vectorStore: IVectorStore | null = null;
let currentDBMode: "supabase" | "local" | "sqlite" | null = null;
let isDbConfigured = false;

// ------------------ Database Initialization ------------------
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  console.log("🟢 Using Supabase as default database");
  vectorStore = new SupabaseVectorStoreImpl(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  currentDBMode = "supabase";
  isDbConfigured = true;
} else if (LOCAL_DB_URL) {
  console.log("🟠 Using Local Postgres as default database");
  vectorStore = new LocalDBVectorStoreImpl(LOCAL_DB_URL);
  currentDBMode = "local";
  isDbConfigured = true;
} else {
  console.log("🟣 No database configured yet — waiting for user configuration");
  currentDBMode = null;
  isDbConfigured = false;
}

if (vectorStore) {
  await vectorStore.init();
}

// ------------------ Middleware ------------------
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));

// ------------------ Ingest ------------------
app.post("/ingest", async (req, res) => {
  const { docs, apiKey } = req.body;

  // 1️⃣ Check database
  if (!isDbConfigured || !vectorStore) {
    return res.status(400).json({
      ok: false,
      count: 0,
      error: "❌ No database configured. Please select one (Supabase or Local Postgres) first.",
    });
  }

  // 2️⃣ Check OpenAI API key
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return res.status(400).json({
      ok: false,
      count: 0,
      error: "❌ Missing or invalid OpenAI API key",
    });
  }

  // 3️⃣ Validate input
  if (!Array.isArray(docs) || !docs.length) {
    return res.status(400).json({
      ok: false,
      count: 0,
      error: "❌ Invalid or empty docs array.",
    });
  }

  const embedder = new OpenAIEmbeddings({ apiKey });

  try {
    // Remove duplicates by URL
    const existingDocs = await vectorStore.getAllDocuments();
    const existingUrls = new Set(
      existingDocs.map((d: any) => d.metadata?.url).filter(Boolean)
    );

    const uniqueDocs = docs.filter((d) => !existingUrls.has(d.url));

    // If no new tabs
    if (uniqueDocs.length === 0) {
      console.log("⚠️ All tabs already exist, skipping ingest.");
      return res.json({
        ok: true,
        count: 0,
        countTabs: 0,
        countChunks: 0,
        message: "⚠️ All tabs have already been saved, no action needed.",
      });
    }

    const allDocsToSave: { text: string; metadata: any; embedding?: number[] }[] = [];
    let countTabs = 0;

    // Process new tabs
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

        if (!markdown) {
          console.log("🚫 No markdown returned from Firecrawl:", doc.url);
          continue;
        }

        // Split content into paragraphs without breaking them
        const chunks: string[] = [];
        const maxLen = 5000;
        let buffer = "";
        const paragraphs = markdown.split(/\n{2,}/);

        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;

          if ((buffer + "\n\n" + trimmed).length > maxLen) {
            if (buffer.trim().length > 50) chunks.push(buffer.trim());
            buffer = trimmed;
          } else {
            buffer += (buffer ? "\n\n" : "") + trimmed;
          }
        }

        if (buffer.trim().length > 50) chunks.push(buffer.trim());
        if (!chunks.length) continue;

        countTabs++; // ✅ New tab saved

        console.log(`📄 ${doc.url}: Split into ${chunks.length} structured chunks`);

        // Generate embeddings for each chunk
        const embeddings = await embedder.embedDocuments(chunks);

        chunks.forEach((chunk, i) => {
          allDocsToSave.push({
            text: chunk,
            metadata: { title: doc.title, url: doc.url, part: i + 1 },
            embedding: embeddings[i],
          });
        });
      } catch (err) {
        console.error(`❌ Firecrawl error for ${doc.url}:`, err);
      }
    }

    // No valid content found
    if (!allDocsToSave.length) {
      return res.status(400).json({
        ok: false,
        count: 0,
        message: "❌ No valid content retrieved from pages.",
      });
    }

    // Save to database
    await vectorStore.addDocuments(allDocsToSave, apiKey);
    console.log(
      `💾 Saved ${allDocsToSave.length} markdown sections from ${countTabs} new tabs.`
    );

    res.json({
      ok: true,
      count: countTabs,
      countTabs,
      countChunks: allDocsToSave.length,
      message: `✅ Saved ${allDocsToSave.length} sections from ${countTabs} new tabs.`,
    });
  } catch (err: any) {
    console.error("❌ Ingest error:", err);
    res.status(500).json({
      ok: false,
      count: 0,
      error: err.message || "Server error while ingesting.",
    });
  }
});

// ------------------ Chat ------------------
app.post("/chat", async (req, res) => {
  const { question, apiKey } = req.body;

  if (!question?.trim()) return res.status(400).json({ answer: "Question required." });
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return res.status(400).json({ answer: "Missing or invalid OpenAI API key" });
  }

  if (!isDbConfigured || !vectorStore) {
    return res.status(400).json({
      ok: false,
      error: "❌ No database configured. Please configure one first.",
    });
  }

  try {
    const embedder = new OpenAIEmbeddings({ apiKey });
    const chatLLM = new ChatOpenAI({ apiKey, temperature: 0 });

    const queryEmbedding = await embedder.embedQuery(question);
    const docs = await vectorStore.getAllDocuments();
    const results = similaritySearchLocal(queryEmbedding, docs, 5);

    const context = results.map((r) => r.text).join("\n\n");
    const fullPrompt = `
      Answer based on the following context:
      ${context}

      Question: ${question}
    `;

    const response = await chatLLM.generate([
      [
        { role: "system", content: "You are a multilingual assistant." },
        { role: "user", content: fullPrompt },
      ],
    ]);

    res.json({ answer: response.generations[0][0].text.trim() });
  } catch (err: any) {
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
    } else if (localDbUrl) {
      console.log("🟠 Switching to Local Postgres...");
      vectorStore = new LocalDBVectorStoreImpl(localDbUrl);
      currentDBMode = "local";
    } else if (sqlitePath) {
      console.log("🟣 Switching to SQLite...");
      vectorStore = new SQLiteVectorStoreImpl(sqlitePath);
      currentDBMode = "sqlite";
    } else {
      throw new Error("No valid configuration provided");
    }

    await vectorStore.init();
    isDbConfigured = true;
    res.json({ ok: true, mode: currentDBMode });
  } catch (err: any) {
    console.error("❌ Config switch failed:", err);
    res.json({ ok: false, error: err.message });
  }
});

// ------------------ Search ------------------
app.post("/search", async (req, res) => {
  const { q, apiKey } = req.body;

  if (!q?.trim()) return res.status(400).json({ ok: false, error: "Query required" });
  if (!apiKey || !apiKey.startsWith("sk-"))
    return res.status(400).json({ ok: false, error: "Missing or invalid OpenAI API key" });

  if (!isDbConfigured || !vectorStore) {
    return res.status(400).json({
      ok: false,
      error: "❌ No database configured. Please select one in settings first.",
    });
  }

  try {
    const embedder = new OpenAIEmbeddings({ apiKey });
    const queryEmbedding = await embedder.embedQuery(q);

    const docs = await vectorStore.getAllDocuments();
    if (!docs.length)
      return res.status(404).json({ ok: false, error: "No documents indexed yet." });

    const results = similaritySearchLocal(queryEmbedding, docs, 5);

    res.json({
      ok: true,
      results: results.map((r) => ({
        content: r.text,
        metadata: r.metadata,
        score: r.score,
      })),
    });
  } catch (err: any) {
    console.error("❌ Search error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));