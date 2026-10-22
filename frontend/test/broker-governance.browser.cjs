/** Archivo: Valida en navegador el gobierno de Broker OS con una API aislada y sin producción. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendUrl = (process.env.BROKER_WEB_URL || "http://localhost:3001").replace(/\/$/, "");
const output = path.resolve(process.env.QA_OUTPUT || "");

if (!output.startsWith(path.resolve("E:/Entregables_EVOLUM_OS") + path.sep)) {
  throw new Error("QA_OUTPUT debe estar fuera del proyecto, dentro de Entregables_EVOLUM_OS.");
}

const allActions = ["VIEW", "CREATE", "EDIT", "DELETE", "IMPORT", "EXPORT", "APPROVE", "REJECT", "ASSIGN", "REASSIGN", "CONFIGURE"];
const user = { id: "qa-admin", tenantId: "qa-broker", name: "Administradora QA", email: "admin.qa@example.invalid", role: "OWNER" };
const modules = ["properties", "realty_loads", "brokers", "realty_activity", "broker_portal", "realty_clients"];
const access = { businessRole: "CEO", profileLabel: "Dirección general", accessScope: "COMPANY", requestedScope: "COMPANY", teamKey: null, branchKey: null, technicalRole: "OWNER", holding: null, scopeDescription: "Registros de toda la empresa", policy: { label: "Dirección general", defaultScope: "COMPANY", actions: { "*": allActions } } };

let governance = {
  summary: { openAlerts: 1, highPriorityAlerts: 1, resolvedLast30Days: 1, activityLast30Days: 2, totalAuditedEvents: 2 },
  alerts: [
    { id: "alert-open", title: "Mandato pendiente de evidencia", status: "OPEN", priority: "HIGH", area: "commercial", detail: "Falta confirmar la referencia documental antes de avanzar.", propertyId: "qa-property", operationId: null, requiresHumanApproval: true, createdAt: "2026-10-21T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z", resolvedAt: null, resolvedBy: null, resolutionNote: null },
    { id: "alert-resolved", title: "Ficha revisada", status: "RESOLVED", priority: "LOW", area: "commercial", detail: "La ficha fue completada.", propertyId: "qa-property", operationId: null, requiresHumanApproval: false, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-21T11:00:00.000Z", resolvedAt: "2026-10-21T11:00:00.000Z", resolvedBy: "Administradora QA", resolutionNote: "Antecedente validado con la propietaria." }
  ],
  recentActivity: [
    { id: "audit-1", action: "BROKER_OPERATION_EVENT_RECORDED", entity: "broker_operation", entityId: "qa-operation", createdAt: "2026-10-21T09:00:00.000Z", actor: { id: user.id, name: user.name, email: user.email }, metadata: { note: "Antecedente revisado", propertyId: "qa-property" } },
    { id: "audit-2", action: "BROKER_ALERT_RESOLVED", entity: "realty_alert", entityId: "alert-resolved", createdAt: "2026-10-21T11:00:00.000Z", actor: { id: user.id, name: user.name, email: user.email }, metadata: { nextStatus: "RESOLVED" } }
  ],
  actionCounts: [{ action: "BROKER_ALERT_RESOLVED", total: 1 }]
};

function overview() {
  return { kpis: { properties: 1, activeOperations: 0, scheduledVisits: 0, openAlerts: governance.summary.openAlerts, activeRentals: 0, openMaintenance: 0, openPostSale: 0, activeFinancing: 0 }, properties: [], operations: [], recommendations: [], agents: [], reporting: { portfolioValue: 0, projectedCommission: 0, propertyCompleteness: 0, portfolioHealth: 0, propertiesReady: 0, byOperationType: [], aiEvaluations: { total: 0, confirmed: 0, needsAdjustment: 0, pending: 0 } }, aiTraining: { scenarios: [], evaluations: [], automationRules: [] } };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(({ session }) => {
      localStorage.setItem("inbox_session", JSON.stringify(session));
      document.cookie = `inbox_session=${encodeURIComponent(JSON.stringify(session))};path=/`;
    }, { session: user });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/api/, "");
      if (url.origin === frontendUrl && !url.pathname.startsWith("/api/")) return route.continue();
      const headers = { "access-control-allow-origin": frontendUrl, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET,PATCH,POST,OPTIONS" };
      const send = (body, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (endpoint === "/auth/me") return send({ user, tenant: { id: user.tenantId, name: "Broker QA", industry: "REAL_ESTATE" }, modules });
      if (endpoint === "/modules/me") return send({ modules, industry: "REAL_ESTATE", role: "OWNER" });
      if (endpoint === "/broker/access/me") return send(access);
      if (endpoint === "/broker/overview") return send(overview());
      if (endpoint === "/broker/catalog") return send({ areas: {}, recordDefinitions: {}, agents: [], aiScenarios: [], automationRules: [], roleTemplates: [], sopLibrary: [], financingStages: [], operationStages: { SALE: [], RENTAL: [], ADMINISTRATION: [] }, operationChecklists: {} });
      if (endpoint === "/broker/operations") return send([]);
      if (endpoint === "/broker/configuration") return send({ policy: { sales: { sellerCommissionPct: 0, buyerCommissionPct: 0, brokerSplitPct: 0, companySplitPct: 0 }, rentalPlacement: { landlordMonths: 0, tenantMonths: 0, withholdingRatePct: null }, administration: { tiers: [], ownerPaymentDay: 1 }, slas: { firstLeadContactMinutes: 1, propertyPublicationHours: 1, legalReviewHours: 1, criticalIncidentHours: 1 }, financing: { interestRatePct: null, riskThreshold: null, requiresHumanApproval: true, automaticDisbursement: false } } });
      if (endpoint === "/broker/legal-readiness") return send({ summary: { GRANTED: 0, PENDING: 0, REVOKED: 0, EXPIRED: 0 }, providers: [], consents: [] });
      if (endpoint === "/broker/access/team") return send({ users: [] });
      if (endpoint === "/broker/governance" && route.request().method() === "GET") return send(governance);
      if (endpoint === "/broker/alerts/alert-open/resolve" && route.request().method() === "PATCH") {
        const note = String(route.request().postDataJSON()?.note || "").trim();
        if (note.length < 3) return send({ error: "Motivo requerido" }, 422);
        const at = "2026-10-22T12:00:00.000Z";
        governance = { ...governance, summary: { ...governance.summary, openAlerts: 0, highPriorityAlerts: 0, resolvedLast30Days: 2, activityLast30Days: 3, totalAuditedEvents: 3 }, alerts: governance.alerts.map((alert) => alert.id === "alert-open" ? { ...alert, status: "RESOLVED", resolvedAt: at, resolvedBy: user.name, resolutionNote: note, updatedAt: at } : alert), recentActivity: [{ id: "audit-3", action: "BROKER_ALERT_RESOLVED", entity: "realty_alert", entityId: "alert-open", createdAt: at, actor: { id: user.id, name: user.name, email: user.email }, metadata: { nextStatus: "RESOLVED" } }, ...governance.recentActivity] };
        return send({ id: "alert-open", status: "RESOLVED" });
      }
      if (/notification|alerts|alertas/.test(endpoint)) return send({ items: [], notifications: [], unreadCount: 0 });
      return send([]);
    });

    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 10000));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${frontendUrl}/realty?view=broker_os&tab=governance`);
    await page.getByRole("heading", { name: "Alertas, trazabilidad y control administrativo", exact: true }).waitFor();
    await page.getByText("Mandato pendiente de evidencia", { exact: true }).waitFor();
    await page.getByPlaceholder("Describe qué se revisó y cómo se resolvió").fill("Evidencia validada con la propietaria y archivada en el expediente.");
    await page.getByRole("button", { name: "Resolver con trazabilidad", exact: true }).click();
    await page.getByText("Alerta resuelta y registrada en la bitácora. No se ejecutó ninguna acción externa.", { exact: true }).waitFor();
    await page.getByText("Evidencia validada con la propietaria y archivada en el expediente.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Alertas abiertas", { exact: true }).count(), 1);
    assert.deepEqual(errors, [], "El panel de gobierno no debe producir errores JavaScript.");
    await page.screenshot({ path: path.join(output, "gobierno-broker-escritorio.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "purple"; document.documentElement.dataset.designSystem = "dark"; });
    await page.getByRole("heading", { name: "Alertas, trazabilidad y control administrativo", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".broker-governance-panel").evaluate((element) => element.scrollWidth <= element.clientWidth + 2), true, "El panel de gobierno debe caber en móvil.");
    await page.screenshot({ path: path.join(output, "gobierno-broker-movil-oscuro.png"), fullPage: true });
    console.log("QA gobierno Broker OS: permisos de administrador, alerta, motivo, bitácora y móvil OK. API simulada; sin producción.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
