import { OpenAIEmbeddings } from "@langchain/openai";
import { Client } from "pg";
export class LocalDBVectorStoreImpl {
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.client = new Client({ connectionString });
        this.embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY });
    }
    async init() {
        console.log("🟠 Using custom local database...");
        await this.client.connect();
        await this.client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        metadata JSONB,
        embedding FLOAT8[]
      );
    `);
    }
    async addDocuments(docs, apiKey) {
        if (!apiKey)
            throw new Error("Missing OpenAI API key in addDocuments");
        const embedder = new OpenAIEmbeddings({ apiKey });
        for (const d of docs) {
            const embedding = await embedder.embedQuery(d.text);
            await this.client.query(`INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2, $3)`, [d.text, d.metadata, embedding]);
        }
        console.log(`✅ Added ${docs.length} docs to local DB`);
    }
    async getAllDocuments() {
        const res = await this.client.query("SELECT * FROM documents");
        return res.rows.map((r) => ({
            text: r.content,
            metadata: r.metadata,
            embedding: r.embedding,
        }));
    }
}
//# sourceMappingURL=LocalDBVectorStoreImpl.js.map