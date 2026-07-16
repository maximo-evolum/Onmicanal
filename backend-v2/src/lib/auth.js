import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { prisma } from "./db.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(req, name) {
  const value = String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  try {
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}

function isAllowedBrowserOrigin(origin) {
  return Boolean(origin) && (env.corsOrigins || []).includes(origin);
}

export function setBrowserSession(res, token) {
  res.cookie(env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: env.sessionCookieSameSite,
    domain: env.sessionCookieDomain || undefined,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearBrowserSession(res) {
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: env.sessionCookieSameSite,
    domain: env.sessionCookieDomain || undefined,
    path: "/"
  });
}

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
  const bearerToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const cookieToken = readCookie(req, env.sessionCookieName);
  const token = bearerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (!bearerToken && UNSAFE_METHODS.has(req.method) && !isAllowedBrowserOrigin(req.headers.origin)) {
    return res.status(403).json({ error: "Origen no autorizado" });
  }

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
