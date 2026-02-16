import "dotenv/config";
import Database from "better-sqlite3";
import { OpenAIEmbeddings } from "@langchain/openai";

const db = new Database("tabs.db");
const embedder = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small", // مدل جدیدتر و کم‌هزینه‌تر
});

// ساخت جدول برای embeddingها
db.exec(`
  CREATE TABLE IF NOT EXISTS page_vectors (
    id TEXT PRIMARY KEY,
    vector TEXT  -- ذخیره به صورت JSON رشته‌ای
  )
`);

export async function generateEmbeddings() {
  const rows = db.prepare("SELECT id, text FROM pages WHERE text IS NOT NULL AND text != ''").all();

  console.log(`📄 Found ${rows.length} pages to embed`);
  let count = 0;

  for (const row of rows) {
    let text = row.text.trim();
    if (!text) continue;

    // ✂️ تقسیم متن به بخش‌های کوچکتر (هر 5000 کاراکتر)
    const chunks = [];
    const chunkSize = 5000;
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    try {
      for (const [index, chunk] of chunks.entries()) {
        const embedding = await embedder.embedQuery(chunk);
        const chunkId = `${row.id}_part${index}`; // ذخیره جداگانه برای هر بخش

        db.prepare("INSERT OR REPLACE INTO page_vectors (id, vector) VALUES (?, ?)").run(
          chunkId,
          JSON.stringify(embedding)
        );

        console.log(`✅ Embedded chunk ${index + 1}/${chunks.length} for ${row.id}`);
      }
      count++;
    } catch (err: any) {
      console.error(`❌ Error embedding ${row.id}:`, err.message);
    }
  }

  console.log(`🎯 Done! Total embedded: ${count}`);
}


export function searchSimilar(queryEmbedding: number[], topK = 5) {
  const rows = db.prepare("SELECT id, title, url, vector FROM page_vectors JOIN pages USING(id)").all();
  const scored = rows.map((r) => {
    const vec = JSON.parse(r.vector);
    const sim = cosineSimilarity(queryEmbedding, vec);
    return { ...r, score: sim };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

function cosineSimilarity(a: number[], b: number[]) {
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));
  const normB = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0));
  return dot / (normA * normB);
}

// ✅ اجرای مستقیم هنگام run
generateEmbeddings();
