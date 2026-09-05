import jwt from "jsonwebtoken";
const SECRET = process.env.JWT_SECRET;
export function createToken(userId) {
    return jwt.sign({
        userId,
    }, SECRET, {
        expiresIn: "30d",
    });
}
export function verifyToken(token) {
    return jwt.verify(token, SECRET);
}
//# sourceMappingURL=middleware.js.map