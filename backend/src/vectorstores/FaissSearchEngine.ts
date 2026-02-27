import fs from "fs";
import path from "path";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";

export class FaissSearchEngine {
  private filePath: string;
  private store: FaissStore | null = null;
  private embedder: OpenAIEmbeddings | null = null;

  constructor(filePath = "./data/faiss.index") {
    this.filePath = filePath;
  }

  // 📥 مقداردهی اولیه FAISS
  async init(apiKey: string) {
    this.embedder = new OpenAIEmbeddings({ apiKey });
    const dir = path.dirname(this.filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log("📁 Created data directory for FAISS index.");
    }

    if (fs.existsSync(this.filePath)) {
      try {
        console.log("📂 Loading FAISS index...");
        this.store = await FaissStore.load(this.filePath, this.embedder);
        console.log("✅ FAISS index loaded successfully.");
      } catch (err) {
        console.warn("⚠️ Failed to load FAISS index, reinitializing...");
        this.store = await FaissStore.fromTexts(["init"], [{ meta: "init" }], this.embedder);
        await this.store.save(this.filePath);
      }
    } else {
      console.log("🆕 Creating new FAISS index...");
      this.store = await FaissStore.fromTexts(["init"], [{ meta: "init" }], this.embedder);
      await this.store.save(this.filePath);
    }
  }

  // 📤 سینک داده‌ها از Supabase (با متادیتا)
  async syncFromDocuments(
    docs: { text: string; metadata: any; embedding?: number[] }[],
    apiKey: string
  ) {
    if (!docs?.length) {
      console.warn("⚠️ No documents provided for FAISS sync.");
      return;
    }

    if (!this.embedder) this.embedder = new OpenAIEmbeddings({ apiKey });
    if (!this.store) await this.init(apiKey);

    const texts = docs.map((d) => d.text);
    const metadatas = docs.map((d) => ({
      title: d.metadata?.title || d.title || "Untitled",
      url: d.metadata?.url || "",
      part: d.metadata?.part || 1,
    }));

    try {
      // 🚀 ایجاد ایندکس جدید با متادیتا
      const newStore = await FaissStore.fromTexts(texts, metadatas, this.embedder);

      // 🔁 ادغام با ایندکس قبلی
      if (this.store) {
        this.store.mergeFrom(newStore);
      } else {
        this.store = newStore;
      }

      await this.store.save(this.filePath);
      console.log(`✅ Synced ${docs.length} docs into FAISS index (with metadata).`);
    } catch (err) {
      console.error("❌ Failed to sync FAISS index:", err);
    }
  }

  // 🔍 جستجو در FAISS
  async search(query: string, apiKey: string, k = 5) {
    if (!this.store) await this.init(apiKey);

    try {
      const results = await this.store!.similaritySearch(query, k);


      if (!results.length) {
        console.warn("⚠️ No results found in FAISS index.");
        return [];
      }

      // 🔧 نرمال‌سازی متادیتا
      const normalizeMeta = (r: any) => {
        const meta =
          r.metadata ||
          r.doc?.metadata ||
          r.doc?.pageContent?.metadata ||
          {};
        return {
          title: meta.title || "Untitled",
          url: meta.url || "",
          part: meta.part || 1,
        };
      };

      return results
        .filter((r) => r.pageContent !== "init" && r.metadata?.meta !== "init")
        .map((r) => ({
          text: r.pageContent,
          metadata: normalizeMeta(r),
          score: r.score || 0,
        }));
    } catch (err) {
      console.error("❌ FAISS search failed:", err);
      return [];
    }
  }
}