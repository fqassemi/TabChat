import type { IVectorStore } from "./IVectorStore.ts";
import { createClient } from "@supabase/supabase-js";
import { OpenAIEmbeddings } from "@langchain/openai";

export class SupabaseVectorStoreImpl implements IVectorStore {
  private client: any;
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  async init() {
    console.log("🟢 Using Supabase as main database...");
    this.client = createClient(this.url, this.key);
  }

  // 👈 apiKey رو به عنوان پارامتر اضافه کنید
  async addDocuments(docs: { text: string; metadata: any }[], apiKey: string) {
    if (!apiKey) throw new Error("Missing OpenAI API key in addDocuments");

    // 👈 embedder اینجا ساخته میشه با apiKey واقعی
    const embedder = new OpenAIEmbeddings({ apiKey });

    for (const d of docs) {
      const embedding = await embedder.embedQuery(d.text);
      await this.client.from("documents").insert({
        content: d.text,
        metadata: d.metadata,
        embedding,
      });
    }
    console.log(`✅ Added ${docs.length} docs to Supabase`);
  }

  async getAllDocuments() {
    const { data, error } = await this.client.from("documents").select("*");
    if (error) throw error;

    return data.map((row: any) => ({
      text: row.content,
      metadata: row.metadata,
      embedding: row.embedding,
    }));
  }
}