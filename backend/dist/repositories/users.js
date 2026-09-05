import { pool } from "../db.ts";
export async function getUserByEmail(email) {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    return result.rows[0];
}
export async function createUser(id, email, full_name, picture) {
    await pool.query(`
    INSERT INTO users(id,email,full_name,picture)
    VALUES($1,$2,$3,$4)
`, [id, email, full_name, picture]);
}
//# sourceMappingURL=users.js.map