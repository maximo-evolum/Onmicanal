/** Archivo: Valida en navegador el gobierno IA de Broker OS sin usar producción. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendUrl = (process.env.BROKER_WEB_URL || "http://localhost:3001").replace(/\/$/, "");
const output = path.resolve(process.env.QA_OUTPUT || "");
if (!output.startsWith(path.resolve("E:/Entregables_EVOLUM_OS") + path.sep)) throw new Error("QA_OUTPUT debe estar fuera del proyecto, dentro de Entregables_EVOLUM_OS.");

const user = { id: "qa-ai-admin", tenantId: "qa-broker", name: "Dirección QA", email: "direccion.qa@example.invalid", role: "OWNER" };
const modules = ["properties", "realty_loads", "brokers", "realty_activity", "broker_portal", "realty_clients"];
const access = { businessRole: "CEO", profileLabel: "Dirección general", accessScope: "COMPANY", requestedScope: "COMPANY", teamKey: null, branchKey: null, technicalRole: "OWNER", holding: null, scopeDescription: "Registros de toda la empresa", policy: { label: "Dirección general", defaultScope: "COMPANY", actions: { overview: ["VIEW"], operations: ["VIEW"], ai: ["VIEW", "APPROVE"] } } };

const conditions = [
  { key: "PROPERTY_INCOMPLETE", label: "Ficha de propiedad incompleta", action: "Preparar alerta interna" },
  { key: "OPERATION_STALLED", label: "Operación sin avance o siguiente etapa pendiente", action: "Preparar alerta interna" },
];
let customRules = [];

function governance() {
  const rules = [
    { id: "official:ficha_incompleta", key: "ficha_incompleta", kind: "OFFICIAL", editable: false, active: true, title: "Control de ficha incompleta", trigger: "Una propiedad no tiene precio, ubicación o imagen principal.", action: "Crear prioridad interna.", approval: "No publica la propiedad.", conditionKey: "PROPERTY_INCOMPLETE", conditionLabel: conditions[0].label, autonomy: "HUMAN_APPROVAL", autonomyLabel: "Solo análisis", externalContact: "BLOCKED", externalContactLabel: "Contacto externo bloqueado", simulator: "NO_SEND", simulatorLabel: "Simulador sin envío", stateChanges: false, matched: 1, evidence: [{ id: "property-1", title: "Departamento QA", detail: "Falta imagen principal.", priority: "HIGH", propertyId: "property-1", operationId: null }] },
    ...customRules,
  ];
  return {
    version: "BROKER_AI_GOVERNANCE_V1", generatedAt: "2026-11-04T12:00:00.000Z", scope: { level: "COMPANY", description: "Registros de toda la empresa" },
    policy: { notice: "Las reglas solo analizan registros visibles. Ninguna puede contactar personas, publicar inmuebles, cambiar estados, aprobar contratos, firmar ni ejecutar pagos.", externalContact: "BLOCKED", stateChanges: false, simulationMode: "NO_SEND" },
    summary: { officialRules: 1, customRules: customRules.length, activeRules: rules.filter((rule) => rule.active).length, matchingRules: rules.filter((rule) => rule.active && rule.matched).length, pendingEvaluations: 0, triggeredAlerts: 1 },
    agents: [
      { key: "analytics", name: "Agente de Analítica", status: "AVAILABLE", statusLabel: "Disponible", statusDetail: "Lectura explicable", description: "Resume cartera sin modificar registros.", limitation: "No toma decisiones comerciales.", externalContact: "BLOCKED", autonomousActions: false },
      { key: "commercial", name: "Agente Comercial", status: "LIMITED", statusLabel: "Disponible con límites", statusDetail: "Solo borradores internos", description: "Propone el siguiente paso.", limitation: "No contacta personas.", externalContact: "BLOCKED", autonomousActions: false },
      { key: "legal", name: "Agente Legal", status: "IN_DEVELOPMENT", statusLabel: "En desarrollo", statusDetail: "No habilitado", description: "Checklist documental futuro.", limitation: "No emite revisión jurídica.", externalContact: "BLOCKED", autonomousActions: false },
      { key: "collections", name: "Agente de Cobranza", status: "NOT_ENABLED", statusLabel: "No habilitado", statusDetail: "Sin canal", description: "Cobranza futura.", limitation: "No envía mensajes.", externalContact: "BLOCKED", autonomousActions: false },
    ],
    conditions, rules,
    simulation: { mode: "NO_SEND", generatedAt: "2026-11-04T12:00:00.000Z", notice: "La simulación es de solo lectura: no crea alertas, no envía comunicaciones y no cambia registros reales.", executions: rules.filter((rule) => rule.active).map((rule) => ({ ruleId: rule.id, ruleKey: rule.key, title: rule.title, matched: rule.matched, evidence: rule.evidence, wouldPrepareInternalAlert: Boolean(rule.matched), externalContact: false, stateChanges: false, notice: rule.matched ? "Se prepararían alertas internas para revisión. No se enviará ningún mensaje ni se modificarán estados." : "No se detectaron coincidencias." })) },
    triggeredAlerts: [{ id: "alert-1", title: "Ficha pendiente de imagen", priority: "HIGH", detail: "Falta evidencia visual antes de publicación.", source: "broker_automation_scan", requiresHumanApproval: true, createdAt: "2026-11-04T10:00:00.000Z", href: "/realty?view=broker_os&tab=operations&propertyId=property-1" }],
  };
}

function overview() {
  return { kpis: { properties: 1, activeOperations: 0, scheduledVisits: 0, openAlerts: 1, activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0 }, properties: [], operations: [], recommendations: [], agents: [], reporting: { portfolioValue: 0, projectedCommission: 0, propertyCompleteness: 0, portfolioHealth: 0, propertiesReady: 0, byOperationType: [], aiEvaluations: { total: 0, confirmed: 0, needsAdjustment: 0, pending: 0 } }, aiTraining: { scenarios: [], evaluations: [], automationRules: [] } };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ session }) => { localStorage.setItem("inbox_session", JSON.stringify(session)); document.cookie = `inbox_session=${encodeURIComponent(JSON.stringify(session))};path=/`; }, { session: user });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/api/, "");
      if (url.origin === frontendUrl && !url.pathname.startsWith("/api/")) return route.continue();
      const headers = { "access-control-allow-origin": frontendUrl, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
      const send = (body, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (endpoint === "/auth/me") return send({ user, tenant: { id: user.tenantId, name: "Broker QA", industry: "REAL_ESTATE" }, modules });
      if (endpoint === "/modules/me") return send({ modules, industry: "REAL_ESTATE", role: "OWNER" });
      if (endpoint === "/broker/access/me") return send(access);
      if (endpoint === "/broker/overview") return send(overview());
      if (endpoint === "/broker/catalog") return send({ areas: {}, recordDefinitions: {}, agents: [], aiScenarios: [], automationRules: [], roleTemplates: [], sopLibrary: [], financingStages: [], operationStages: { SALE: [], RENTAL: [], ADMINISTRATION: [] }, operationChecklists: {} });
      if (endpoint === "/broker/operations") return send([]);
      if (endpoint === "/broker/operation-assignees") return send({ users: [] });
      if (endpoint === "/broker/ai-governance" && route.request().method() === "GET") return send(governance());
      if (endpoint === "/broker/ai-governance/simulate" && route.request().method() === "POST") return send(governance());
      if (endpoint === "/broker/ai-governance/rules" && route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        const rule = { id: "custom-1", key: "qa-prioridad", kind: "CUSTOM", editable: true, active: true, title: input.title, description: input.description || "", trigger: conditions.find((item) => item.key === input.conditionKey)?.label || "", action: "Preparar una alerta interna para revisión humana.", approval: "Requiere una persona autorizada.", conditionKey: input.conditionKey, conditionLabel: conditions.find((item) => item.key === input.conditionKey)?.label || "", autonomy: "HUMAN_APPROVAL", autonomyLabel: "Solo análisis", externalContact: "BLOCKED", externalContactLabel: "Contacto externo bloqueado", simulator: "NO_SEND", simulatorLabel: "Simulador sin envío", stateChanges: false, matched: 1, evidence: [{ id: "operation-1", title: "Negociación QA", detail: "Sin seguimiento", priority: "MEDIUM", propertyId: null, operationId: "operation-1" }] };
        customRules = [rule];
        return send({ rule, notice: "Regla creada. Solo puede preparar alertas internas dentro del simulador; no ejecuta acciones reales." }, 201);
      }
      if (endpoint === "/broker/ai-governance/rules/custom-1" && route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        customRules = customRules.map((rule) => ({ ...rule, active: input.isActive }));
        return send({ rule: customRules[0], notice: "Regla actualizada y registrada en la bitácora. Sus límites de seguridad no pueden modificarse." });
      }
      if (/notification|alerts|alertas/.test(endpoint)) return send({ items: [], notifications: [], unreadCount: 0 });
      return send([]);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 10000));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${frontendUrl}/realty?view=broker_os&tab=ai_governance`);
    await page.getByRole("heading", { name: "Reglas configurables con límites verificables", exact: true }).waitFor();
    await page.getByRole("button", { name: "Simular reglas sin envío", exact: true }).click();
    await page.getByText("Simulación completada. No se creó una alerta, no se contactó a nadie y no se modificó ningún registro.", { exact: true }).waitFor();
    await page.getByLabel("Nombre de la regla").fill("Priorizar fichas QA");
    await page.getByLabel("Condición").selectOption("PROPERTY_INCOMPLETE");
    await page.getByRole("button", { name: "Crear regla segura", exact: true }).click();
    await page.getByRole("heading", { name: "Priorizar fichas QA", exact: true }).waitFor();
    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await page.getByRole("button", { name: "Activar", exact: true }).waitFor();
    assert.deepEqual(errors, [], "Gobierno IA no debe producir errores JavaScript.");
    await page.screenshot({ path: path.join(output, "gobierno-ia-broker-escritorio.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "purple"; document.documentElement.dataset.designSystem = "dark"; });
    assert.equal(await page.locator(".broker-ai-governance").evaluate((element) => element.scrollWidth <= element.clientWidth + 2), true, "Gobierno IA debe caber en móvil.");
    await page.screenshot({ path: path.join(output, "gobierno-ia-broker-movil-oscuro.png"), fullPage: true });
    console.log("QA Gobierno IA Broker OS: simulación, regla segura, trazabilidad y móvil OK. API simulada; sin producción.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

