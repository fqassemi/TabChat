import fs from "fs";
import path from "path";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";




export class FaissSearchEngine {
    constructor(basePath = "./data/faiss", storage) {
        this.stores = new Map();
        this.embedder = null;
        this.initPromises = new Map();
        this.basePath = basePath;
        this.storage = storage;
    }
    async getUserPath(userId) {
        if (this.storage) {
            return await this.storage.getLocalPath(userId);
        }
        return path.join(this.basePath, userId);
    }
    async init(config, userId) {
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!this.embedder) {
            this.embedder = new OpenAIEmbeddings({
                apiKey: config.apiKey,
                model: config.model,
                configuration: config.baseURL ? { baseURL: config.baseURL } : undefined,
            });
        }
        const isTemp = this.storage?.isTemporary?.() ?? false;
        if (!isTemp && this.stores.has(userId)) {
            return;
        }
        // اگه یک init دیگه همین الان برای همین userId در حال اجراست،
        // به‌جای شروع دوباره‌ی دانلود، فقط منتظر همون بمون
        const existing = this.initPromises.get(userId);
        if (existing) {
            return existing;
        }
        const run = this._doInit(userId, isTemp);
        this.initPromises.set(userId, run);
        try {
            await run;
        }
        finally {
            this.initPromises.delete(userId);
        }
    }
    async _doInit(userId, isTemp) {
        if (isTemp && this.stores.has(userId)) {
            this.stores.delete(userId);
        }
        await this.storage?.beforeLoad(userId);
        const userPath = await this.getUserPath(userId);
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
        try {
            if (fs.existsSync(userPath)) {
                console.log(`📂 Loading FAISS index for user ${userId}`);
                const store = await FaissStore.load(userPath, this.embedder);
                this.stores.set(userId, store);
                console.log(`✅ FAISS index loaded for user ${userId}`);
            }
            else {
                console.log(`🆕 Creating FAISS index for user ${userId}`);
                const store = await FaissStore.fromTexts(["init"], [{ meta: "init" }], this.embedder);
                await store.save(userPath);
                this.stores.set(userId, store);
                console.log(`✅ New FAISS index created for user ${userId}`);
            }
        }
        catch (err) {
            console.error(`❌ Failed loading FAISS for ${userId}`, err);
            const store = await FaissStore.fromTexts(["init"], [{ meta: "init" }], this.embedder);
            await store.save(userPath);
            this.stores.set(userId, store);
        }
    }
    async syncFromDocuments(docs, config, userId) {
        if (!docs?.length) {
            console.warn("⚠️ No documents provided for FAISS sync.");
            return;
        }
        await this.init(config, userId);
        const store = this.stores.get(userId);
        if (!store) {
            throw new Error(`FAISS store not initialized for user ${userId}`);
        }
        const texts = docs.map((d) => d.text);
        const metadatas = docs.map((d) => ({
            userId,
            type: "document",
            title: d.metadata?.title || "Untitled",
            url: d.metadata?.url || "",
            part: d.metadata?.part || 1,
        }));

        try {
            const newStore = await FaissStore.fromTexts(texts, metadatas, this.embedder);
            store.mergeFrom(newStore);
            await store.save(await this.getUserPath(userId));
            await this.storage?.afterSave(userId);
            console.log(`✅ Synced ${docs.length} chunks into FAISS for user ${userId}`);
        }
        catch (err) {
            console.error("❌ Failed to sync FAISS index:", err);
        }
    }
    async getMetadataPath(userId) {
        const base = await this.storage?.getLocalPath(userId)
            ?? path.join(this.basePath, userId);
        return path.join(path.dirname(base), `${userId}-metadata.json`);
    }
    async getExistingUrls(userId) {
        const file = await this.getMetadataPath(userId);
        if (!fs.existsSync(file)) {
            return new Set();
        }
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        return new Set(json.urls || []);
    }
    async saveUrls(userId, urls) {
        const file = await this.getMetadataPath(userId);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const existing = await this.getExistingUrls(userId);
        urls.forEach((u) => existing.add(u));
        fs.writeFileSync(file, JSON.stringify({
            urls: [...existing],
        }, null, 2));
    }
    async getTabsPath(userId) {
        const base = await this.storage?.getLocalPath(userId)
            ?? path.join(this.basePath, userId);
        return path.join(path.dirname(base), `${userId}-tabs.json`);
    }
    async saveTabs(userId, tabs) {
        const file = await this.getTabsPath(userId);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        let existing = [];
        if (fs.existsSync(file)) {
            existing = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        const map = new Map(existing.map((t) => [t.url, t]));
        for (const tab of tabs) {
            map.set(tab.url, tab);
        }
        fs.writeFileSync(file, JSON.stringify([...map.values()], null, 2));
    }
    async deleteTab(userId, url) {
        const file = await this.getTabsPath(userId);
        if (!fs.existsSync(file))
            return;
        const tabs = JSON.parse(fs.readFileSync(file, "utf8"));
        const filtered = tabs.filter((t) => this.normalizeUrl(t.url) !== this.normalizeUrl(url));
        fs.writeFileSync(file, JSON.stringify(filtered, null, 2));
    }
    async deleteUrl(userId, url) {
        const file = await this.getMetadataPath(userId);
        if (!fs.existsSync(file))
            return;
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        json.urls = (json.urls || []).filter((u) => this.normalizeUrl(u) !== this.normalizeUrl(url));
        fs.writeFileSync(file, JSON.stringify(json, null, 2));
    }
    async getTabs(userId) {
        const file = await this.getTabsPath(userId);
        if (!fs.existsSync(file)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    async deleteByUrl(userId, config, url) {
        await this.init(config, userId);
        const store = this.stores.get(userId);
        if (!store) {
            throw new Error("Store not initialized");
        }
        const docstore = store.getDocstore();
        const target = this.normalizeUrl(url);
        const ids = [];
        for (const [id, doc] of docstore._docs.entries()) {
            if (
                doc.metadata?.type !== "pin" &&
                this.normalizeUrl(doc.metadata?.url) === target
            ) {
                ids.push(id);
            }
        }
        console.log(`Deleting ${ids.length} vectors`);
        if (ids.length === 0)
            return;
        await store.delete({ ids });
        await store.save(await this.getUserPath(userId));
        await this.storage?.afterSave(userId);
    }
    normalizeUrl(input) {
        if (!input)
            return "";
        return input
            .split("?")[0]
            .replace(/\/$/, "")
            .replace(/^https?:\/\/(www\.)?/, "")
            .toLowerCase();
    }
    async search(query, config, userId, k = 5, url) {
        await this.init(config, userId);
        const store = this.stores.get(userId);
        if (!store) {
            throw new Error(`FAISS store not found for user ${userId}`);
        }
        try {
            const results = await store.similaritySearchWithScore(query, k * 5);
            if (!results.length) {
                console.warn(`⚠️ No FAISS results for user ${userId}`);
                return [];
            }
            let docs = results
                .filter(([doc]) => doc.pageContent !== "init" &&
                    doc.metadata?.meta !== "init")
                .map(([doc, score]) => ({
                    text: doc.pageContent,
                    metadata: {
                        userId: doc.metadata?.userId,
                        type: doc.metadata?.type || "document",
                        pinId: doc.metadata?.pinId,
                        title: doc.metadata?.title || "Untitled",
                        url: doc.metadata?.url || "",
                        part: doc.metadata?.part || 1,
                        tabId: doc.metadata?.tabId,
                        timestamp: doc.metadata?.timestamp,
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
        }
        catch (err) {
            console.error("❌ FAISS search failed:", err);
            return [];
        }
    }
    async syncStorage(userId) {
        await this.storage?.afterSave(userId);
    }
    isTemporary() {
        return this.storage?.isTemporary?.() ?? false;
    }
    async cleanup(userId) {
        this.stores.delete(userId);
        await this.storage?.cleanup(userId);
    }
    async getPendingPath(userId) {
        const base = await this.storage?.getLocalPath(userId)
            ?? path.join(this.basePath, userId);
        return path.join(path.dirname(base), `${userId}-pending.json`);
    }
    async savePendingChunks(userId, chunks) {
        const file = await this.getPendingPath(userId);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        let existing = [];
        if (fs.existsSync(file)) {
            existing = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        fs.writeFileSync(file, JSON.stringify(existing.concat(chunks)));
    }
    async getPendingChunks(userId) {
        const file = await this.getPendingPath(userId);
        if (!fs.existsSync(file))
            return [];
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    async clearPendingChunks(userId) {
        const file = await this.getPendingPath(userId);
        if (fs.existsSync(file))
            fs.unlinkSync(file);
    }
    async prepareStorage(userId) {
        await this.storage?.beforeLoad(userId);
    }

    async getPinsPath(userId) {
        const base =
            await this.storage?.getLocalPath(userId)
            ?? path.join(this.basePath, userId);

        return path.join(
            path.dirname(base),
            `${userId}-pins.json`
        );
    }

    async getPins(userId) {
        const file = await this.getPinsPath(userId);

        if (!fs.existsSync(file)) {
            return [];
        }

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    }

    async savePin(userId, pin) {
        const file = await this.getPinsPath(userId);
        const dir = path.dirname(file);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const pins = await this.getPins(userId);

        pins.push(pin);

        fs.writeFileSync(
            file,
            JSON.stringify(pins, null, 2)
        );
    }

    async deletePin(userId, pinId) {
        const file = await this.getPinsPath(userId);

        if (!fs.existsSync(file)) {
            return;
        }

        const pins = await this.getPins(userId);

        const filtered = pins.filter(
            (pin) => pin.id !== pinId
        );

        fs.writeFileSync(
            file,
            JSON.stringify(filtered, null, 2)
        );
    }
    async addPinToIndex(userId, config, pin) {
        await this.init(config, userId);

        const store = this.stores.get(userId);

        if (!store) {
            throw new Error(
                `FAISS store not initialized for user ${userId}`
            );
        }

        const metadata = {
            userId,
            type: "pin",
            pinId: pin.id,
            title: pin.title,
            url: pin.url,
            tabId: pin.tabId,
            timestamp: pin.timestamp,
        };

        const newStore = await FaissStore.fromTexts(
            [pin.text],
            [metadata],
            this.embedder
        );

        store.mergeFrom(newStore);

        await store.save(
            await this.getUserPath(userId)
        );

        await this.storage?.afterSave(userId);
    }



}
//# sourceMappingURL=FaissSearchEngine.js.map