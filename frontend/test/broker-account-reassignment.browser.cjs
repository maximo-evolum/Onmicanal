/** Archivo: Valida en navegador los permisos granulares y la reasignación masiva con una API aislada. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendUrl = (process.env.BROKER_WEB_URL || "http://localhost:3001").replace(/\/$/, "");
const output = path.resolve(process.env.QA_OUTPUT || "");

if (!output.startsWith(path.resolve("E:/Entregables_EVOLUM_OS") + path.sep)) {
  throw new Error("QA_OUTPUT debe estar fuera del proyecto, dentro de Entregables_EVOLUM_OS.");
}

const actions = ["VIEW", "CREATE", "EDIT", "DELETE", "IMPORT", "EXPORT", "APPROVE", "REJECT", "ASSIGN", "REASSIGN", "CONFIGURE"];
const user = { id: "qa-bulk-admin", tenantId: "qa-bulk-broker", name: "Jefatura QA", email: "jefatura.qa@example.invalid", role: "OWNER" };
const access = { businessRole: "CEO", profileLabel: "Dirección general", profileKind: "SYSTEM", accessScope: "COMPANY", requestedScope: "COMPANY", teamKey: null, branchKey: null, technicalRole: "OWNER", holding: null, scopeDescription: "Toda la empresa", policy: { label: "Dirección general", defaultScope: "COMPANY", actions: { "*": actions } } };
const workspaces = [{ key: "CARTERA", label: "Cartera y operaciones", areas: ["overview", "operations", "commercial"] }];
const systemProfiles = [{ key: "CORREDOR", label: "Corredor", defaultScope: "ASSIGNED", kind: "SYSTEM", actions: { overview: ["VIEW"], operations: ["VIEW", "CREATE", "EDIT"], commercial: ["VIEW", "CREATE", "EDIT"] } }];
const team = [
  { id: "qa-bulk-admin", name: "Jefatura QA", email: "jefatura.qa@example.invalid", role: "OWNER", jobTitle: "Jefatura", isActive: true, profile: { businessRole: "CEO", accessScope: "COMPANY", teamKey: null, branchKey: null, customProfileId: null }, workload: { properties: 5, operations: 3, visits: 1, pending: 4, score: 23 } },
  { id: "qa-bulk-target", name: "Corredora de reemplazo", email: "reemplazo.qa@example.invalid", role: "SELLER", jobTitle: "Corredora", isActive: true, profile: { businessRole: "CORREDOR", accessScope: "COMPANY", teamKey: null, branchKey: null, customProfileId: "qa-profile" }, workload: { properties: 2, operations: 1, visits: 0, pending: 2, score: 9 } }
];
const account = {
  version: "BROKER_ACCOUNT_V1",
  account: { id: user.tenantId, name: "Broker QA", slug: "broker-qa", plan: { code: "BUSINESS", name: "Business", description: "QA" }, limits: { users: 10, messagesMonthly: 1000 }, team: { active: 2, inactive: 0, remaining: 8 } },
  modules: { active: [{ module: "properties", label: "Propiedades", source: "PLAN", enabled: true }], inactive: [], retention: { dataPreserved: true, message: "Los datos se conservan." } },
  workload: { generatedAt: "2026-11-19T12:00:00.000Z", summary: { activeUsers: 2, inactiveUsers: 0, unassigned: { properties: 0, operations: 0, visits: 0, pending: 0 }, totalWorkload: 32 }, members: team.map((member) => ({ ...member, canReceivePortfolio: true })), suggestedAssignee: { id: "qa-bulk-target", name: "Corredora de reemplazo", score: 9, reason: "Menor carga" }, unassignedProperties: [] },
  externalReadiness: []
};

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(({ session }) => {
      localStorage.setItem("inbox_session", JSON.stringify(session));
      document.cookie = `inbox_session=${encodeURIComponent(JSON.stringify(session))};path=/`;
    }, { session: user });
    let commitCount = 0;
    let savedProfile = null;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/api/, "");
      if (url.origin === frontendUrl && !url.pathname.startsWith("/api/")) return route.continue();
      const headers = { "access-control-allow-origin": frontendUrl, "access-control-allow-credentials": "true", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET,PATCH,POST,PUT,OPTIONS" };
      const send = (body, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (endpoint === "/auth/me") return send({ user, tenant: { id: user.tenantId, name: "Broker QA", industry: "REAL_ESTATE" }, modules: ["properties", "brokers", "realty_clients"] });
      if (endpoint === "/modules/me") return send({ modules: ["properties", "brokers", "realty_clients"], industry: "REAL_ESTATE", role: "OWNER" });
      if (endpoint === "/broker/access/me") return send(access);
      if (endpoint === "/broker/overview") return send({ properties: [], operations: [], recommendations: [], reporting: {}, aiTraining: { scenarios: [], evaluations: [], automationRules: [] } });
      if (endpoint === "/broker/catalog") return send({ areas: {}, recordDefinitions: {}, agents: [], aiScenarios: [], automationRules: [], roleTemplates: [], sopLibrary: [], financingStages: [], operationStages: { SALE: [], RENTAL: [], ADMINISTRATION: [] }, operationChecklists: {} });
      if (endpoint === "/broker/operations") return send([]);
      if (endpoint === "/broker/account") return send(account);
      if (endpoint === "/broker/access/team") return send({ users: team });
      if (endpoint === "/broker/access/profiles" && route.request().method() === "GET") return send({ workspaces, systemProfiles, customProfiles: [{ id: "qa-profile", name: "Corredor restringido", description: "Perfil de demostración", baseRole: "CORREDOR", accessScope: "ASSIGNED", workspaceKeys: ["CARTERA"], agentKeys: [], actions: { overview: ["VIEW"], operations: ["VIEW", "EDIT"], commercial: ["VIEW"] }, kind: "CUSTOM", assignedUserCount: 1, canDelete: false, updatedAt: "2026-11-19T12:00:00.000Z" }] });
      if (endpoint === "/broker/access/profiles/qa-profile" && route.request().method() === "PATCH") { savedProfile = route.request().postDataJSON(); return send({ profile: { id: "qa-profile" } }); }
      if (endpoint === "/broker/access/reassignments/candidates") return send({ recordType: "property", label: "Propiedades", records: [{ id: "qa-property-1", title: "Casa Los Castaños", status: "ACTIVE", assignedTo: { id: "qa-bulk-admin", name: "Jefatura QA" }, updatedAt: "2026-11-19T12:00:00.000Z" }, { id: "qa-property-2", title: "Departamento Parque Sur", status: "ACTIVE", assignedTo: null, updatedAt: "2026-11-19T12:00:00.000Z" }] });
      if (endpoint === "/broker/access/reassignments/preview" && route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        return send({ recordType: body.recordType, label: "Propiedades", resource: "commercial", reason: body.reason, assignee: { id: body.assignedToId, name: "Corredora de reemplazo", score: 9 }, requestedCount: body.recordIds.length, changeCount: body.recordIds.length, unchangedCount: 0, items: body.recordIds.map((id) => ({ id, title: id === "qa-property-1" ? "Casa Los Castaños" : "Departamento Parque Sur", status: "ACTIVE", previousAssignee: null, previousAssigneeId: null, updatedAt: "2026-11-19T12:00:00.000Z", unchanged: false })), snapshot: body.recordIds.map((id) => ({ id, updatedAt: "2026-11-19T12:00:00.000Z" })) });
      }
      if (endpoint === "/broker/access/reassignments/commit" && route.request().method() === "POST") { commitCount += 1; const body = route.request().postDataJSON(); return send({ recordType: body.recordType, reassigned: body.recordIds.length, assignee: { id: body.assignedToId, name: "Corredora de reemplazo" }, records: body.recordIds.map((id) => ({ id, title: id, previousAssigneeId: null })), notice: `${body.recordIds.length} propiedades se reasignaron con trazabilidad.` }); }
      if (/notification|alerts|alertas/.test(endpoint)) return send({ items: [], notifications: [], unreadCount: 0 });
      return send([]);
    });

    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.PLAYWRIGHT_TIMEOUT_MS || 10000));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`${frontendUrl}/realty?view=broker_os&tab=account`);
    await page.getByRole("heading", { name: "Equipo, perfiles y capacidades de la empresa", exact: true }).waitFor();
    await page.getByText("Permisos por área y acción", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Cargar cartera", exact: true }).click();
    await page.getByText("Casa Los Castaños", { exact: true }).waitFor();
    await page.getByLabel("Casa Los Castaños", { exact: false }).check();
    await page.getByLabel("Nuevo responsable").selectOption("qa-bulk-target");
    await page.getByLabel("Motivo de la reasignación").fill("Cobertura operativa por ausencia programada.");
    await page.getByRole("button", { name: "Generar vista previa", exact: true }).click();
    await page.getByText("Confirmación requerida", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Confirmar reasignación auditada", exact: true }).click();
    await page.getByText("1 propiedades se reasignaron con trazabilidad.", { exact: true }).waitFor();
    assert.equal(commitCount, 1, "La confirmación debe realizar una sola escritura masiva.");
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByLabel("Confirmo que revisé el cambio de permisos para las 1 persona(s) que usan este perfil.").check();
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(savedProfile?.confirmAssignedUsers, true, "El perfil en uso debe requerir confirmación explícita antes de cambiar su matriz.");
    assert.ok(Array.isArray(savedProfile?.actionOverrides?.commercial), "La matriz debe enviar acciones por área al backend.");
    assert.deepEqual(errors, [], "La pantalla de permisos y reasignación no debe producir errores JavaScript.");
    await page.screenshot({ path: path.join(output, "cuenta-broker-permisos-y-reasignacion.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Redistribuir cartera con vista previa", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".broker-bulk-reassignment").evaluate((element) => element.scrollWidth <= element.clientWidth + 2), true, "La reasignación masiva debe caber en móvil.");
    await page.screenshot({ path: path.join(output, "cuenta-broker-reasignacion-movil.png"), fullPage: true });
    console.log("QA cuenta Broker: matriz restrictiva, confirmación de perfil en uso, vista previa y reasignación masiva OK. API simulada; sin producción.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
