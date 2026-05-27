import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./db.js";

export function signAuthToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role
    },
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const token = auth.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    const user = await prisma.workspaceUser.findFirst({
      where: {
        id: decoded.userId,
        isActive: true
      },
      include: {
        tenant: true
      }
    });

    if (!user || !user.tenant) {
      return res.status(401).json({ error: "Usuario o tenant no válido" });
    }

    req.auth = decoded;
    req.user = {
      id: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive
    };
    req.tenant = user.tenant;
    req.tenantId = user.tenantId;

    return next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido" });
  }
}
