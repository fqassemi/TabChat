import "dotenv/config";
import fs from "fs";
import path from "path";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const DATA_PATH = path.resolve("./data/faiss.index");

let vectorStore: FaissStore | null = null;
let embeddings: OpenAIEmbeddings | null = null;

// ------------------ Initialize vector store ------------------
export async function initVectorStore() {
  embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-large",
  });

  if (fs.existsSync(DATA_PATH)) {
    console.log("📂 Loading existing FAISS index...");
    vectorStore = await FaissStore.load(DATA_PATH, embeddings);
  } else {
    console.log("🧠 Creating new FAISS index...");
    vectorStore = new FaissStore(embeddings, {});
  }

  console.log("✅ FAISS Vector Store ready");
  return vectorStore;
}

// ------------------ Add documents with chunking ------------------
export async function addDocsToVectorStore(
  docs: { id?: string; title: string; url: string; text: string }[]
) {
  if (!vectorStore || !embeddings) throw new Error("Vector store not initialized");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 200,
  });

  let totalChunks = 0;

  for (const doc of docs) {
    const text = doc.text?.trim();
    if (!text || text.length < 200) continue;

    const chunks = await splitter.splitText(text);
    totalChunks += chunks.length;

    const documents = chunks.map(
      (chunk) =>
        new Document({
          pageContent: chunk,
          metadata: {
            title: doc.title,
            url: doc.url,
          },
        })
    );

    await vectorStore.addDocuments(documents);
  }

  // 🔹 ذخیره روی دیسک
  await vectorStore.save(DATA_PATH);

  console.log(`💾 Saved FAISS index to ${DATA_PATH} (${docs.length} docs, ${totalChunks} chunks)`);
}

// ------------------ Semantic search ------------------
export async function searchSimilar(query: string, k = 5) {
  if (!vectorStore || !embeddings) throw new Error("Vector store not initialized");

  const results = await vectorStore.similaritySearch(query, k);

  return results.map((r) => ({
    title: r.metadata?.title,
    url: r.metadata?.url,
    text: r.pageContent, // محتوای واقعی هر چانک برگردانده میشه
  }));
}
