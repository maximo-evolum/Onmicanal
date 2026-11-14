/** Archivo: Recorre las vistas principales de EVOLUM OS con una sesión ficticia para detectar regresiones visuales de Modelo A. */
// No consulta ni modifica información productiva: la API se simula dentro del navegador.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendUrl = (process.env.EVOLUM_WEB_URL || "http://localhost:3001").replace(/\/$/, "");
const output = path.resolve(process.env.QA_OUTPUT || "");

if (!output.startsWith(path.resolve("E:/Entregables_EVOLUM_OS") + path.sep)) {
  throw new Error("QA_OUTPUT debe apuntar a una carpeta dentro de E:/Entregables_EVOLUM_OS.");
}

const user = {
  id: "qa-platform-admin",
  tenantId: "qa-platform-tenant",
  name: "Administradora de plataforma",
  email: "plataforma.qa@example.invalid",
  role: "SUPER_ADMIN",
};

const modules = [
  "dashboard", "sales", "agenda", "inbox", "marketing", "ai_ops", "analytics",
  "payments", "saas", "connections", "documents", "customers", "properties",
  "realty_loads", "brokers", "realty_activity", "broker_portal", "realty_clients",
  "finance", "developer", "workflows", "shifts", "patients", "exams",
];

const routes = [
  ["inicio-crm", "/crm-principal"],
  ["dashboard", "/dashboard"],
  ["agenda", "/agenda"],
  ["pipeline", "/pipeline"],
  ["chats", "/inbox"],
  ["operacion-ia", "/ai-ops"],
  ["conexiones", "/connections"],
  ["documentos", "/documents"],
  ["pagos", "/payments"],
  ["operacion-vertical", "/operations/gastronomy"],
  ["broker-operaciones", "/realty?view=operations"],
];

const routeFilter = String(process.env.QA_ROUTE || "").trim();
const selectedRoutes = routeFilter
  ? routes.filter(([name]) => routeFilter.split(",").map((item) => item.trim()).includes(name))
  : routes;

if (!selectedRoutes.length) throw new Error("QA_ROUTE no coincide con una vista conocida.");

const mobileAudit = process.env.QA_MOBILE === "1";
const mobileCriticalRoutes = new Set(["inicio-crm", "dashboard", "chats", "operacion-ia", "conexiones", "broker-operaciones"]);

function crmDashboard() {
  return {
    kpis: { leads: 0, hotLeads: 0, paidCount: 0, conversionRate: 0, bookingsConfirmed: 0, bookingsPending: 0, conversations: 0 },
    revenue: { paidMonth: 0, paid: 0, pending: 0 },
    forecasts: { humanActionsRequired: 0 },
    pipeline: [], alerts: [], upcomingBookings: [],
  };
}

function brokerOverview() {
  return {
    kpis: { properties: 0, activeOperations: 0, scheduledVisits: 0, openAlerts: 0, activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0 },
    properties: [], operations: [], recommendations: [], agents: [],
    reporting: { portfolioValue: 0, projectedCommission: 0, propertyCompleteness: 0, portfolioHealth: 0, propertiesReady: 0, byOperationType: [], aiEvaluations: { total: 0, confirmed: 0, needsAdjustment: 0, pending: 0 } },
    aiTraining: { scenarios: [], evaluations: [], automationRules: [] },
  };
}

function apiBody(endpoint) {
  if (endpoint === "/auth/me") return { user, tenant: { id: user.tenantId, name: "Broker QA", industry: "REAL_ESTATE" }, modules };
  if (endpoint === "/modules/me") return { modules, industry: "REAL_ESTATE", role: user.role };
  if (endpoint === "/broker/access/me") return { businessRole: "CEO", technicalRole: "SUPER_ADMIN", accessScope: "COMPANY", scopeUserIds: [user.id], policy: { actions: { "*": ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE"] } } };
  if (endpoint === "/crm/operational" || endpoint === "/crm/operational-dashboard") return crmDashboard();
  if (endpoint === "/leads/metrics") return { total: 0, new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
  if (endpoint === "/broker/overview") return brokerOverview();
  if (endpoint === "/broker/catalog") return { areas: {}, recordDefinitions: {}, agents: [], aiScenarios: [], automationRules: [], roleTemplates: [], sopLibrary: [], financingStages: [], operationStages: { SALE: [], RENTAL: [], ADMINISTRATION: [] }, operationChecklists: {} };
  if (endpoint === "/broker/operations") return [];
  if (endpoint === "/broker/prospects") return { items: [], total: 0, page: 1, pageSize: 100 };
  if (endpoint === "/broker/governance") return { summary: { openAlerts: 0, highPriorityAlerts: 0, resolvedLast30Days: 0, activityLast30Days: 0, totalAuditedEvents: 0 }, alerts: [], recentActivity: [], actionCounts: [] };
  if (endpoint === "/ai-ops/summary") return { metrics: { critical: 0, opportunities: 0, averageScore: 0 }, priorities: [], strategies: [] };
  if (endpoint === "/onboarding/knowledge") return { sections: [], updatedAt: null };
  if (endpoint === "/connections") return {
    tenantId: user.tenantId,
    generatedAt: new Date().toISOString(),
    credentialRotation: { active: false, message: null },
    summary: { total: 0, connected: 0, pending: 0, errors: 0, disconnected: 0 },
    reconciliation: { scanned: 0, active: 0, inactive: 0, incomplete: 0, unrecognized: 0, items: [] },
    callbacks: { oauthGoogle: "", oauthMicrosoft: "", metaWebhook: "" },
    groups: [],
  };
  if (/notification|alerts|alertas/.test(endpoint)) return { items: [], notifications: [], unreadCount: 0 };
  if (/\/finance\/(overview|connection-health)/.test(endpoint)) return {};
  if (/\/finance\//.test(endpoint)) return { documents: [], records: [], items: [], statements: [], integrations: [], entries: [], portfolio: [], accounts: [], banks: [], jobs: [], suggestions: [] };
  if (/^(\/conversations|\/messages|\/campaigns|\/bookings|\/payments|\/leads|\/documents|\/connections|\/industry-records|\/workflows|\/users)/.test(endpoint)) return [];
  return {};
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    // La cookie se inserta antes de la primera navegación para que el proxy de
    // Next.js pueda validar la sesión ficticia sin redirigir a Login.
    await context.addCookies([{
      name: "inbox_session",
      value: encodeURIComponent(JSON.stringify(user)),
      domain: new URL(frontendUrl).hostname,
      path: "/",
    }]);
    await context.addInitScript(({ session }) => {
      localStorage.setItem("inbox_session", JSON.stringify(session));
      document.cookie = `inbox_session=${encodeURIComponent(JSON.stringify(session))};path=/`;
    }, { session: user });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === frontendUrl && !url.pathname.startsWith("/api/")) return route.continue();
      if (["image", "stylesheet", "font", "script"].includes(route.request().resourceType())) return route.continue();
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": frontendUrl, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS" } });
      const endpoint = url.pathname.replace(/^\/api/, "");
      if (process.env.QA_DEBUG) console.log(`${route.request().method()} ${endpoint}`);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": frontendUrl,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "Content-Type, Authorization",
        },
        body: JSON.stringify(apiBody(endpoint)),
      });
    });

    for (const [name, target] of selectedRoutes) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
        if (process.env.QA_DEBUG) console.error(`${name}: ${error.message}`);
      });
      // Algunos módulos mantienen polling o sockets activos. `networkidle`
      // nunca llega en esos casos aunque la interfaz ya esté lista, por eso
      // se espera el DOM y un breve ciclo de hidratación controlado.
      await page.goto(`${frontendUrl}${target}`, { waitUntil: "domcontentloaded", timeout: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 25000) });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(output, `${name}-escritorio.png`) });
      if (!await page.locator(".model-a-page-canvas").count()) {
        console.error(`${name}: sin lienzo Modelo A. URL final: ${page.url()}`);
        console.error((await page.locator("body").innerText()).slice(0, 1200));
      }
      assert.equal(await page.locator("html").getAttribute("data-ui-layout"), "model-a", `${name}: el formato compartido debe ser Modelo A.`);
      assert.equal(await page.locator(".evolum-menu-bubble").count(), 0, `${name}: no debe renderizar la burbuja de navegación anterior.`);
      assert.ok(await page.locator(".model-a-page-canvas").count(), `${name}: debe conservar el lienzo principal de Modelo A.`);
      assert.deepEqual(errors, [], `${name}: no debe producir errores JavaScript con una respuesta vacía válida.`);
      if (mobileAudit && mobileCriticalRoutes.has(name)) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(250);
        if (process.env.QA_DEBUG && name === "broker-operaciones") {
          console.log(await page.locator(".broker-os-header").evaluate((element) => ({
            header: { height: element.getBoundingClientRect().height, display: getComputedStyle(element).display, alignContent: getComputedStyle(element).alignContent, minHeight: getComputedStyle(element).minHeight },
            children: Array.from(element.children).map((child) => ({ className: child.className, top: child.getBoundingClientRect().top, height: child.getBoundingClientRect().height })),
          })));
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        assert.equal(overflow, false, `${name}: no debe desbordarse horizontalmente en teléfono.`);
        await page.screenshot({ path: path.join(output, `${name}-movil.png`) });
      }
      await page.close();
    }
    console.log(`QA visual transversal: ${selectedRoutes.length} vistas verificadas con API simulada. Evidencia: ${output}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
