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
    private getMetadataPath(userId: string) {
      return path.join(this.basePath, `${userId}-metadata.json`);
    }

    async getExistingUrls(userId: string): Promise<Set<string>> {
      const file = this.getMetadataPath(userId);

      if (!fs.existsSync(file)) {
        return new Set();
      }

      const json = JSON.parse(fs.readFileSync(file, "utf8"));

      return new Set(json.urls || []);
    }

    async saveUrls(userId: string, urls: string[]) {
      const file = this.getMetadataPath(userId);

      const existing = await this.getExistingUrls(userId);

      urls.forEach((u) => existing.add(u));

      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            urls: [...existing],
          },
          null,
          2
        )
      );
    }

    private getTabsPath(userId: string) {
      return path.join(this.basePath, `${userId}-tabs.json`);
    }

    async saveTabs(
      userId: string,
      tabs: {
        title: string;
        url: string;
      }[]
    ) {
      const file = this.getTabsPath(userId);

      let existing: {
        title: string;
        url: string;
      }[] = [];

      if (fs.existsSync(file)) {
        existing = JSON.parse(fs.readFileSync(file, "utf8"));
      }

      const map = new Map(
        existing.map((t) => [t.url, t])
      );

      for (const tab of tabs) {
        map.set(tab.url, tab);
      }

      fs.writeFileSync(
        file,
        JSON.stringify(
          [...map.values()],
          null,
          2
        )
      );
    }

    async deleteTab(userId: string, url: string) {
        const file = this.getTabsPath(userId);

        if (!fs.existsSync(file)) return;

        const tabs = JSON.parse(fs.readFileSync(file, "utf8"));

        const filtered = tabs.filter(
            (t: any) => this.normalizeUrl(t.url) !== this.normalizeUrl(url)
        );

        fs.writeFileSync(file, JSON.stringify(filtered, null, 2));
    }


    async deleteUrl(userId: string, url: string) {
        const file = this.getMetadataPath(userId);

        if (!fs.existsSync(file)) return;

        const json = JSON.parse(fs.readFileSync(file, "utf8"));

        json.urls = (json.urls || []).filter(
            (u: string) => this.normalizeUrl(u) !== this.normalizeUrl(url)
        );

        fs.writeFileSync(file, JSON.stringify(json, null, 2));
    }

    async getTabs(userId: string) {
      const file = this.getTabsPath(userId);

      if (!fs.existsSync(file)) {
        return [];
      }

      return JSON.parse(
        fs.readFileSync(file, "utf8")
      );
    }

    async deleteByUrl(
      userId: string,
      apiKey: string,
      url: string
    ) {
      await this.init(apiKey, userId);

      const store = this.stores.get(userId);

      if (!store) {
        throw new Error("Store not initialized");
      }

      const docstore = store.getDocstore();

      const target = this.normalizeUrl(url);

      const ids: string[] = [];

      for (const [id, doc] of docstore._docs.entries()) {
        if (this.normalizeUrl(doc.metadata?.url) === target) {
          ids.push(id);
        }
      }

      console.log(`Deleting ${ids.length} vectors`);

      if (ids.length === 0) return;

      await store.delete({ ids });

      await store.save(this.getUserPath(userId));
    }

    private normalizeUrl(input?: string) {
      if (!input) return "";

      return input
        .split("?")[0]
        .replace(/\/$/, "")
        .replace(/^https?:\/\/(www\.)?/, "")
        .toLowerCase();
    }

  async search(
    query: string,
    apiKey: string,
    userId: string,
    k = 5,
    url?: string
  ) {
    await this.init(apiKey, userId);

    const store = this.stores.get(userId);

    if (!store) {
      throw new Error(
        `FAISS store not found for user ${userId}`
      );
    }

    try {
      const results = await store.similaritySearchWithScore(
        query,
        k * 5
      );

      if (!results.length) {
          console.warn(`⚠️ No FAISS results for user ${userId}`);
          return [];
      }

      let docs = results
        .filter(
            ([doc]) =>
            doc.pageContent !== "init" &&
            doc.metadata?.meta !== "init"
        )
        .map(([doc, score]) => ({
            text: doc.pageContent,
            metadata: {
                userId: doc.metadata?.userId,
                title: doc.metadata?.title || "Untitled",
                url: doc.metadata?.url || "",
                part: doc.metadata?.part || 1,
            },
            score,
        }));

      // Optional URL filter
      if (url) {
        const target = this.normalizeUrl(url);

        docs = docs.filter((d) => {
            return this.normalizeUrl(d.metadata.url) === target;
        });
      }

      return docs;

    } catch (err) {
      console.error(
        "❌ FAISS search failed:",
        err
      );
      return [];
    }
  }
}