import "dotenv/config";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

let vectorStore: FaissStore | null = null;
let embeddings: OpenAIEmbeddings | null = null;

// ------------------ Initialize vector store ------------------
export async function initVectorStore() {
  embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-large",
  });

  vectorStore = new FaissStore(embeddings, {});
  console.log("🧠 FAISS Vector Store initialized");
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

  console.log(`✅ Added ${docs.length} docs (${totalChunks} chunks) to vector store`);
}

// ------------------ Semantic search ------------------
export async function searchSimilar(query: string, k = 5) {
  if (!vectorStore || !embeddings) throw new Error("Vector store not initialized");

  const results = await vectorStore.similaritySearch(query, k);

  return results.map((r) => ({
    title: r.metadata?.title,
    url: r.metadata?.url,
    text: r.pageContent, // 🔹 حالا محتوای واقعی برگردونده میشه
  }));
}
