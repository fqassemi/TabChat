import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET!;

export function createToken(userId: string) {
  return jwt.sign(
    {
      userId,
    },
    SECRET,
    {
      expiresIn: "30d",
    }
  );
}

export function verifyToken(token: string) {
  return jwt.verify(token, SECRET);
}