import { pool } from "../db.ts";


export async function getUserStorage(userId: string) {
    const result = await pool.query(
        `
        SELECT *
        FROM user_storage
        WHERE user_id=$1
        `,
        [userId]
    );

    if (!result.rows.length) {
        return {
            type: "local"
        };
    }

    return result.rows[0];
}


export async function saveUserStorage(
  userId: string,
  type: string,
  host: string | null,
  username: string | null,
  password: string | null,
  remotePath: string | null
) {
  await pool.query(
    `
    INSERT INTO user_storage
    (
      user_id,
      type,
      host,
      username,
      password,
      remote_path
    )
    VALUES ($1,$2,$3,$4,$5,$6)

    ON CONFLICT (user_id)

    DO UPDATE SET

      type=$2,
      host=$3,
      username=$4,
      password=$5,
      remote_path=$6
    `,
    [
      userId,
      type,
      host,
      username,
      password,
      remotePath
    ]
  );
}