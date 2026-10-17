/** Archivo: Implementa reglas de negocio y procesos del dominio broker record access. */
import { BROKER_RECORD_AREAS } from "./broker-workflows.service.js";
import { brokerAssigneeAllowed, brokerRecordWhere, canBrokerAction, loadBrokerAccessContext } from "./broker-access.service.js";

export const BROKER_RECORD_RESOURCES = Object.freeze({
  ...Object.fromEntries(Object.entries(BROKER_RECORD_AREAS).flatMap(([area, types]) => types.map(type => [type, area]))),
  property: "commercial", property_import: "commercial", owner: "commercial", customer: "commercial",
  broker_profile: "access", property_training: "ai", seller_assignment: "commercial",
  broker_operation: "operations", visit: "commercial", realty_alert: "overview", broker_followup: "commercial",
  broker_agent_evaluation: "ai", commission_distribution: "commissions", commission_settlement: "commissions",
  lead: "commercial", deal: "operations", forecast: "ai", ai_interaction: "ai",
  commission_policy: "configuration", administration_liquidation: "administration",
});
export const BROKER_RECORD_TYPES_WITH_ACCESS = Object.freeze(Object.keys(BROKER_RECORD_RESOURCES));
const SHARED_TYPES = new Set(["visit", "commission_distribution", "lead", "deal", "forecast", "ai_interaction"]);
export function brokerResource(req, type) {
  if (SHARED_TYPES.has(type) && req.tenant?.industry !== "REAL_ESTATE") return null;
  return BROKER_RECORD_RESOURCES[type] || null;
}
export function brokerInternalRecord(type) {
  return /^(broker_|realty_)/.test(type || "") && !BROKER_RECORD_RESOURCES[type];
}
export function brokerGenericRecordAllowed(req, type, action) {
  if (brokerInternalRecord(type)) return false;
  const resource = brokerResource(req, type);
  if (!resource) return true;
  // Perfiles de identidad, reparto y evaluaciones se modifican en su flujo auditado.
  if (action !== "VIEW" && ["broker_profile", "seller_assignment", "broker_agent_evaluation"].includes(type)) return false;
  return canBrokerAction(req.brokerAccess, resource, action);
}
export function brokerGenericWhere(req, extra = {}) {
  const protectedTypes = BROKER_RECORD_TYPES_WITH_ACCESS.filter(type => brokerResource(req, type));
  const visibleTypes = protectedTypes.filter(type => brokerGenericRecordAllowed(req, type, "VIEW"));
  return { AND: [
    { tenantId: req.tenantId }, extra,
    { OR: [
      { AND: [{ recordType: { notIn: protectedTypes } }, { NOT: [{ recordType: { startsWith: "broker_" } }, { recordType: { startsWith: "realty_" } }] }] },
      brokerRecordWhere({ ...req, method: "POST" }, { recordType: { in: req.brokerAccess ? visibleTypes : [] } }),
    ] },
  ] };
}

// Se ejecuta antes de los handlers genéricos; no altera los permisos de Finanzas.
export function brokerGenericAccessMiddleware(prisma) {
  return async (req, res, next) => {
    if (!/^\/industry-records(?:\/|$)/i.test(req.path)) return next();
    try {
      const path = req.path.replace(/\/+$/, "");
      const normalizedPath = path.toLowerCase();
      const isList = ["GET", "HEAD"].includes(req.method) && normalizedPath === "/industry-records";
      const isUsers = ["GET", "HEAD"].includes(req.method) && normalizedPath === "/industry-records/users";
      const isTeamManagement = /^\/industry-records\/brokers(?:\/[^/]+)?$/i.test(path);
      const isBalance = normalizedPath === "/industry-records/assignments/balance";
      const match = path.match(/^\/industry-records\/([^/]+)(?:\/metadata)?$/i);
      const existing = match && ["PATCH", "DELETE"].includes(req.method) && !isTeamManagement
        ? await prisma.industryRecord.findFirst({ where: { id: decodeURIComponent(match[1]), tenantId: req.tenantId } }) : null;
      const type = String(existing?.recordType || req.query?.type || req.body?.recordType || (req.method === "POST" ? "property" : "")).trim().toLowerCase().replace(/\s+/g, "_");
      const resource = brokerResource(req, type);
      if (brokerInternalRecord(type)) return res.status(403).json({ error: "Este registro se administra desde Roles y accesos o su flujo específico de Broker OS." });
      if (!isList && !isTeamManagement && !resource && !(isUsers && req.tenant?.industry === "REAL_ESTATE")) return next();
      req.brokerAccess = await loadBrokerAccessContext({ prisma, tenantId: req.tenantId, user: req.user });
      if (isTeamManagement) {
        if (!canBrokerAction(req.brokerAccess, "access", "CONFIGURE")) return res.status(403).json({ error: "No tienes permiso para administrar el equipo de Broker OS." });
        return next();
      }
      if (isUsers) return next();
      const action = isBalance ? "ASSIGN" : ({ GET: "VIEW", HEAD: "VIEW", POST: "CREATE", PATCH: "EDIT", DELETE: "DELETE" })[req.method];
      if (type && !brokerGenericRecordAllowed(req, type, action)) return res.status(403).json({ error: "Tu perfil no permite esta acción en Broker OS.", action });
      if (existing && resource) {
        const visible = await prisma.industryRecord.findFirst({ where: brokerRecordWhere(req, { id: existing.id }) });
        if (!visible) return res.status(404).json({ error: "Registro no encontrado en tu alcance." });
      }
      if (resource && ["POST", "PATCH"].includes(req.method) && !isBalance) {
        const metadata = req.body?.metadata ?? req.body?.data ?? {};
        const explicit = req.body?.assignedToId;
        const assigned = explicit === undefined ? existing?.assignedToId ?? req.user.id : explicit || null;
        const changed = existing ? assigned !== existing.assignedToId : assigned !== req.user.id;
        if ((changed && !canBrokerAction(req.brokerAccess, resource, existing ? "REASSIGN" : "ASSIGN")) || (assigned && !brokerAssigneeAllowed(req.brokerAccess, assigned))) {
          return res.status(403).json({ error: "No puedes asignar registros fuera de tu permiso o alcance." });
        }
        for (const key of ["assignedBrokerId", "captureBrokerId"]) {
          if (metadata[key] !== undefined && metadata[key] !== (existing?.data?.[key] || assigned) && !canBrokerAction(req.brokerAccess, resource, "ASSIGN")) return res.status(403).json({ error: "No puedes cambiar el responsable mediante los metadatos." });
        }
        if (metadata.propertyId) {
          const property = await prisma.industryRecord.findFirst({ where: brokerRecordWhere(req, { id: String(metadata.propertyId), recordType: "property" }) });
          if (!property) return res.status(404).json({ error: "La propiedad no pertenece a tu alcance." });
        }
        if (!existing && explicit === undefined) req.body.assignedToId = assigned;
      }
      return next();
    } catch (error) { next(error); }
  };
}
