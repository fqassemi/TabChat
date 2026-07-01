import { pool } from "../db.ts";

export async function getUserByEmail(email: string) {
  const result = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  return result.rows[0];
}

export async function createUser(
  id: string,
  email: string,
  full_name: string,
  picture: string
) {
  await pool.query(
    `
    INSERT INTO users(id,email,full_name,picture)
    VALUES($1,$2,$3,$4)
`,
    [id, email, full_name, picture]
  );
}