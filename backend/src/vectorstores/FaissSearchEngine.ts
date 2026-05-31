import fs from "fs";
import path from "path";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";

export class FaissSearchEngine {
  private basePath: string;
  private stores: Map<string, FaissStore> = new Map();
  private embedder: OpenAIEmbeddings | null = null;

  constructor(basePath = "./data/faiss") {
    this.basePath = basePath;
  }

  private getUserPath(userId: string): string {
    return path.join(this.basePath, userId);
  }

  async init(apiKey: string, userId: string) {
    if (!userId) {
      throw new Error("userId is required");
    }

    if (!this.embedder) {
      this.embedder = new OpenAIEmbeddings({ apiKey });
    }

    if (this.stores.has(userId)) {
      return;
    }

    const userPath = this.getUserPath(userId);

    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }

    try {
      if (fs.existsSync(userPath)) {
        console.log(`📂 Loading FAISS index for user ${userId}`);

        const store = await FaissStore.load(
          userPath,
          this.embedder
        );

        this.stores.set(userId, store);

        console.log(
          `✅ FAISS index loaded for user ${userId}`
        );
      } else {
        console.log(
          `🆕 Creating FAISS index for user ${userId}`
        );

        const store = await FaissStore.fromTexts(
          ["init"],
          [{ meta: "init" }],
          this.embedder
        );

        await store.save(userPath);

        this.stores.set(userId, store);

        console.log(
          `✅ New FAISS index created for user ${userId}`
        );
      }
    } catch (err) {
      console.error(
        `❌ Failed loading FAISS for ${userId}`,
        err
      );

      const store = await FaissStore.fromTexts(
        ["init"],
        [{ meta: "init" }],
        this.embedder
      );

      await store.save(userPath);

      this.stores.set(userId, store);
    }
  }

  async syncFromDocuments(
    docs: {
      text: string;
      metadata: any;
      embedding?: number[];
    }[],
    apiKey: string,
    userId: string
  ) {
    if (!docs?.length) {
      console.warn(
        "⚠️ No documents provided for FAISS sync."
      );
      return;
    }

    await this.init(apiKey, userId);

    const store = this.stores.get(userId);

    if (!store) {
      throw new Error(
        `FAISS store not initialized for user ${userId}`
      );
    }

    const texts = docs.map((d) => d.text);

    const metadatas = docs.map((d) => ({
      userId,
      title: d.metadata?.title || "Untitled",
      url: d.metadata?.url || "",
      part: d.metadata?.part || 1,
    }));

    try {
      const newStore = await FaissStore.fromTexts(
        texts,
        metadatas,
        this.embedder!
      );

      store.mergeFrom(newStore);

      await store.save(
        this.getUserPath(userId)
      );

      console.log(
        `✅ Synced ${docs.length} chunks into FAISS for user ${userId}`
      );
    } catch (err) {
      console.error(
        "❌ Failed to sync FAISS index:",
        err
      );
    }
  }

  async search(
    query: string,
    apiKey: string,
    userId: string,
    k = 5
  ) {
    await this.init(apiKey, userId);

    const store = this.stores.get(userId);

    if (!store) {
      throw new Error(
        `FAISS store not found for user ${userId}`
      );
    }

    try {
      const results = await store.similaritySearch(
        query,
        k
      );

      if (!results.length) {
        console.warn(
          `⚠️ No FAISS results for user ${userId}`
        );
        return [];
      }

      return results
        .filter(
          (r) =>
            r.pageContent !== "init" &&
            r.metadata?.meta !== "init"
        )
        .map((r) => ({
          text: r.pageContent,
          metadata: {
            userId: r.metadata?.userId,
            title:
              r.metadata?.title || "Untitled",
            url:
              r.metadata?.url || "",
            part:
              r.metadata?.part || 1,
          },
          score: 0,
        }));
    } catch (err) {
      console.error(
        "❌ FAISS search failed:",
        err
      );
      return [];
    }
  }
}