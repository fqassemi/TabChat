import fs from "fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { IVectorStore } from "./IVectorStore.ts";
import { OpenAIEmbeddings } from "@langchain/openai";

export class SQLiteVectorStoreImpl implements IVectorStore {
  private db: any;
  private embedder = new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY });
  private dbPath: string;

  constructor(dbPath: string) {
    if (!dbPath) throw new Error("SQLite path is required");
    this.dbPath = dbPath;

    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async init() {
    console.log(`🟣 Using SQLite at: ${this.dbPath}`);
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        metadata JSON,
        embedding JSON
      );
    `);
  }

  async addDocuments(docs: { text: string; metadata: any }[], apiKey: string) {
  if (!apiKey) throw new Error("Missing OpenAI API key in addDocuments");
  const embedder = new OpenAIEmbeddings({ apiKey });

  for (const d of docs) {
    const embedding = await embedder.embedQuery(d.text);
    await this.db.run(
      `INSERT INTO documents (content, metadata, embedding) VALUES (?, ?, ?)`,
      d.text,
      JSON.stringify(d.metadata),
      JSON.stringify(embedding)
    );
  }
  console.log(`✅ Added ${docs.length} docs to SQLite`);
}

  async getAllDocuments() {
    const rows = await this.db.all("SELECT * FROM documents");
    return rows.map((r: any) => ({
      text: r.content,
      metadata: JSON.parse(r.metadata),
      embedding: JSON.parse(r.embedding),
    }));
  }
}
