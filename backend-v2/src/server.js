import express from "express";
import http from "node:http";
import { Server } from "socket.io";
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
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { onboardingRouter } from "./routes/onboarding.routes.js";
import { modulesRouter } from "./routes/modules.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { saasRouter } from "./routes/saas.routes.js";
import { requireModule, tenantContext } from "./middleware/tenant-access.js";
import { MODULES } from "./lib/modules.js";
import { basicRateLimit } from "./middleware/rate-limit.js";
import { apiErrorHandler, requestContext } from "./middleware/request-context.js";
import { runAutonomousSalesFollowUps } from "./services/autonomous-sales-followup.service.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(requestContext);
app.use(basicRateLimit({ windowMs: 60_000, max: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 300) }));
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", env.frontendOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      service: "onmicanal-backend-v2",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
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
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true, timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, db: false, timestamp: new Date().toISOString() });
  }
});

app.get("/", (_req, res) => {
  res.send("Backend v2 funcionando");
});

app.use("/meta", metaRouter);
app.use("/api", authRouter);
app.use("/api", workspaceUsersRouter); // demo login helper

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
app.use("/api", ...protectedApi, adminRouter);
app.use("/api", ...protectedApi, saasRouter);
app.use("/api", ...protectedApi, requireModule(MODULES.BOT_LAB), devRouter);
app.use("/api", ...protectedApi, onboardingRouter);
app.use("/api", ...protectedApi, conversationsRouter); // Inbox: auth + tenant, sin bloqueo por módulo para evitar 403 en tenants configurados
app.use("/api", ...protectedApi, messagesRouter); // Mensajes manuales del inbox: auth + tenant
app.use("/api", ...protectedApi, leadsRouter); // Lead panel universal usado desde Inbox
app.use("/api", ...protectedApi, requireModule(MODULES.SALES), productRoutes);
app.use("/api", ...protectedApi, requireModule(MODULES.MARKETING), campaignsRouter);
app.use("/api", ...protectedApi, requireModule(MODULES.BOOKINGS), servicesRouter);
app.use("/api", ...protectedApi, requireModule(MODULES.BOOKINGS), bookingsRouter);
app.use("/api", ...protectedApi, requireModule(MODULES.ANALYTICS), dashboardRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use(apiErrorHandler);


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: env.frontendOrigin,
    methods: ["GET", "POST"]
  }
});

setIo(io);

if (env.enableAutomation) {
  setInterval(() => {
    runAutomationCycle().catch((error) => console.error("Automation error:", error));
  }, 60_000);

  setInterval(() => {
    runAutonomousSalesFollowUps({ dryRun: false, limit: 100 })
      .catch((error) => console.error("Autonomous sales follow-up error:", error));
  }, 15 * 60_000);
}

io.on("connection", (socket) => {
  socket.on("join:tenant", (tenantId) => {
    if (!tenantId) return;
    socket.join(`tenant:${tenantId}`);
  });

  socket.on("leave:tenant", (tenantId) => {
    if (!tenantId) return;
    socket.leave(`tenant:${tenantId}`);
  });

  socket.on("join:conversation", (conversationId) => {
    if (!conversationId) return;
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

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
