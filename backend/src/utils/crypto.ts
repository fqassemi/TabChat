import crypto from "crypto";

const KEY = Buffer.from(
  process.env.STORAGE_SECRET!,
  "hex"
);

const ALGORITHM = "aes-256-gcm";

export function encrypt(text: string): string {

  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    KEY,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decrypt(text: string): string {

  const [ivHex, tagHex, encryptedHex] =
    text.split(":");

  const decipher =
    crypto.createDecipheriv(
      ALGORITHM,
      KEY,
      Buffer.from(ivHex, "hex")
    );

  decipher.setAuthTag(
    Buffer.from(tagHex, "hex")
  );

  const decrypted = Buffer.concat([
    decipher.update(
      Buffer.from(encryptedHex, "hex")
    ),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}