/** Archivo: Resume cuenta, carga de equipo y continuidad de datos para la configuración de Broker OS. */

const CLOSED_STATUSES = new Set(["ARCHIVED", "CLOSED", "CANCELLED", "CANCELADO", "COMPLETED", "COMPLETADO", "RESOLVED", "RESUELTO", "ENDED", "FINALIZADO"]);

const MODULE_LABELS = Object.freeze({
  properties: "Propiedades", property_assignments: "Asignación de cartera", realty_loads: "Captación e importación", realty_activity: "Visitas y seguimiento", broker_portal: "Portal y publicaciones", brokers: "Equipo de corredores", realty_clients: "Compradores y matching",
  documents: "Documentos", inbox: "Chats", agenda: "Agenda", campaigns: "Campañas", marketing: "Marketing", analytics: "Analítica", ai_ops: "IA Ops", integrations: "Centro de conexiones", offline_sync: "Sincronización offline", security_replica: "Réplica de seguridad"
});

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function isOpen(record) {
  return !CLOSED_STATUSES.has(String(record?.status || "").toUpperCase());
}

export function brokerModuleLabel(module) {
  const key = String(module || "").trim();
  return MODULE_LABELS[key] || key.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

/**
 * Entrega una carga transparente, no una asignación automática. El botón que
 * usa la recomendación debe ser accionado por una jefatura autorizada y queda
 * auditado en la ruta.
 */
export function buildBrokerTeamWorkload({ users = [], records = [], profilesByUser = new Map(), canOperate = () => false } = {}) {
  const activeUsers = users.filter((user) => user.isActive);
  const brokerRecords = records.filter((record) => ["property", "broker_operation", "visit"].includes(String(record.recordType)) || String(record.recordType).startsWith("broker_") || String(record.recordType).endsWith("_case") || String(record.recordType).includes("maintenance") || String(record.recordType).includes("rental"));
  const assignmentCounts = new Map(activeUsers.map((user) => [String(user.id), { properties: 0, operations: 0, visits: 0, pending: 0 }]));
  const unassigned = { properties: 0, operations: 0, visits: 0, pending: 0 };
  const unassignedProperties = [];

  for (const record of brokerRecords) {
    const type = String(record.recordType || "");
    const target = record.assignedToId ? assignmentCounts.get(String(record.assignedToId)) : null;
    const bucket = type === "property" ? "properties" : type === "broker_operation" ? "operations" : type === "visit" ? "visits" : "pending";
    if (target) {
      target[bucket] += 1;
      if (bucket !== "pending" && isOpen(record)) target.pending += 1;
    } else if (!record.assignedToId) {
      unassigned[bucket] += 1;
      if (bucket !== "pending" && isOpen(record)) unassigned.pending += 1;
      if (type === "property" && unassignedProperties.length < 50) {
        unassignedProperties.push({ id: record.id, title: String(record.title || dataOf(record).address || "Propiedad sin título") });
      }
    }
  }

  const members = users.map((user) => {
    const counts = assignmentCounts.get(String(user.id)) || { properties: 0, operations: 0, visits: 0, pending: 0 };
    // La ponderación favorece que una operación abierta se distribuya antes
    // que una visita ya cerrada; no reemplaza el criterio de la jefatura.
    const score = counts.properties * 2 + counts.operations * 3 + counts.visits + counts.pending * 2;
    const profile = profilesByUser.get(String(user.id)) || null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      jobTitle: user.jobTitle || null,
      isActive: Boolean(user.isActive),
      profile,
      workload: { ...counts, score },
      canReceivePortfolio: Boolean(user.isActive && canOperate(profile, user))
    };
  });

  const eligible = members.filter((member) => member.canReceivePortfolio).sort((left, right) => left.workload.score - right.workload.score || left.name.localeCompare(right.name, "es"));
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeUsers: members.filter((member) => member.isActive).length,
      inactiveUsers: members.filter((member) => !member.isActive).length,
      unassigned,
      totalWorkload: members.reduce((total, member) => total + member.workload.score, 0)
    },
    members,
    unassignedProperties,
    suggestedAssignee: eligible[0] ? {
      id: eligible[0].id,
      name: eligible[0].name,
      score: eligible[0].workload.score,
      reason: "Menor carga ponderada entre los perfiles activos autorizados para operar cartera. Requiere confirmación humana."
    } : null
  };
}

export function buildBrokerAccountSnapshot({ tenant, plan, limits = {}, modules = [], users = [], workload, externalReadiness = [] } = {}) {
  const activeModules = modules.filter((module) => module.enabled).map((module) => ({ module: module.module, label: brokerModuleLabel(module.module), source: module.source || "PLAN", enabled: true }));
  const inactiveModules = modules.filter((module) => !module.enabled).map((module) => ({ module: module.module, label: brokerModuleLabel(module.module), source: module.source || "MANUAL", enabled: false }));
  const activeUsers = users.filter((user) => user.isActive).length;
  const userLimit = limits?.users === undefined ? null : limits.users;
  return {
    version: "BROKER_ACCOUNT_V1",
    account: {
      id: tenant?.id || null,
      name: tenant?.name || "Empresa Broker",
      slug: tenant?.slug || null,
      plan: { code: plan?.code || tenant?.plan || "STARTER", name: plan?.name || "Plan vigente", description: plan?.description || "" },
      limits: { users: userLimit, messagesMonthly: limits?.messagesMonthly ?? null },
      team: { active: activeUsers, inactive: Math.max(0, users.length - activeUsers), remaining: userLimit === null ? null : Math.max(0, Number(userLimit) - activeUsers) }
    },
    modules: { active: activeModules, inactive: inactiveModules, retention: {
      dataPreserved: true,
      message: "Deshabilitar un módulo bloquea su acceso operativo, pero no elimina propiedades, expedientes, operaciones ni evidencias ya registradas. Su reactivación conserva el historial del tenant."
    } },
    workload: workload || null,
    externalReadiness: externalReadiness.map((item) => ({ key: item.key, label: item.label, category: item.category, status: item.status, description: item.description })),
    generatedAt: new Date().toISOString()
  };
}
