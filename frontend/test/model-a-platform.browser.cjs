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

function brokerAccess() {
  return {
    businessRole: "CEO",
    profileLabel: "Administración de Broker OS",
    profileKind: "SYSTEM",
    customProfileId: null,
    workspaceKeys: [],
    agentKeys: [],
    accessScope: "COMPANY",
    requestedScope: "COMPANY",
    teamKey: null,
    branchKey: null,
    technicalRole: "SUPER_ADMIN",
    scopeDescription: "Toda la empresa de demostración",
    holding: null,
    policy: { label: "Acceso completo de demostración", defaultScope: "COMPANY", actions: { "*": ["VIEW", "CREATE", "EDIT", "DELETE", "CONFIGURE", "APPROVE", "REASSIGN"] } },
  };
}

const modules = [
  "dashboard", "sales", "agenda", "inbox", "marketing", "ai_ops", "analytics",
  "payments", "saas", "connections", "documents", "customers", "properties",
  "realty_loads", "brokers", "realty_activity", "broker_portal", "realty_clients",
  "finance", "developer", "workflows", "shifts", "patients", "exams",
];

const routes = [
  ["inicio-crm", "/crm-principal"],
  ["administracion", "/admin"],
  ["dashboard", "/dashboard"],
  ["agenda", "/agenda"],
  ["pipeline", "/pipeline"],
  ["campanas", "/campaigns"],
  ["chats", "/inbox"],
  ["operacion-ia", "/ai-ops"],
  ["conexiones", "/connections"],
  ["documentos", "/documents"],
  ["clientes", "/customers"],
  ["examenes", "/exams"],
  ["pagos", "/payments"],
  ["finanzas", "/finance"],
  ["configuracion-agente", "/onboarding"],
  ["control-ia", "/settings/ai"],
  ["datos-formularios", "/settings/metadata"],
  ["turnos", "/shifts"],
  ["taller", "/workshop"],
  ["automatizaciones", "/workflows"],
  ["operacion-vertical", "/operations/gastronomy"],
  ["broker-operaciones", "/realty?view=operations"],
  // Vistas operativas adicionales. Varias rutas cortas son accesos de
  // compatibilidad que redirigen al workspace principal; se mantienen aquí
  // para comprobar que un marcador antiguo no devuelva al usuario a una
  // pantalla con el formato visual anterior.
  ["propiedades-directo", "/properties"],
  ["corredores-directo", "/brokers"],
  ["portal-corredor-directo", "/broker-portal"],
  ["actividad-inmobiliaria-directa", "/realty-activity"],
  ["carga-inmobiliaria-directa", "/realty-loads"],
  ["reportes", "/reports"],
  ["ingresos", "/revenue"],
  ["analitica-saas", "/saas-analytics"],
  ["planes-y-cuenta", "/saas"],
  ["cola-ventas", "/sales-queue"],
  ["equipo", "/team"],
  ["laboratorio-bots", "/dev/bot-lab"],
  ["pacientes", "/patients"],
  ["operacion-dental", "/operations/dental"],
  ["operacion-clinica", "/operations/health"],
  ["operacion-veterinaria", "/operations/veterinary"],
  // Cada destino del menú Broker OS se revisa por separado. Esto evita que
  // una vista interna conserve el diseño viejo aunque la portada de Broker
  // se vea correcta.
  ["broker-resumen", "/realty"],
  ["broker-centro-operativo", "/realty?view=broker_os&tab=operations"],
  ["broker-dashboard-ejecutivo", "/realty?view=broker_os&tab=executive_dashboard"],
  ["broker-tracker-operacion", "/realty?view=broker_os&tab=operation_tracker"],
  ["broker-propiedades", "/realty?view=properties"],
  ["broker-propietarios", "/realty?view=owners"],
  ["broker-corredores", "/realty?view=brokers"],
  ["broker-visitas", "/realty?view=activity"],
  ["broker-cartera-corredor", "/realty?view=portal"],
  ["broker-publicaciones", "/realty?view=publications"],
  ["broker-compradores", "/realty?view=buyers"],
  ["broker-formacion", "/realty?view=training"],
  ["broker-comercial", "/realty?view=broker_os&area=commercial"],
  ["broker-arriendos", "/realty?view=broker_os&area=rentals"],
  ["broker-expediente", "/realty?view=broker_os&area=documents"],
  ["broker-financiamiento", "/realty?view=broker_os&area=financing"],
  ["broker-postventa", "/realty?view=broker_os&area=post_sale"],
  ["broker-mantencion", "/realty?view=broker_os&area=maintenance"],
  ["broker-proyectos", "/realty?view=broker_os&area=projects"],
  ["broker-comisiones", "/realty?view=broker_os&tab=commissions"],
  ["broker-liquidacion-mensual", "/realty?view=broker_os&tab=administration_preview"],
  ["broker-finanzas-operativas", "/realty?view=broker_os&tab=financial_operations"],
  ["broker-hub-comercial", "/realty?view=broker_os&tab=commercial_hub"],
  ["broker-ai-ops", "/realty?view=broker_os&tab=ai_ops"],
  ["broker-gobierno-ia", "/realty?view=broker_os&tab=ai_governance"],
  ["broker-casos", "/realty?view=broker_os&tab=case_management"],
  ["broker-agentes", "/realty?view=broker_os&tab=agents"],
  ["broker-entrenamiento-ia", "/realty?view=broker_os&tab=training"],
  ["broker-parametros", "/realty?view=broker_os&tab=configuration"],
  ["broker-accesos", "/realty?view=broker_os&tab=access"],
  ["broker-cuenta", "/realty?view=broker_os&tab=account"],
  ["broker-gobierno-alertas", "/realty?view=broker_os&tab=governance"],
  ["broker-cumplimiento", "/realty?view=broker_os&tab=compliance"],
  ["broker-guias", "/realty?view=broker_os&tab=guides"],
];

const routeFilter = String(process.env.QA_ROUTE || "").trim();
const selectedRoutes = routeFilter
  ? routes.filter(([name]) => routeFilter.split(",").map((item) => item.trim()).includes(name))
  : routes;

if (!selectedRoutes.length) throw new Error("QA_ROUTE no coincide con una vista conocida.");

const mobileAudit = process.env.QA_MOBILE === "1";
const darkMode = process.env.QA_DARK === "1";
const diagnosticsEnabled = process.env.QA_DEBUG === "1";
// Toda pantalla incluida en la auditoría debe conservar jerarquía, navegación y
// ancho útil en teléfono. Así no se restringe la regresión móvil a unas pocas
// vistas que históricamente eran las más sensibles.
const mobileCriticalRoutes = new Set(routes.map(([name]) => name));

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

function brokerExecutiveDashboard() {
  return {
    dashboard: {
      generatedAt: new Date().toISOString(),
      scope: { level: "COMPANY", description: "Demostración de toda la empresa" },
      kpis: { effectivenessPct: 0, activeOperations: 0, closedOperations: 0, projectedRevenue: 0, weightedForecast: 0, weightedCommission: 0, averageCloseTimeDays: null },
      forecast: { notice: "Sin operaciones activas para proyectar.", assumptions: {}, lines: [] },
      bottlenecks: [],
      risks: [],
      conversion: { byCommune: [], byBroker: [] },
      teamRanking: [],
      campaigns: [],
      recommendations: [],
    },
    assumptions: { probabilities: {}, configured: false, updatedAt: null, updatedBy: null, notice: "No hay supuestos personalizados registrados." },
  };
}

function brokerOperatingConfiguration() {
  return {
    configured: false,
    updatedAt: null,
    policy: {
      sales: { sellerCommissionPct: 0, buyerCommissionPct: 0, brokerSplitPct: 50, companySplitPct: 50 },
      rentalPlacement: { landlordMonths: 0, tenantMonths: 0, withholdingRatePct: null },
      administration: { tiers: [], ownerPaymentDay: 5 },
      slas: { firstLeadContactMinutes: 0, propertyPublicationHours: 0, legalReviewHours: 0, criticalIncidentHours: 0 },
      financing: { interestRatePct: null, riskThreshold: null, requiresHumanApproval: true, automaticDisbursement: false },
    },
  };
}

function brokerLegalReadiness() {
  return { providers: [], consents: [], summary: { PENDING: 0, GRANTED: 0, REVOKED: 0, EXPIRED: 0 } };
}

function brokerMonthlyAdministration() {
  return {
    period: "2026-11",
    rows: [],
    summary: { managedProperties: 0, readyToPrepare: 0, pendingApproval: 0, issued: 0, paid: 0, expectedRent: 0, paidRent: 0, proposedOwnerAmount: 0 },
  };
}

function brokerFinancialOperations() {
  return {
    period: "2026-11",
    queue: [],
    summary: { pendingCount: 0, overdueCount: 0, reviewCount: 0, pendingAmount: 0, reportedAmount: 0 },
    reports: {
      sales: { count: 0, total: 0, paid: 0, reported: 0, pending: 0 },
      rentalPlacement: { count: 0, total: 0, paid: 0, reported: 0, pending: 0 },
      administration: { count: 0, total: 0, paid: 0, reported: 0, pending: 0 },
      margin: { grossRevenue: 0, costs: 0, amount: 0, roiPct: null, basis: "Sin movimientos registrados" },
      brokerSettlements: [],
    },
    tenantSimulation: [],
    renewalAlerts: [],
  };
}

function brokerCommercialHub() {
  return {
    month: "2026-11",
    summary: { campaigns: 0, activePublications: 0, investment: 0, leads: 0, cpl: null, potentialRoi: null, agendaPending: 0, confirmationsPending: 0, escalationsPending: 0, linkedChats: 0, unlinkedChats: 0 },
    marketing: [], agenda: [], chats: [],
    notes: { marketing: "Sin campañas operativas.", agenda: "Sin visitas pendientes.", chats: "Sin conversaciones por vincular." },
  };
}

function brokerAiOps() {
  return {
    version: "qa", generatedAt: new Date().toISOString(),
    scope: { level: "COMPANY", description: "Toda la empresa de demostración" },
    notice: "Las sugerencias de IA son solo de lectura en esta demostración.",
    summary: { totalPriorities: 0, highPriorities: 0, operationsVisible: 0, pendingHumanReview: 0, triggeredAlerts: 0 },
    priorities: [],
    patterns: [{ key: "sin-datos", status: "INSUFFICIENT_DATA", title: "Muestra inicial", detail: "Aún no hay suficiente actividad para calcular un patrón.", evidence: { sampleSize: 0, period: "Sin período", activity: 0 } }],
    triggeredAlerts: [],
  };
}

function brokerAiGovernance() {
  return {
    version: "qa", generatedAt: new Date().toISOString(),
    scope: { level: "COMPANY", description: "Toda la empresa de demostración" },
    policy: { notice: "La IA no ejecuta contacto externo ni cambios de estado por sí sola.", externalContact: "BLOCKED", stateChanges: false, simulationMode: "NO_SEND" },
    summary: { officialRules: 0, customRules: 0, activeRules: 0, matchingRules: 0, pendingEvaluations: 0, triggeredAlerts: 0 },
    agents: [], conditions: [], rules: [],
    simulation: { mode: "NO_SEND", generatedAt: new Date().toISOString(), notice: "Sin simulaciones pendientes.", executions: [] },
    triggeredAlerts: [],
  };
}

function brokerDocumentIndex() {
  return {
    version: "qa", generatedAt: new Date().toISOString(),
    filters: { propertyId: "", person: "", type: "ALL", status: "ALL", expiry: "ALL" },
    summary: { total: 0, visible: 0, expiringIn60Days: 0, overdue: 0, evidenceIncomplete: 0, signaturesRegistered: 0 },
    facets: { properties: [], types: [], statuses: [], people: [] },
    notice: "No hay documentos dentro del alcance de demostración.", items: [],
  };
}

function brokerAccount() {
  return {
    version: "qa",
    account: {
      id: user.tenantId, name: "Broker QA", slug: "broker-qa",
      plan: { code: "DEMO", name: "Demostración", description: "Cuenta de validación visual" },
      limits: { users: null, messagesMonthly: null },
      team: { active: 1, inactive: 0, remaining: null },
    },
    modules: { active: [], inactive: [], retention: { dataPreserved: true, message: "La demostración no contiene registros que eliminar." } },
    workload: { generatedAt: new Date().toISOString(), summary: { activeUsers: 1, inactiveUsers: 0, unassigned: { properties: 0, operations: 0, visits: 0, pending: 0 }, totalWorkload: 0 }, members: [], suggestedAssignee: null, unassignedProperties: [] },
    externalReadiness: [], generatedAt: new Date().toISOString(),
  };
}

function brokerAccessProfiles() {
  return { workspaces: [], systemProfiles: [], customProfiles: [] };
}

function financeContextCoverage() {
  return {
    context: { period: "2026-11", accountKey: "", currency: "CLP" },
    company: { id: user.tenantId, name: "Broker QA" },
    accounts: [],
    sources: {
      movements: { count: 0, from: null, to: null, status: "NO_DATA" },
      customers: { count: 0, from: null, to: null, status: "NO_DATA" },
      suppliers: { count: 0, from: null, to: null, status: "NO_DATA" },
    },
    statements: 0,
    complete: false,
    warnings: ["Sin datos financieros de demostración para el período seleccionado."],
    documentScope: "Empresa autenticada",
  };
}

function financeOverview() {
  return {
    context: { period: "2026-11", accountKey: "", currency: "CLP" },
    scopeNote: "Vista de demostración sin registros financieros.",
    generatedAt: new Date().toISOString(),
    schedule: { asOf: "2026-11-01", next30Days: 0, undatedDocuments: 0, basis: "Sin documentos", weeks: [] },
    invoices: { total: 0, issued: 0, paid: 0, justifiedDifferences: 0, pending: 0, overdue: 0, pendingAmount: 0, overdueAmount: 0 },
    collection: { rate: 0, dsoDays: 0, dsoSampleSize: 0, expectedNext30Days: 0 },
    reconciliation: { totalMovements: 0, matchedMovements: 0, pendingMovements: 0, rate: 0, excludedMovements: 0, inconsistentMovements: 0, invalidDateMovements: 0 },
    exceptions: { open: 0, critical: 0 },
    collections: { open: 0, promises: 0 },
    aging: [],
    recent: { invoices: [], exceptions: [], collectionCases: [] },
    integrationReadiness: [],
  };
}

function financeConnectionHealth() {
  return {
    checkedAt: new Date().toISOString(),
    maxVerificationAgeHours: 24,
    scope: "Empresa autenticada",
    canManage: true,
    items: [],
  };
}

function apiBody(endpoint) {
  if (endpoint === "/auth/me") return { user, tenant: { id: user.tenantId, name: "Broker QA", industry: "REAL_ESTATE" }, modules };
  if (endpoint === "/modules/me") return { modules, industry: "REAL_ESTATE", role: user.role };
  if (endpoint === "/broker/access/me") return brokerAccess();
  if (endpoint === "/crm/operational" || endpoint === "/crm/operational-dashboard") return crmDashboard();
  if (endpoint === "/leads/metrics") return { total: 0, new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
  if (endpoint === "/broker/overview") return brokerOverview();
  if (endpoint === "/broker/executive-dashboard") return brokerExecutiveDashboard();
  if (endpoint === "/broker/forecast-assumptions") return brokerExecutiveDashboard().assumptions;
  if (endpoint === "/broker/configuration") return brokerOperatingConfiguration();
  if (endpoint === "/broker/legal-readiness") return brokerLegalReadiness();
  if (endpoint === "/broker/operations/assignees") return { users: [] };
  if (endpoint === "/broker/access/team") return { users: [] };
  if (endpoint === "/broker/access/holding") return { holding: null, availableTenants: [], canConfigure: true };
  if (/^\/broker\/assignees\//.test(endpoint)) return { users: [] };
  if (/^\/broker\/records\//.test(endpoint)) return [];
  if (endpoint === "/broker/financing") return [];
  if (endpoint === "/broker/administration/monthly") return brokerMonthlyAdministration();
  if (endpoint === "/broker/finance/operations") return brokerFinancialOperations();
  if (endpoint === "/broker/commercial-hub") return brokerCommercialHub();
  if (endpoint === "/broker/ai-ops") return brokerAiOps();
  if (endpoint === "/broker/ai-governance" || endpoint === "/broker/ai-governance/simulate") return brokerAiGovernance();
  if (endpoint === "/broker/documents/index") return brokerDocumentIndex();
  if (endpoint === "/broker/account") return brokerAccount();
  if (endpoint === "/broker/access/profiles") return brokerAccessProfiles();
  if (endpoint === "/broker/owners") return { generatedAt: new Date().toISOString(), filters: { search: "", portfolio: "ALL" }, owners: [] };
  if (endpoint === "/broker/publications/options") return { channels: [], statuses: [], properties: [], externalPublicationEnabled: false, externalPublicationNotice: "No hay portales externos configurados en la demostración." };
  if (endpoint === "/broker/publications") return { items: [], total: 0, externalPublicationEnabled: false };
  if (endpoint === "/broker/publications/analytics") return { total: 0, published: 0, approved: 0, pendingProvider: 0, pendingReview: 0, views: 0, contacts: 0, favorites: 0, contactRatePct: null, byChannel: [] };
  if (endpoint === "/broker/publication-providers") return { providers: [], providerStatuses: [], credentialPolicy: "Sin integraciones externas configuradas." };
  if (endpoint === "/broker/catalog") return { areas: {}, recordDefinitions: {}, agents: [], aiScenarios: [], automationRules: [], roleTemplates: [], sopLibrary: [], financingStages: [], operationStages: { SALE: [], RENTAL: [], ADMINISTRATION: [] }, operationChecklists: {} };
  if (endpoint === "/broker/operations") return [];
  if (endpoint === "/broker/prospects") return { items: [], total: 0, page: 1, pageSize: 100 };
  if (endpoint === "/broker/governance") return { summary: { openAlerts: 0, highPriorityAlerts: 0, resolvedLast30Days: 0, activityLast30Days: 0, totalAuditedEvents: 0 }, alerts: [], recentActivity: [], actionCounts: [] };
  if (endpoint === "/ai-ops/summary") return { metrics: { critical: 0, opportunities: 0, averageScore: 0 }, priorities: [], strategies: [] };
  if (endpoint === "/admin/tenants") return [];
  if (endpoint === "/admin/industries") return { templates: [] };
  if (endpoint === "/modules/catalog") return { modules: {}, plans: {} };
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
  if (endpoint === "/finance/workspace-context") return financeContextCoverage();
  if (endpoint === "/finance/overview") return financeOverview();
  if (endpoint === "/finance/connection-health") return financeConnectionHealth();
  if (/\/finance\//.test(endpoint)) return { documents: [], records: [], items: [], statements: [], integrations: [], entries: [], portfolio: [], accounts: [], banks: [], jobs: [], suggestions: [] };
  if (endpoint === "/workflows") return { workflows: [] };
  if (endpoint === "/workflow-dead-letters") return { deadLetters: [] };
  if (/^\/workflows\/[^/]+\/runs$/.test(endpoint)) return { runs: [] };
  if (/^\/workflows\/[^/]+\/versions$/.test(endpoint)) return { versions: [] };
  if (/^(\/conversations|\/messages|\/campaigns|\/bookings|\/payments|\/leads|\/documents|\/connections|\/industry-records|\/users)/.test(endpoint)) return [];
  return {};
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
  try {
    // El viewport debe existir desde la primera hidratación. Cambiarlo después
    // de cargar la ruta no representa un teléfono real: los componentes que
    // deciden su estado inicial según el tamaño (por ejemplo la ayuda rápida)
    // ya habrían asumido un escritorio.
    const context = await browser.newContext({
      viewport: mobileAudit ? { width: 390, height: 844 } : { width: 1440, height: 980 },
    });
    // La cookie se inserta antes de la primera navegación para que el proxy de
    // Next.js pueda validar la sesión ficticia sin redirigir a Login.
    await context.addCookies([{
      name: "inbox_session",
      value: encodeURIComponent(JSON.stringify(user)),
      domain: new URL(frontendUrl).hostname,
      path: "/",
    }]);
    await context.addInitScript(({ session, useDarkMode }) => {
      localStorage.setItem("inbox_session", JSON.stringify(session));
      document.cookie = `inbox_session=${encodeURIComponent(JSON.stringify(session))};path=/`;
      if (useDarkMode) {
        localStorage.setItem("evolum_color_mode", "dark");
      }
    }, { session: user, useDarkMode: darkMode });
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
      // se espera el DOM y la finalización verificable de la validación de
      // acceso. Una captura de «Preparando módulo…» no sirve como evidencia
      // funcional ni visual de una vista real.
      await page.goto(`${frontendUrl}${target}`, { waitUntil: "domcontentloaded", timeout: Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 25000) });
      await page.waitForFunction((mustUseDarkMode) => {
        const root = document.documentElement;
        return root.dataset.themeReady === "true"
          && root.dataset.uiLayout === "model-a"
          && (!mustUseDarkMode || (root.dataset.theme === "dark" && root.dataset.designSystem === "dark"));
      }, darkMode, { timeout: Number(process.env.PLAYWRIGHT_MODULE_READY_TIMEOUT_MS || 10000) });
      // Realty no usa ModuleGate en su entrada principal: muestra una
      // validación propia antes de montar el workspace. También debe terminar
      // antes de evaluar la pantalla, incluso si aún no había aparecido cuando
      // comenzó la navegación.
      await page.waitForTimeout(250);
      await page.locator(".module-access-loading").waitFor({ state: "hidden", timeout: Number(process.env.PLAYWRIGHT_MODULE_READY_TIMEOUT_MS || 10000) });
      await page.locator(".realty-access-status").waitFor({ state: "hidden", timeout: Number(process.env.PLAYWRIGHT_MODULE_READY_TIMEOUT_MS || 10000) });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(output, `${name}-escritorio.png`) });
      if (!await page.locator(".model-a-page-canvas").count()) {
        console.error(`${name}: sin lienzo Modelo A. URL final: ${page.url()}`);
        console.error((await page.locator("body").innerText()).slice(0, 1200));
      }
      assert.equal(await page.locator("html").getAttribute("data-ui-layout"), "model-a", `${name}: el formato compartido debe ser Modelo A.`);
      if (darkMode) {
        assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", `${name}: el modo oscuro debe activar el tema nocturno.`);
        assert.equal(await page.locator("html").getAttribute("data-design-system"), "dark", `${name}: el modo oscuro debe activar el sistema visual nocturno.`);
      }
      assert.equal(await page.locator(".evolum-menu-bubble").count(), 0, `${name}: no debe renderizar la burbuja de navegación anterior.`);
      assert.ok(await page.locator(".model-a-page-canvas").count(), `${name}: debe conservar el lienzo principal de Modelo A.`);
      const title = page.locator(".model-a-page-header h1").first();
      if (await title.count()) {
        const titleGeometry = await title.evaluate((element, diagnostics) => {
          const titleBounds = element.getBoundingClientRect();
          const header = element.closest(".model-a-page-header");
          const headerBounds = header?.getBoundingClientRect();
          const parent = header?.parentElement || null;
          const matchedHeaderRules = [];
          const matchedParentRules = [];
          if (diagnostics) {
            const visitRules = (rules) => {
              for (const rule of Array.from(rules || [])) {
                if (rule.cssRules) visitRules(rule.cssRules);
                if (!header || !rule.selectorText) continue;
                try {
                  if (header.matches(rule.selectorText)) {
                    const style = rule.style;
                    if (style.getPropertyValue("height") || style.getPropertyValue("min-height") || style.getPropertyValue("padding") || style.getPropertyValue("overflow")) {
                      matchedHeaderRules.push({
                        selector: rule.selectorText,
                        height: style.getPropertyValue("height") || null,
                        minHeight: style.getPropertyValue("min-height") || null,
                        padding: style.getPropertyValue("padding") || null,
                        overflow: style.getPropertyValue("overflow") || null,
                      });
                    }
                  }
                  if (parent && parent.matches(rule.selectorText)) {
                    const style = rule.style;
                    if (style.getPropertyValue("display") || style.getPropertyValue("grid-template-rows") || style.getPropertyValue("grid-auto-rows") || style.getPropertyValue("align-content")) {
                      matchedParentRules.push({
                        selector: rule.selectorText,
                        display: style.getPropertyValue("display") || null,
                        gridTemplateRows: style.getPropertyValue("grid-template-rows") || null,
                        gridAutoRows: style.getPropertyValue("grid-auto-rows") || null,
                        alignContent: style.getPropertyValue("align-content") || null,
                      });
                    }
                  }
                } catch {
                  // Una regla no compatible no afecta el diagnóstico visual.
                }
              }
            };
            for (const sheet of Array.from(document.styleSheets)) {
              try { visitRules(sheet.cssRules); } catch { /* Hoja no accesible. */ }
            }
          }
          return {
            titleTop: titleBounds.top,
            titleBottom: titleBounds.bottom,
            headerTop: headerBounds?.top ?? 0,
            headerBottom: headerBounds?.bottom ?? 0,
            headerStyle: headerBounds ? (() => {
              const style = getComputedStyle(header);
              const firstChild = header.firstElementChild;
              const childBounds = firstChild?.getBoundingClientRect();
              const childStyle = firstChild ? getComputedStyle(firstChild) : null;
              const parentStyle = header.parentElement ? getComputedStyle(header.parentElement) : null;
              return {
                display: style.display,
                height: style.height,
                minHeight: style.minHeight,
                maxHeight: style.maxHeight,
                flex: style.flex,
                flexShrink: style.flexShrink,
                flexBasis: style.flexBasis,
                padding: style.padding,
                overflow: style.overflow,
                alignItems: style.alignItems,
                child: childBounds ? {
                  top: childBounds.top,
                  bottom: childBounds.bottom,
                  height: childBounds.height,
                  position: childStyle?.position,
                  display: childStyle?.display,
                } : null,
                parent: parentStyle ? {
                  display: parentStyle.display,
                  gridTemplateRows: parentStyle.gridTemplateRows,
                  gridAutoRows: parentStyle.gridAutoRows,
                  alignContent: parentStyle.alignContent,
                  overflow: parentStyle.overflow,
                } : null,
              };
            })() : null,
            matchedHeaderRules,
            matchedParentRules,
          };
        }, diagnosticsEnabled);
        if (diagnosticsEnabled) console.log(`${name}:`, titleGeometry);
        assert.ok(
          titleGeometry.titleTop >= titleGeometry.headerTop - 1 && titleGeometry.titleBottom <= titleGeometry.headerBottom + 1,
          `${name}: el título principal no debe quedar recortado por su encabezado.`,
        );
      }
      if (darkMode) {
        // Una paleta nocturna no puede conservar tarjetas blancas heredadas:
        // además de romper la identidad visual, suele dejar texto claro sobre
        // un fondo claro. Se revisan las superficies principales del lienzo,
        // no botones o estados que pueden usar colores semánticos propios.
        const lightSurfaces = await page.locator(".model-a-page-canvas, .model-a-page-canvas *").evaluateAll((elements) => {
          const channels = (value) => Array.from(String(value).matchAll(/rgba?\(([^)]+)\)/g))
            .map((match) => {
              const parts = match[1].split(",").map((part) => Number(part.trim()));
              return { red: parts[0], green: parts[1], blue: parts[2], alpha: Number.isFinite(parts[3]) ? parts[3] : 1 };
            })
            .filter((color) => [color.red, color.green, color.blue, color.alpha].every(Number.isFinite));
          return elements.map((element) => {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            const colors = [...channels(style.backgroundColor), ...channels(style.backgroundImage)];
            return {
              tag: element.tagName.toLowerCase(),
              className: String(element.className || "").slice(0, 180),
              isLight: bounds.width * bounds.height >= 420
                && style.visibility !== "hidden"
                && style.display !== "none"
                && colors.some(({ red, green, blue, alpha }) => alpha > .55 && red > 225 && green > 225 && blue > 225),
            };
          }).filter((item) => item.isLight);
        });
        assert.deepEqual(lightSurfaces, [], `${name}: ninguna superficie visible debe conservar fondo claro en modo oscuro.`);
      }
      assert.deepEqual(errors, [], `${name}: no debe producir errores JavaScript con una respuesta vacía válida.`);
      if (mobileAudit && mobileCriticalRoutes.has(name)) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(250);
        assert.equal(
          await page.locator(".context-help-card").count(),
          0,
          `${name}: la guía rápida debe iniciar minimizada en un teléfono para no cubrir el contenido.`,
        );
        const mobileHeader = page.locator(".model-a-page-header").first();
        if (await mobileHeader.count()) {
          const geometry = await mobileHeader.evaluate((element) => {
            const header = element.getBoundingClientRect();
            const title = element.querySelector("h1");
            const titleBounds = title?.getBoundingClientRect();
            return {
              top: header.top,
              bottom: header.bottom,
              height: header.height,
              titleTop: titleBounds?.top ?? header.top,
              titleBottom: titleBounds?.bottom ?? header.bottom,
              viewportHeight: window.innerHeight,
            };
          });
          if (diagnosticsEnabled) console.log(`Diagnóstico móvil ${name}:`, geometry);
          if (diagnosticsEnabled) {
            await page.screenshot({ path: path.join(output, `${name}-movil-debug.png`) });
          }
          assert.ok(
            geometry.titleTop >= geometry.top - 1 && geometry.titleBottom <= geometry.bottom + 1,
            `${name}: el título móvil no debe quedar recortado por su encabezado.`,
          );
          assert.ok(
            geometry.height <= Math.min(440, geometry.viewportHeight * 0.52),
            `${name}: el encabezado móvil no debe consumir una parte excesiva de la vista.`,
          );
        }
        if (diagnosticsEnabled && name === "broker-operaciones") {
          console.log("Diagnóstico móvil:", await page.locator(".model-a-page-header").first().evaluate((element) => {
            const parent = element.parentElement;
            const style = getComputedStyle(element);
            const parentStyle = parent ? getComputedStyle(parent) : null;
            return {
              header: {
                height: element.getBoundingClientRect().height,
                display: style.display,
                minHeight: style.minHeight,
                padding: style.padding,
                alignItems: style.alignItems,
              },
              parent: parentStyle ? {
                display: parentStyle.display,
                gridTemplateRows: parentStyle.gridTemplateRows,
                gridAutoRows: parentStyle.gridAutoRows,
                alignContent: parentStyle.alignContent,
              } : null,
              children: Array.from(element.children).map((child) => ({
                className: child.className,
                top: child.getBoundingClientRect().top,
                height: child.getBoundingClientRect().height,
              })),
            };
          }));
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
