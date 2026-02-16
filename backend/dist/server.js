import express from "express";
import bodyParser from "body-parser";
import { initDb, insertDocs } from "./db.ts";
const app = express();
app.use(bodyParser.json());
initDb();
app.post("/ingest", async (req, res) => {
    const docs = req.body.docs;
    if (!Array.isArray(docs))
        return res.status(400).json({ error: "invalid" });
    const inserted = insertDocs(docs); // بازگشت تعداد
    res.json({ ok: true, inserted });
});
app.listen(8000, () => console.log("Server running on :8000"));
//# sourceMappingURL=server.js.map