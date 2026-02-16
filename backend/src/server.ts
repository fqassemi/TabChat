import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { initDb, insertDocs } from "./db.ts";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { initVectorStore, addDocsToVectorStore, searchSimilar } from "./vectorStore.ts";

const app = express();

// ------------------ LLM و Embeddings ------------------
const embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY });
const chatLLM = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY, temperature: 0 });

// Middleware
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "50mb" }));

// Init DB & Vector Store
initDb();
await initVectorStore();

// ------------------ Ingest ------------------
app.post("/ingest", async (req, res) => {
  const docs = req.body.docs;
  if (!Array.isArray(docs)) return res.status(400).json({ error: "invalid" });

  try {
    const inserted = insertDocs(docs);
    await addDocsToVectorStore(docs);
    res.json({ ok: true, inserted });
  } catch (err: any) {
    console.error("❌ Error adding docs:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------ Search ------------------
app.get("/search", async (req, res) => {
  const q = req.query.q as string;
  if (!q?.trim()) return res.status(400).json({ error: "query required" });

  try {
    const results = await searchSimilar(q, 5);
    res.json({ ok: true, results });
  } catch (err: any) {
    console.error("❌ Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------ Chat (RAG) ------------------
async function combineAnswers(results: { text: string }[], question: string) {
  if (!results.length) return "No relevant content found.";

  const context = results
    .map((r, i) => `Context ${i + 1}:\n${r.text}`)
    .join("\n\n");

  const prompt = `
Use the following context to answer the question.

${context}

Question: ${question}

If the question is in English, answer in English.
If the question is in Persian, answer in Persian.
If the question is in another language, answer in that language.
Be clear and natural.
`;

  const response = await chatLLM.generate([
    [
      {
        role: "system",
        content:
          "You are a helpful multilingual assistant. Detect the user's question language and respond in that same language.",
      },
      { role: "user", content: prompt },
    ],
  ]);

  return response.generations[0][0].text.trim();
}


app.post("/chat", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ answer: "Question required." });

  try {
    const results = await searchSimilar(question, 5);
    const answer = await combineAnswers(results, question);
    res.json({ answer });
  } catch (err: any) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ answer: "Server error." });
  }
});

// ------------------ Start Server ------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
