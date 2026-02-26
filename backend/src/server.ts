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
import { MoorchehClient } from "./moorchehClient.ts";
import { v4 as uuidv4 } from "uuid";
import { URL } from "url";

const app = express();

// ------------------ ENV ------------------
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_DB_URL = process.env.LOCAL_DB_URL;
const DEFAULT_MOORCHEH_API_KEY = process.env.DEFAULT_MOORCHEH_API_KEY || "";
const DEFAULT_MOORCHEH_NAMESPACE = process.env.DEFAULT_MOORCHEH_NAMESPACE || "default-namespace";

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

if (vectorStore) await vectorStore.init();

// ------------------ Middleware ------------------
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));

// ------------------ Helpers ------------------
function getMoorchehClientFromKey(moorchehKey?: string) {
  const apiKey =
    moorchehKey && moorchehKey.startsWith("moor-")
      ? moorchehKey
      : DEFAULT_MOORCHEH_API_KEY;
  if (!apiKey) return null;
  return new MoorchehClient(apiKey);
}

async function ensureNamespace(client: MoorchehClient | null, namespace: string) {
  if (!client) return;
  try {
    await client.createNamespace(namespace, "text");
  } catch (err) {
    console.warn("⚠️ Could not create/check namespace:", err);
  }
}

// ------------------ Ingest ------------------
app.post("/ingest", async (req, res) => {
  const { docs, apiKey, moorchehKey } = req.body;

  if (!isDbConfigured || !vectorStore) {
    return res.status(400).json({ ok: false, count: 0, error: "❌ No database configured." });
  }
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return res.status(400).json({ ok: false, count: 0, error: "❌ Missing or invalid OpenAI API key" });
  }
  if (!Array.isArray(docs) || !docs.length) {
    return res.status(400).json({ ok: false, count: 0, error: "❌ Invalid or empty docs array." });
  }

  const embedder = new OpenAIEmbeddings({ apiKey });

  try {
    const existingDocs = await vectorStore.getAllDocuments();
    const existingUrls = new Set(existingDocs.map((d: any) => d.metadata?.url).filter(Boolean));
    const uniqueDocs = docs.filter((d) => !existingUrls.has(d.url));

    if (!uniqueDocs.length) {
      return res.json({ ok: true, count: 0, countTabs: 0, countChunks: 0, message: "⚠️ All tabs already exist." });
    }

    const allDocsToSave: { text: string; metadata: any; embedding?: number[] }[] = [];
    let countTabs = 0;

    for (const doc of uniqueDocs) {
      try {
        const payload = { url: doc.url, formats: ["markdown"], excludeTags: ["nav","footer","header","script","style"], blockAds: true, waitFor: 2000 };
        const response = await fetch(FIRECRAWL_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        const markdown = (data?.data?.markdown || "").trim();
        if (!markdown) continue;

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
          } else buffer += (buffer ? "\n\n" : "") + trimmed;
        }
        if (buffer.trim().length > 50) chunks.push(buffer.trim());
        if (!chunks.length) continue;

        countTabs++;
        console.log(`📄 ${doc.url}: Split into ${chunks.length} chunks`);

        const embeddings = await embedder.embedDocuments(chunks);
        chunks.forEach((chunk, i) => {
          allDocsToSave.push({
            text: chunk,
            metadata: { title: doc.title, url: doc.url, part: i+1, moorNamespace: `tabchat-${new URL(doc.url).hostname.replace(/\./g, "-")}` },
            embedding: embeddings[i],
          });
        });

      } catch (err) {
        console.error(`❌ Firecrawl error for ${doc.url}:`, err);
      }
    }

    if (!allDocsToSave.length) {
      return res.status(400).json({ ok: false, count: 0, message: "❌ No valid content retrieved." });
    }

    await vectorStore.addDocuments(allDocsToSave, apiKey);
    console.log(`💾 Saved ${allDocsToSave.length} sections from ${countTabs} new tabs.`);

    const moor = getMoorchehClientFromKey(moorchehKey);
    if (moor) {
      try {
        const grouped: Record<string, any[]> = {};
        for (const d of allDocsToSave) {
          const domain = new URL(d.metadata.url).hostname.replace(/\./g, "-");
          const namespace = `tabchat-${domain}`;
          if (!grouped[namespace]) grouped[namespace] = [];
          grouped[namespace].push(d);
        }
        for (const [namespace, docs] of Object.entries(grouped)) {
          await ensureNamespace(moor, namespace);
          const docsForMoorcheh = docs.map((d) => ({
            id: `${d.metadata.url}::${d.metadata.part}`,
            text: d.text,
            metadata: { url: d.metadata.url, title: d.metadata.title, part: d.metadata.part }
          }));
          const BATCH = 40;
          for (let i = 0; i < docsForMoorcheh.length; i += BATCH) {
            const batch = docsForMoorcheh.slice(i, i + BATCH);
            await moor.uploadTextDocuments(namespace, batch);
            console.log(`⬆️ Uploaded ${batch.length} docs to Moorcheh (${namespace})`);
            // اضافه کردن لاگ ID ها و عنوان ها
            batch.forEach(d => {
            console.log(`   • ID: ${d.id} | Title: ${d.metadata.title}`);
            });
          }
        }
      } catch (err) { console.warn("⚠️ Moorcheh upload failed:", err); }
    }

    res.json({ ok: true, count: countTabs, countTabs, countChunks: allDocsToSave.length, message: `✅ Saved ${allDocsToSave.length} sections.` });
  } catch (err: any) {
    console.error("❌ Ingest error:", err);
    res.status(500).json({ ok: false, count: 0, error: err.message || "Server error." });
  }
});

// ------------------ Chat ------------------
app.post("/chat", async (req, res) => {
  const { question, apiKey, moorchehKey, url } = req.body;

  if (!question?.trim()) return res.status(400).json({ ok: false, answer: "❌ Question required." });
  if (!apiKey?.startsWith("sk-")) return res.status(400).json({ ok: false, answer: "❌ Invalid OpenAI key." });
  if (!url) return res.status(400).json({ ok: false, answer: "❌ Missing URL." });

  try {
    const chatLLM = new ChatOpenAI({ apiKey, temperature: 0 });
    let contextDocs: any[] = [];
    let source = "local";

    const moor = getMoorchehClientFromKey(moorchehKey);
    let namespace = DEFAULT_MOORCHEH_NAMESPACE;
    try { namespace = `tabchat-${new URL(url).hostname.replace(/\./g, "-")}`; } catch {}

    if (moor) {
      try {
        const namespaces = [namespace];
        const resp = await moor.search(namespaces, question, { top_k: 20 });
        const moorResults = (resp.data?.results || [])
          .filter((r: any) => r.metadata?.url?.startsWith(url.split("#")[0]))
          .slice(0,5)
          .map((r: any) => ({ content: r.text, metadata: r.metadata, score: r.score }));

        if (moorResults.length) {
          source = "moorcheh";
          contextDocs = moorResults;
        }
      } catch (err) { console.warn("⚠️ Moorcheh search failed:", err); }
    }

    if (!contextDocs.length) {
      if (!vectorStore) return res.status(500).json({ ok: false, answer: "No local DB configured." });
      const embedder = new OpenAIEmbeddings({ apiKey });
      const qEmbed = await embedder.embedQuery(question);
      const docs = (await vectorStore.getAllDocuments()).filter((d: any) => d.metadata?.url === url);
      const localResults = similaritySearchLocal(qEmbed, docs, 5);
      contextDocs = localResults.map((r) => ({ content: r.text, metadata: r.metadata }));
    }

    const contextText = contextDocs.map(d => d.content).join("\n\n---\n\n");
    const fullPrompt = `
Use ONLY the following CONTEXT to answer the question.
If the answer is not in context, reply:
"I don't have that information in the provided context."

CONTEXT:
"""
${contextText || "No relevant context found."}
"""

QUESTION:
${question}`;

    const response = await chatLLM.generate([
      [
        { role: "system", content: "Answer strictly from the context only." },
        { role: "user", content: fullPrompt },
      ],
    ]);

    const answer = response.generations?.[0]?.[0]?.text?.trim() || "I don't have that information.";
    res.json({ ok: true, source, answer, results: contextDocs });
  } catch (err: any) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ ok: false, answer: "Server error.", error: err.message });
  }
});

// ------------------ Config ------------------
app.post("/config", async (req, res) => {
  const { supabaseUrl, supabaseKey, localDbUrl, sqlitePath } = req.body;
  try {
    if (supabaseUrl && supabaseKey) { vectorStore = new SupabaseVectorStoreImpl(supabaseUrl, supabaseKey); currentDBMode = "supabase"; }
    else if (localDbUrl) { vectorStore = new LocalDBVectorStoreImpl(localDbUrl); currentDBMode = "local"; }
    else if (sqlitePath) { vectorStore = new SQLiteVectorStoreImpl(sqlitePath); currentDBMode = "sqlite"; }
    else throw new Error("Invalid config");

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
  const { q, apiKey, moorchehKey } = req.body;

  if (!q?.trim()) return res.status(400).json({ ok: false, error: "Query required." });
  if (!apiKey?.startsWith("sk-")) return res.status(400).json({ ok: false, error: "Invalid OpenAI key." });

  try {
    const moor = getMoorchehClientFromKey(moorchehKey);

    // ======= Try Moorcheh first =======
    if (moor) {
      try {
        const namespacesRaw = await moor.listNamespaces();
        const allNamespaces: string[] = Array.isArray(namespacesRaw)
          ? namespacesRaw.map(ns => typeof ns === "string" ? ns : ns.namespace_name).filter(Boolean)
          : [];

        if (allNamespaces.length > 0) {
          const resp = await moor.search(allNamespaces, q, { top_k: 20 });
          const moorResults = (resp.data?.results || [])
  .map((r: any) => {
    // بررسی لایه اضافی metadata
    const meta = r.metadata?.metadata || r.metadata || {};
    const urlSafe = meta.url || "";
    let titleSafe = meta.title || "";
    if (!titleSafe && urlSafe) {
      try { titleSafe = new URL(urlSafe).hostname; } catch {}
    }
    const header = `${titleSafe}\n${urlSafe}`;
    return {
      content: `${header}\n\n${r.text}`,
      metadata: {
        url: urlSafe,
        title: titleSafe,
        part: meta.part,
      },
      score: r.score
    };
  })
  .slice(0, 10);

          if (moorResults.length > 0) {
            return res.json({ ok: true, source: "moorcheh", results: moorResults });
          }
        }
      } catch (err: any) {
        console.warn("⚠️ Moorcheh search failed, falling back to local:", err.message);
      }
    }

    // ======= Fallback Local =======
    if (!vectorStore) return res.status(500).json({ ok: false, error: "No database configured for local search." });

    const embedder = new OpenAIEmbeddings({ apiKey });
    const qEmbed = await embedder.embedQuery(q);
    const allDocs = await vectorStore.getAllDocuments();
    const localResults = similaritySearchLocal(qEmbed, allDocs, 10);

    const formattedResults = localResults.map((r) => {
      const urlSafe = r.metadata?.url || "";
      let titleSafe = r.metadata?.title || "";
      if (!titleSafe && urlSafe) {
        try { titleSafe = new URL(urlSafe).hostname; } catch {}
      }
      const header = `${titleSafe}\n${urlSafe}`;
      return {
        content: `${header}\n\n${r.text}`,
        metadata: {
          url: urlSafe,
          title: titleSafe,
          part: r.metadata?.part,
        },
      };
    });

    res.json({ ok: true, source: "local", results: formattedResults });
  } catch (err: any) {
    console.error("❌ Search error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));