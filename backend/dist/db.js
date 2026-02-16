import Database from "better-sqlite3";
let db;
export function initDb() {
    db = new Database("tabs.db");
    db.exec(`CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    text TEXT,
    fetched_at TEXT
  )`);
}
export function insertDocs(docs) {
    const insert = db.prepare("INSERT OR REPLACE INTO pages (id,title,url,fetched_at) VALUES (@id,@title,@url,@fetched_at)");
    const now = new Date().toISOString();
    let count = 0;
    const insertTxn = db.transaction((rows) => {
        for (const d of rows) {
            const id = `${Buffer.from(d.url).toString("base64")}`; // ساده؛ یا uuid
            insert.run({ id, title: d.title, url: d.url, fetched_at: now });
            count++;
        }
    });
    insertTxn(docs);
    return count;
}
//# sourceMappingURL=db.js.map