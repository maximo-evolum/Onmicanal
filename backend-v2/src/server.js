import express from "express";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./lib/env.js";
import { prisma } from "./lib/db.js";
import { setIo } from "./lib/socket.js";
import { authMiddleware } from "./lib/auth.js";
import { metaRouter } from "./routes/meta.routes.js";
import { conversationsRouter } from "./routes/conversations.routes.js";
import { messagesRouter } from "./routes/messages.routes.js";
import { workspaceUsersRouter } from "./routes/workspace-users.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { devRouter } from "./routes/dev.routes.js";
import { leadsRouter } from "./routes/leads.routes.js";
import { runAutomationCycle } from "./services/automation.service.js";
import { campaignsRouter } from "./routes/campaigns.routes.js";
import productRoutes from "./routes/product.routes.js";
import { servicesRouter } from "./routes/services.routes.js";
import { bookingsRouter } from "./routes/bookings.routes.js";
import { paymentsRouter } from "./routes/payments.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { financeRouter } from "./routes/finance.routes.js";
import { onboardingRouter } from "./routes/onboarding.routes.js";
import { modulesRouter } from "./routes/modules.routes.js";
import { industriesRouter } from "./routes/industries.routes.js";
import { industryRecordsRouter } from "./routes/industry-records.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { workflowsRouter } from "./routes/workflows.routes.js";
import { integrationsRouter } from "./routes/integrations.routes.js";
import { connectionsPublicRouter, connectionsRouter } from "./routes/connections.routes.js";
import { metadataRouter } from "./routes/metadata.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { searchRouter } from "./routes/search.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { backupsRouter } from "./routes/backups.routes.js";
import { architectureRouter } from "./routes/architecture.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { saasRouter } from "./routes/saas.routes.js";
import { requireModule, tenantContext } from "./middleware/tenant-access.js";
import { MODULES } from "./lib/modules.js";
import { basicRateLimit } from "./middleware/rate-limit.js";
import { apiErrorHandler, requestContext } from "./middleware/request-context.js";
import { runAutonomousSalesFollowUps } from "./services/autonomous-sales-followup.service.js";
import { observeRequest, prometheusMetrics, runtimeMetrics } from "./lib/runtime-metrics.js";
import { operationsRouter } from "./routes/operations.routes.js";
import { getRedisClient } from "./lib/redis.js";
import { realtyIntelligenceRouter } from "./routes/realty-intelligence.routes.js";
import { runPlatformJobs } from "./services/platform-jobs.service.js";
import { mobileReleasesRouter } from "./routes/mobile-releases.routes.js";

const app = express();
app.disable("x-powered-by");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const campaignAssetsDir = path.resolve(__dirname, "../public/campaign-assets");

// Los routers se montan bajo /api y cada uno declara sus rutas completas
// (por ejemplo, /finance/overview). Aplicar requireModule directamente en un
// app.use("/api", ...) lo ejecutaba para *todas* las rutas posteriores: una
// solicitud a Finance OS quedaba bloqueada por el control inmobiliario
// `properties`. Este adaptador conserva la proteccion, pero solo cuando la
// solicitud realmente pertenece al prefijo del modulo correspondiente.
function requireModuleForPaths(module, paths) {
  const guard = requireModule(module);
  const prefixes = Array.isArray(paths) ? paths : [paths];
  return (req, res, next) => {
    const pathname = String(req.path || "");
    const applies = prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return applies ? guard(req, res, next) : next();
  };
}

function validMetricsToken(req) {
  const expected = String(env.metricsToken || "");
  if (!expected) return false;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const received = String(req.headers["x-metrics-token"] || bearer || "");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buffer) => {
    // Meta signs the original request bytes, not the parsed JSON object.
    if (req.originalUrl?.split("?")[0] === "/meta/webhook") {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
app.use(requestContext);
app.use(observeRequest);
app.use(basicRateLimit({
  windowMs: 60_000,
  max: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 300),
  keyPrefix: "api"
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (env.nodeEnv === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

function resolveCorsOrigin(origin) {
  const allowed = env.corsOrigins || [];
  if (!origin) return env.frontendOrigin;
  if (allowed.includes("*")) return origin;
  if (allowed.includes(origin)) return origin;
  return env.frontendOrigin;
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", resolveCorsOrigin(req.headers.origin));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Client");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (!req.path.startsWith("/campaign-assets/") && !/\/api\/documents\/[^/]+\/download$/.test(req.path)) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  next();
});

app.use("/campaign-assets", express.static(campaignAssetsDir, {
  immutable: true,
  maxAge: "30d"
}));

async function readinessStatus() {
  let database = false;
  let redis = "not_configured";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  if (process.env.REDIS_URL) {
    try {
      redis = (await getRedisClient()) ? "connected" : "unavailable";
    } catch {
      redis = "unavailable";
    }
  }
  return { ok: database, database, redis, timestamp: new Date().toISOString() };
}

app.get("/health/live", (_req, res) => {
  res.json({ ok: true, service: "onmicanal-backend-v2", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get("/health/ready", async (_req, res) => {
  const status = await readinessStatus();
  res.status(status.ok ? 200 : 503).json(status);
});

app.get("/health", async (_req, res) => {
  try {
    const status = await readinessStatus();
    if (!status.ok) throw new Error("Database health check failed");
    res.json({
      ...status,
      service: "onmicanal-backend-v2",
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: "Database health check failed",
      timestamp: new Date().toISOString()
    });
  }
});

app.get("/api/health", async (_req, res) => {
  const status = await readinessStatus();
  res.status(status.ok ? 200 : 503).json({ ok: status.ok, db: status.database, redis: status.redis, timestamp: status.timestamp, metrics: runtimeMetrics() });
});

// Endpoint de scrape sin información de clientes. Debe protegerse mediante la
// red privada o allowlist del proveedor de observabilidad si se publica.
app.get("/metrics", async (req, res) => {
  if (!env.metricsToken) return res.status(404).json({ error: "Ruta no encontrada" });
  if (!validMetricsToken(req)) return res.status(401).json({ error: "No autorizado" });
  const status = await readinessStatus();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(status.database ? 200 : 503).send(prometheusMetrics({ database: status.database, redis: status.redis }));
});

app.get("/", (_req, res) => {
  res.send("Backend v2 funcionando");
});

app.use("/meta", metaRouter);
app.use("/api", authRouter);
app.use("/api", connectionsPublicRouter);
app.use("/api", mobileReleasesRouter);
if (env.enableDevTools) {
  app.use("/api", workspaceUsersRouter); // helper local/demo, deshabilitado en producción por defecto
}

const protectedApi = [authMiddleware, tenantContext];

app.get("/api/debug/session", ...protectedApi, async (req, res) => {
  res.json({
    ok: true,
    fixVersion: "permissions-inbox-2026-05-31",
    user: req.user,
    tenantId: req.tenantId,
    tenant: req.tenant
      ? {
          id: req.tenant.id,
          slug: req.tenant.slug,
          name: req.tenant.name,
          plan: req.tenant.plan
        }
      : null
  });
});

app.use("/api", ...protectedApi, modulesRouter);
app.use("/api", ...protectedApi, metadataRouter);
app.use("/api", ...protectedApi, auditRouter);
app.use("/api", ...protectedApi, searchRouter);
app.use("/api", ...protectedApi, notificationsRouter);
app.use("/api", ...protectedApi, backupsRouter);
app.use("/api", ...protectedApi, architectureRouter);
app.use("/api", ...protectedApi, operationsRouter);
app.use("/api", ...protectedApi, industriesRouter);
app.use("/api", ...protectedApi, industryRecordsRouter);
app.use("/api", ...protectedApi, adminRouter);
app.use("/api", ...protectedApi, saasRouter);
if (env.enableDevTools) {
  // El permiso de Bot Lab se aplica dentro de sus rutas. Colocarlo en este
  // montaje global bloqueaba por accidente todos los endpoints posteriores
  // (conexiones, campañas, agenda, etc.) para tenants sin bot_lab.
  app.use("/api", ...protectedApi, devRouter);
}
app.use("/api", ...protectedApi, onboardingRouter);
app.use("/api", ...protectedApi, conversationsRouter); // Inbox: auth + tenant, sin bloqueo por módulo para evitar 403 en tenants configurados
app.use("/api", ...protectedApi, messagesRouter); // Mensajes manuales del inbox: auth + tenant
app.use("/api", ...protectedApi, leadsRouter); // Lead panel universal usado desde Inbox
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.PROPERTIES, "/realty"), realtyIntelligenceRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.SALES, "/products"), productRoutes);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.DOCUMENTS, "/documents"), documentsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.WORKFLOWS, "/workflows"), workflowsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.INTEGRATIONS, "/integrations"), integrationsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.INTEGRATIONS, "/connections"), connectionsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.MARKETING, "/campaigns"), campaignsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.BOOKINGS, "/services"), servicesRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.BOOKINGS, "/bookings"), bookingsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.SALES, "/payments"), paymentsRouter);
app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.ANALYTICS, ["/dashboard", "/sales/queue"]), dashboardRouter);
// El PDF ejecutivo forma parte del Dashboard: usa la misma autorización y no
// existe como módulo independiente.
  app.use("/api", ...protectedApi, requireModuleForPaths(MODULES.ANALYTICS, "/reports"), reportsRouter);
  // Finance OS valida sus capacidades por operacion: no todas las cuentas de
  // finanzas necesariamente contratan conciliacion, cobranza y analitica a la vez.
  app.use("/api", ...protectedApi, financeRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use(apiErrorHandler);


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowed = env.corsOrigins || [];
      if (!origin || allowed.includes("*") || allowed.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

setIo(io);

function getSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return authToken;

  const cookieHeader = socket.handshake.headers?.cookie || "";
  const match = String(cookieHeader).match(new RegExp(`(?:^|;\\s*)${env.sessionCookieName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function authenticateSocket(socket, next) {
  try {
    const token = getSocketToken(socket);
    if (!token) return next(new Error("socket_unauthorized"));

    const decoded = jwt.verify(token, env.jwtSecret);
    const user = await prisma.workspaceUser.findFirst({
      where: { id: decoded.userId, isActive: true },
      include: { tenant: true }
    });

    if (!user || !user.tenant) return next(new Error("socket_unauthorized"));

    socket.user = {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email
    };
    return next();
  } catch {
    return next(new Error("socket_unauthorized"));
  }
}

function canAccessTenant(socket, tenantId) {
  return socket.user?.role === "SUPER_ADMIN" || socket.user?.tenantId === tenantId;
}

io.use(authenticateSocket);

if (env.enableAutomation) {
  setInterval(() => {
    runAutomationCycle().catch((error) => console.error("Automation error:", error));
  }, 60_000);

  setInterval(() => {
    runAutonomousSalesFollowUps({ dryRun: false, limit: 100 })
      .catch((error) => console.error("Autonomous sales follow-up error:", error));
  }, 15 * 60_000);

  const executePlatformJobs = () => runPlatformJobs().catch((error) => console.error("Platform jobs error:", error));
  executePlatformJobs();
  setInterval(executePlatformJobs, 60_000);
}

io.on("connection", (socket) => {
  socket.on("join:tenant", async (tenantId) => {
    if (!tenantId || !canAccessTenant(socket, tenantId)) return;
    socket.join(`tenant:${tenantId}`);
  });

  socket.on("leave:tenant", (tenantId) => {
    if (!tenantId) return;
    socket.leave(`tenant:${tenantId}`);
  });

  socket.on("join:conversation", async (conversationId) => {
    if (!conversationId) return;
    const where = { id: conversationId };
    if (socket.user?.role !== "SUPER_ADMIN") where.tenantId = socket.user?.tenantId;
    const conversation = await prisma.conversation.findFirst({ where, select: { id: true } }).catch(() => null);
    if (!conversation) return;
    socket.join(`conversation:${conversationId}`);
  });

  socket.on("leave:conversation", (conversationId) => {
    if (!conversationId) return;
    socket.leave(`conversation:${conversationId}`);
  });
});

async function bootstrap() {
  await prisma.$connect();

  server.listen(env.port, "0.0.0.0", () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${env.port}`);
    console.log(`Webhook GET/POST: http://0.0.0.0:${env.port}/meta/webhook`);
    console.log("FIX_VERSION admin-router-scoped-2026-06-01");
    console.log("FIX_VERSION inbox-send-route-2026-06-03");
  });
}

bootstrap().catch((error) => {
  console.error("Bootstrap error:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error(JSON.stringify({ event: "process.unhandled_rejection", message: error?.message, stack: env.nodeEnv === "production" ? undefined : error?.stack }));
});

process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ event: "process.uncaught_exception", message: error?.message, stack: env.nodeEnv === "production" ? undefined : error?.stack }));
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
