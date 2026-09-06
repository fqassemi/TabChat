import fs from "fs";
import path from "path";

import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";

import type { StorageProvider } from "../storage/StorageProvider.ts";

export type EmbeddingConfig = {
  apiKey: string;
  baseURL?: string;
  model?: string;
};

export class FaissSearchEngine {
  private basePath: string;

  private stores: Map<string, FaissStore> = new Map();

  private embedder: OpenAIEmbeddings | null = null;

  private initPromises: Map<string, Promise<void>> = new Map();

  private storage?: StorageProvider;

  constructor(
    basePath = "./data/faiss",
    storage?: StorageProvider
  ) {
    this.basePath = basePath;
    this.storage = storage;
  }

  private async getUserPath(userId: string) {
    if (this.storage) {
      return await this.storage.getLocalPath(userId);
    }

    return path.join(this.basePath, userId);
  }

  async init(
    config: EmbeddingConfig,
    userId: string
  ) {
    if (!userId) {
      throw new Error("userId is required");
    }

    if (!this.embedder) {
      this.embedder = new OpenAIEmbeddings({
        apiKey: config.apiKey,
        model: config.model,
        configuration: config.baseURL
          ? {
              baseURL: config.baseURL,
            }
          : undefined,
      });
    }

    const isTemp =
      this.storage?.isTemporary?.() ?? false;

    if (!isTemp && this.stores.has(userId)) {
      return;
    }

    const existing = this.initPromises.get(userId);

    if (existing) {
      return existing;
    }

    const run = this._doInit(
      userId,
      isTemp
    );

    this.initPromises.set(
      userId,
      run
    );

    try {
      await run;
    } finally {
      this.initPromises.delete(
        userId
      );
    }
  }

  private async _doInit(
    userId: string,
    isTemp: boolean
  ) {
    if (
      isTemp &&
      this.stores.has(userId)
    ) {
      this.stores.delete(userId);
    }

    await this.storage?.beforeLoad(userId);

    const userPath =
      await this.getUserPath(userId);

    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(
        this.basePath,
        {
          recursive: true,
        }
      );
    }

    try {
      if (fs.existsSync(userPath)) {
        console.log(
          `📂 Loading FAISS index for user ${userId}`
        );

        const store =
          await FaissStore.load(
            userPath,
            this.embedder!
          );

        this.stores.set(
          userId,
          store
        );

        console.log(
          `✅ FAISS index loaded for user ${userId}`
        );
      } else {
        console.log(
          `🆕 Creating FAISS index for user ${userId}`
        );

        const store =
          await FaissStore.fromTexts(
            ["init"],
            [
              {
                meta: "init",
              },
            ],
            this.embedder!
          );

        await store.save(
          userPath
        );

        this.stores.set(
          userId,
          store
        );

        console.log(
          `✅ New FAISS index created for user ${userId}`
        );
      }
    } catch (err) {
      console.error(
        `❌ Failed loading FAISS for ${userId}`,
        err
      );

      const store =
        await FaissStore.fromTexts(
          ["init"],
          [
            {
              meta: "init",
            },
          ],
          this.embedder!
        );

      await store.save(
        userPath
      );

      this.stores.set(
        userId,
        store
      );
    }
  }

  async syncFromDocuments(
    docs: {
      text: string;
      metadata: any;
      embedding?: number[];
    }[],
    config: EmbeddingConfig,
    userId: string
  ) {
    if (!docs?.length) {
      console.warn(
        "⚠️ No documents provided for FAISS sync."
      );

      return;
    }

    await this.init(
      config,
      userId
    );

    const store =
      this.stores.get(userId);

    if (!store) {
      throw new Error(
        `FAISS store not initialized for user ${userId}`
      );
    }

    const texts =
      docs.map(
        (d) => d.text
      );

    const metadatas =
      docs.map(
        (d) => ({
          userId,

          title:
            d.metadata?.title ||
            "Untitled",

          url:
            d.metadata?.url ||
            "",

          part:
            d.metadata?.part ||
            1,

          tabId:
            d.metadata?.tabId,

          windowId:
            d.metadata?.windowId,
        })
      );

    try {
      const newStore =
        await FaissStore.fromTexts(
          texts,
          metadatas,
          this.embedder!
        );

      store.mergeFrom(
        newStore
      );

      await store.save(
        await this.getUserPath(
          userId
        )
      );

      await this.storage?.afterSave(
        userId
      );

      console.log(
        `✅ Synced ${docs.length} chunks into FAISS for user ${userId}`
      );
    } catch (err) {
      console.error(
        "❌ Failed to sync FAISS index:",
        err
      );

      throw err;
    }
  }

  private async getMetadataPath(
    userId: string
  ) {
    const base =
      await this.storage?.getLocalPath(
        userId
      ) ??
      path.join(
        this.basePath,
        userId
      );

    return path.join(
      path.dirname(base),
      `${userId}-metadata.json`
    );
  }

  async getExistingUrls(
    userId: string
  ): Promise<Set<string>> {
    const file =
      await this.getMetadataPath(
        userId
      );

    if (!fs.existsSync(file)) {
      return new Set();
    }

    try {
      const json =
        JSON.parse(
          fs.readFileSync(
            file,
            "utf8"
          )
        );

      return new Set(
        (json.urls || [])
          .map(
            (url: string) =>
              this.normalizeUrl(url)
          )
          .filter(Boolean)
      );
    } catch (err) {
      console.error(
        "❌ Failed reading URL metadata:",
        err
      );

      return new Set();
    }
  }

  async saveUrls(
    userId: string,
    urls: string[]
  ) {
    const file =
      await this.getMetadataPath(
        userId
      );

    const dir =
      path.dirname(file);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(
        dir,
        {
          recursive: true,
        }
      );
    }

    const existing =
      await this.getExistingUrls(
        userId
      );

    urls.forEach(
      (url) => {
        const normalized =
          this.normalizeUrl(url);

        if (normalized) {
          existing.add(
            normalized
          );
        }
      }
    );

    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          urls: [
            ...existing,
          ],
        },
        null,
        2
      )
    );
  }

  private async getTabsPath(
    userId: string
  ) {
    const base =
      await this.storage?.getLocalPath(
        userId
      ) ??
      path.join(
        this.basePath,
        userId
      );

    return path.join(
      path.dirname(base),
      `${userId}-tabs.json`
    );
  }

  async saveTabs(
    userId: string,
    tabs: {
      title: string;
      url: string;
      tabId?: number;
      windowId?: number;
    }[]
  ) {
    const file =
      await this.getTabsPath(
        userId
      );

    const dir =
      path.dirname(file);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(
        dir,
        {
          recursive: true,
        }
      );
    }

    let existing: {
      title: string;
      url: string;
      tabId?: number;
      windowId?: number;
    }[] = [];

    if (fs.existsSync(file)) {
      try {
        existing =
          JSON.parse(
            fs.readFileSync(
              file,
              "utf8"
            )
          );
      } catch {
        existing = [];
      }
    }

    const map =
      new Map<
        string,
        {
          title: string;
          url: string;
          tabId?: number;
          windowId?: number;
        }
      >();

    for (const tab of existing) {
      map.set(
        this.normalizeUrl(tab.url),
        tab
      );
    }

    for (const tab of tabs) {
      map.set(
        this.normalizeUrl(tab.url),
        tab
      );
    }

    fs.writeFileSync(
      file,
      JSON.stringify(
        [
          ...map.values(),
        ],
        null,
        2
      )
    );
  }

  async deleteTab(
    userId: string,
    url: string
  ) {
    const file =
      await this.getTabsPath(
        userId
      );

    if (!fs.existsSync(file)) {
      return;
    }

    const tabs =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    const target =
      this.normalizeUrl(url);

    const filtered =
      tabs.filter(
        (tab: any) =>
          this.normalizeUrl(
            tab.url
          ) !== target
      );

    fs.writeFileSync(
      file,
      JSON.stringify(
        filtered,
        null,
        2
      )
    );
  }

  async deleteUrl(
    userId: string,
    url: string
  ) {
    const file =
      await this.getMetadataPath(
        userId
      );

    if (!fs.existsSync(file)) {
      return;
    }

    const json =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    const target =
      this.normalizeUrl(url);

    json.urls =
      (json.urls || [])
        .filter(
          (savedUrl: string) =>
            this.normalizeUrl(
              savedUrl
            ) !== target
        );

    fs.writeFileSync(
      file,
      JSON.stringify(
        json,
        null,
        2
      )
    );
  }

  async getTabs(
    userId: string
  ) {
    const file =
      await this.getTabsPath(
        userId
      );

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );
    } catch {
      return [];
    }
  }

  async deleteByUrl(
    userId: string,
    config: EmbeddingConfig,
    url: string
  ) {
    await this.init(
      config,
      userId
    );

    const store =
      this.stores.get(
        userId
      );

    if (!store) {
      throw new Error(
        "Store not initialized"
      );
    }

    const docstore =
      store.getDocstore();

    const target =
      this.normalizeUrl(url);

    const ids: string[] = [];

    for (
      const [
        id,
        doc,
      ] of docstore._docs.entries()
    ) {
      if (
        this.normalizeUrl(
          doc.metadata?.url
        ) === target
      ) {
        ids.push(id);
      }
    }

    console.log(
      `Deleting ${ids.length} vectors`
    );

    if (ids.length === 0) {
      return;
    }

    await store.delete({
      ids,
    });

    await store.save(
      await this.getUserPath(
        userId
      )
    );

    await this.storage?.afterSave(
      userId
    );
  }

  private normalizeUrl(
    input?: string
  ) {
    if (!input) {
      return "";
    }

    try {
      const parsed =
        new URL(input);

      parsed.hash = "";
      parsed.search = "";

      let hostname =
        parsed.hostname.toLowerCase();

      if (
        hostname.startsWith(
          "www."
        )
      ) {
        hostname =
          hostname.slice(4);
      }

      let pathname =
        parsed.pathname;

      if (
        pathname.length > 1 &&
        pathname.endsWith("/")
      ) {
        pathname =
          pathname.slice(
            0,
            -1
          );
      }

      return (
        hostname +
        pathname
      ).toLowerCase();
    } catch {
      return input
        .split("?")[0]
        .split("#")[0]
        .replace(
          /\/$/,
          ""
        )
        .replace(
          /^https?:\/\/(www\.)?/i,
          ""
        )
        .toLowerCase();
    }
  }

  async search(
    query: string,
    config: EmbeddingConfig,
    userId: string,
    k = 5,
    url?: string,
    windowId?: number
  ) {
    await this.init(
      config,
      userId
    );

    const store =
      this.stores.get(
        userId
      );

    if (!store) {
      throw new Error(
        `FAISS store not found for user ${userId}`
      );
    }

    try {
      const docstore =
        store.getDocstore();

      const totalDocuments =
        Object.keys(
          docstore._docs
        ).length;

      const searchK =
        Math.max(
          Math.min(
            totalDocuments,
            500
          ),
          k * 20,
          100
        );

      console.log(
        "🔎 FAISS SEARCH:",
        {
          userId,
          query,
          url,
          windowId,
          totalDocuments,
          searchK,
        }
      );

      const results =
        await store.similaritySearchWithScore(
          query,
          searchK
        );

      if (!results.length) {
        console.warn(
          `⚠️ No FAISS results for user ${userId}`
        );

        return [];
      }

      let docs =
        results
          .filter(
            ([doc]) =>
              doc.pageContent !==
                "init" &&
              doc.metadata?.meta !==
                "init"
          )
          .map(
            ([doc, score]) => ({
              text:
                doc.pageContent,

              metadata: {
                userId:
                  doc.metadata?.userId,

                title:
                  doc.metadata?.title ||
                  "Untitled",

                url:
                  doc.metadata?.url ||
                  "",

                part:
                  doc.metadata?.part ||
                  1,

                tabId:
                  doc.metadata?.tabId,

                windowId:
                  doc.metadata?.windowId,
              },

              score,
            })
          );

      console.log(
        "📊 FAISS RESULTS BEFORE FILTER:",
        {
          count: docs.length,
          requestedWindowId:
            windowId,
          requestedUrl:
            url,
        }
      );

      /*
       * URL FILTER
       *
       * URL is the strongest scope because
       * chatWidget sends the current page URL.
       */
      if (url) {
        const target =
          this.normalizeUrl(url);

        docs =
          docs.filter(
            (doc) =>
              this.normalizeUrl(
                doc.metadata.url
              ) === target
          );

        console.log(
          "🌐 AFTER URL FILTER:",
          {
            target,
            count: docs.length,
          }
        );
      }

      /*
       * WINDOW FILTER
       *
       * IMPORTANT:
       *
       * Old FAISS documents may not have
       * windowId metadata.
       *
       * If a document has no windowId,
       * we must NOT delete it from the
       * result set.
       *
       * Only filter by windowId when
       * the document actually contains it.
       */
      if (
        windowId !== undefined &&
        docs.some(
          (doc) =>
            doc.metadata.windowId !==
            undefined &&
            doc.metadata.windowId !==
            null
        )
      ) {
        docs =
          docs.filter(
            (doc) => {
              const docWindowId =
                doc.metadata.windowId;

              /*
               * Keep legacy documents
               * without windowId.
               */
              if (
                docWindowId ===
                  undefined ||
                docWindowId === null
              ) {
                return true;
              }

              return (
                Number(
                  docWindowId
                ) ===
                Number(windowId)
              );
            }
          );

        console.log(
          "🪟 AFTER WINDOW FILTER:",
          {
            windowId,
            count: docs.length,
          }
        );
      } else {
        console.log(
          "🪟 WINDOW FILTER SKIPPED:",
          {
            reason:
              "No usable windowId metadata found",
            requestedWindowId:
              windowId,
          }
        );
      }

      const finalDocs =
        docs.slice(
          0,
          k
        );

      console.log(
        "✅ FINAL SEARCH RESULTS:",
        {
          count:
            finalDocs.length,
          windowId,
          url,
        }
      );

      return finalDocs;
    } catch (err) {
      console.error(
        "❌ FAISS search failed:",
        err
      );

      return [];
    }
  }

  async syncStorage(
    userId: string
  ) {
    await this.storage?.afterSave(
      userId
    );
  }

  isTemporary() {
    return (
      this.storage?.isTemporary?.() ??
      false
    );
  }

  async cleanup(
    userId: string
  ) {
    this.stores.delete(
      userId
    );

    await this.storage?.cleanup(
      userId
    );
  }

  private async getPendingPath(
    userId: string
  ) {
    const base =
      await this.storage?.getLocalPath(
        userId
      ) ??
      path.join(
        this.basePath,
        userId
      );

    return path.join(
      path.dirname(base),
      `${userId}-pending.json`
    );
  }

  async savePendingChunks(
    userId: string,
    chunks: {
      text: string;
      metadata: any;
    }[]
  ) {
    const file =
      await this.getPendingPath(
        userId
      );

    const dir =
      path.dirname(file);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(
        dir,
        {
          recursive: true,
        }
      );
    }

    let existing: {
      text: string;
      metadata: any;
    }[] = [];

    if (fs.existsSync(file)) {
      try {
        existing =
          JSON.parse(
            fs.readFileSync(
              file,
              "utf8"
            )
          );
      } catch {
        existing = [];
      }
    }

    fs.writeFileSync(
      file,
      JSON.stringify(
        existing.concat(
          chunks
        )
      )
    );
  }

  async getPendingChunks(
    userId: string
  ) {
    const file =
      await this.getPendingPath(
        userId
      );

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );
    } catch {
      return [];
    }
  }

  async clearPendingChunks(
    userId: string
  ) {
    const file =
      await this.getPendingPath(
        userId
      );

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  async prepareStorage(
    userId: string
  ) {
    await this.storage?.beforeLoad(
      userId
    );
  }
}