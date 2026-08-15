import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { recordAuditLog } from "../lib/audit.js";
import {
  BROKER_RECORD_AREAS,
  BROKER_RECORD_TYPES,
  BROKER_RECORD_DEFINITIONS,
  BROKER_AGENT_CATALOG,
  SALE_STAGES,
  isBrokerRecordArea,
  normalizeBrokerOperationType,
  stagesForBrokerOperation,
  validateBrokerStageTransition,
  validateBrokerRecord
} from "../services/broker-workflows.service.js";

export const brokerRouter = Router();

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function brokerWhere(req, extra = {}) {
  return { tenantId: req.tenantId, ...extra };
}

function operationPayload(record) {
  const data = dataOf(record);
  const operationType = normalizeBrokerOperationType(data.operationType) || "SALE";
  const stages = stagesForBrokerOperation(operationType);
  return {
    ...record,
    data: {
      ...data,
      operationType,
      stage: text(data.stage, stages[0]),
      timeline: Array.isArray(data.timeline) ? data.timeline : []
    }
  };
}

const BROKER_AGENT_MODULES = Object.freeze({
  commercial: "pipeline",
  marketing: "campaigns",
  analytics: "dashboard",
  legal: "documents",
  documental: "documents",
  maintenance: "realty_activity",
  finance: "payments",
  collections: "payments",
  inspection: "realty_activity",
  administration: "broker_portal",
  architect: "realty_loads",
  crm: "inbox",
  customer_care: "inbox"
});

function brokerAgentPayload(agent) {
  return {
    key: agent.key,
    name: agent.label,
    status: agent.status,
    module: BROKER_AGENT_MODULES[agent.key] || "properties",
    description: agent.scope
  };
}

function missingPropertyData(property) {
  const data = dataOf(property);
  const missing = [];
  if (!text(data.price)) missing.push("precio");
  if (!text(data.address)) missing.push("dirección");
  if (!text(data.commune)) missing.push("comuna");
  if (!text(data.photoUrl) && !(Array.isArray(data.gallery) && data.gallery.length)) missing.push("foto principal");
  return missing;
}

function brokerRecommendations({ properties, operations, maintenance, postSale, financing }) {
  const recommendations = [];
  for (const property of properties) {
    const missing = missingPropertyData(property);
    if (missing.length) {
      recommendations.push({
        id: `property-${property.id}-completion`,
        priority: missing.includes("foto principal") ? "MEDIUM" : "HIGH",
        area: "commercial",
        title: `Completar ficha: ${property.title}`,
        detail: `Faltan ${missing.join(", ")}. La publicación y el matching serán más precisos con esa información.`,
        propertyId: property.id,
        requiresApproval: false
      });
    }
  }
  for (const operation of operations) {
    const normalized = operationPayload(operation);
    const stages = stagesForBrokerOperation(normalized.data.operationType);
    const currentIndex = stages.indexOf(normalized.data.stage);
    const next = stages[currentIndex + 1];
    if (next) {
      recommendations.push({
        id: `operation-${operation.id}-${next}`,
        priority: "MEDIUM",
        area: "commercial",
        title: `Siguiente paso: ${operation.title}`,
        detail: `La operación está en ${normalized.data.stage}. Puedes avanzar a ${next} cuando el equipo confirme el hito.`,
        operationId: operation.id,
        requiresApproval: true
      });
    }
  }
  if (maintenance > 0) recommendations.push({ id: "maintenance-open", priority: "HIGH", area: "maintenance", title: "Mantenciones pendientes", detail: `${maintenance} caso(s) requiere(n) revisión, proveedor o confirmación de cierre.`, requiresApproval: true });
  if (postSale > 0) recommendations.push({ id: "post-sale-open", priority: "HIGH", area: "post_sale", title: "Casos de postventa abiertos", detail: `${postSale} caso(s) mantiene(n) una decisión o seguimiento pendiente.`, requiresApproval: true });
  if (financing > 0) recommendations.push({ id: "financing-open", priority: "MEDIUM", area: "financing", title: "Financiamientos en seguimiento", detail: `${financing} solicitud(es) requiere(n) antecedentes o una revisión humana.`, requiresApproval: true });
  return recommendations.slice(0, 12);
}

async function assertRelatedProperty(req, propertyId) {
  if (!propertyId) return null;
  const property = await prisma.industryRecord.findFirst({
    where: brokerWhere(req, { id: String(propertyId), recordType: "property" }),
    select: { id: true, title: true }
  });
  if (!property) throw new Error("La propiedad relacionada no pertenece a esta cuenta.");
  return property;
}

async function assertAssignedUser(req, assignedToId) {
  if (!assignedToId) return null;
  const user = await prisma.workspaceUser.findFirst({
    where: { id: String(assignedToId), tenantId: req.tenantId, isActive: true },
    select: { id: true }
  });
  if (!user) throw new Error("El usuario asignado no pertenece a esta cuenta.");
  return user;
}

brokerRouter.get("/broker/overview", async (req, res) => {
  try {
    const [propertyCount, properties, operations, visits, alerts, rentals, maintenance, postSale, financing] = await Promise.all([
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "property" }) }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "property" }), orderBy: { updatedAt: "desc" }, take: 12 }),
      prisma.industryRecord.findMany({ where: brokerWhere(req, { recordType: "broker_operation" }), orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "visit", status: { in: ["SCHEDULED", "PENDING", "ACTIVE"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "realty_alert", status: { not: "RESOLVED" } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "rental_contract", status: { in: ["ACTIVE", "PENDING_RENEWAL"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "maintenance_ticket", status: { notIn: ["CLOSED", "CANCELLED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "post_sale_case", status: { notIn: ["CLOSED", "RESOLVED"] } }) }),
      prisma.industryRecord.count({ where: brokerWhere(req, { recordType: "operation_financing", status: { in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "DISBURSED"] } }) })
    ]);
    const normalizedOperations = operations.map(operationPayload);
    const kpis = {
      properties: propertyCount,
      activeOperations: normalizedOperations.filter((item) => !["CIERRE", "POSTVENTA", "ARRENDADO", "CANCELADA", "PERDIDA"].includes(String(item.data.stage))).length,
      scheduledVisits: visits,
      openAlerts: alerts,
      activeRentals: rentals,
      openMaintenance: maintenance,
      openPostSale: postSale,
      activeFinancing: financing
    };
    res.json({
      kpis,
      properties,
      operations: normalizedOperations,
      recommendations: brokerRecommendations({ properties, operations, maintenance, postSale, financing }),
      agents: BROKER_AGENT_CATALOG.map(brokerAgentPayload)
    });
  } catch (error) {
    console.error("Broker overview error:", error);
    res.status(500).json({ error: "No se pudo preparar el resumen operativo del Broker." });
  }
});

brokerRouter.get("/broker/catalog", (_req, res) => {
  res.json({
    areas: BROKER_RECORD_AREAS,
    recordDefinitions: BROKER_RECORD_DEFINITIONS,
    agents: BROKER_AGENT_CATALOG.map(brokerAgentPayload),
    operationStages: {
      SALE: SALE_STAGES,
      RENTAL: stagesForBrokerOperation("RENTAL"),
      ADMINISTRATION: stagesForBrokerOperation("ADMINISTRATION")
    }
  });
});

brokerRouter.get("/broker/operations", async (req, res) => {
  try {
    const type = req.query.type ? normalizeBrokerOperationType(req.query.type) : null;
    if (req.query.type && !type) return res.status(400).json({ error: "Tipo de operación inválido." });
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: "broker_operation" }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    const operations = records.map(operationPayload).filter((item) => !type || item.data.operationType === type);
    res.json(operations);
  } catch (error) {
    console.error("List broker operations error:", error);
    res.status(500).json({ error: "No se pudieron obtener las operaciones." });
  }
});

brokerRouter.post("/broker/operations", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const title = text(req.body?.title);
    const operationType = normalizeBrokerOperationType(req.body?.operationType);
    if (!title || !operationType) return res.status(400).json({ error: "Nombre y tipo de operación son requeridos." });
    const propertyId = text(req.body?.propertyId);
    await assertRelatedProperty(req, propertyId);
    await assertAssignedUser(req, text(req.body?.assignedToId));
    const stages = stagesForBrokerOperation(operationType);
    const stage = text(req.body?.stage, stages[0]).toUpperCase();
    if (!stages.includes(stage)) return res.status(400).json({ error: "La etapa inicial no pertenece a este flujo." });
    const now = new Date().toISOString();
    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "broker_operation",
        title,
        status: "ACTIVE",
        assignedToId: text(req.body?.assignedToId) || null,
        data: {
          ...(dataOf({ data: req.body?.data })),
          operationType,
          propertyId: propertyId || null,
          buyerId: text(req.body?.buyerId) || null,
          stage,
          timeline: [{ at: now, type: "OPERATION_CREATED", stage, note: "Operación creada" }]
        }
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "BROKER_OPERATION_CREATED", "broker_operation", record.id, { operationType, stage, propertyId: propertyId || null });
    res.status(201).json(operationPayload(record));
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Create broker operation error:", error);
    res.status(500).json({ error: "No se pudo crear la operación." });
  }
});

brokerRouter.patch("/broker/operations/:id/stage", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "broker_operation" }) });
    if (!existing) return res.status(404).json({ error: "Operación no encontrada." });
    const current = operationPayload(existing);
    const transition = validateBrokerStageTransition({ operationType: current.data.operationType, currentStage: current.data.stage, nextStage: req.body?.stage });
    if (!transition.ok) return res.status(422).json({ error: transition.error });
    const now = new Date().toISOString();
    const timeline = [...current.data.timeline, { at: now, type: "STAGE_CHANGED", from: transition.current, stage: transition.next, note: text(req.body?.note, `Etapa cambiada a ${transition.next}`) }];
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { status: transition.terminal ? "COMPLETED" : "ACTIVE", data: { ...current.data, stage: transition.next, timeline } }
    });
    await recordAuditLog(req, "BROKER_OPERATION_STAGE_CHANGED", "broker_operation", record.id, { from: transition.current, to: transition.next });
    res.json(operationPayload(record));
  } catch (error) {
    console.error("Advance broker operation error:", error);
    res.status(500).json({ error: "No se pudo actualizar la etapa de la operación." });
  }
});

brokerRouter.post("/broker/operations/:id/timeline", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: "broker_operation" }) });
    if (!existing) return res.status(404).json({ error: "Operación no encontrada." });
    const note = text(req.body?.note);
    if (!note) return res.status(400).json({ error: "Describe el evento que quieres registrar." });
    const operation = operationPayload(existing);
    const event = { at: new Date().toISOString(), type: text(req.body?.type, "NOTE").toUpperCase(), stage: operation.data.stage, note };
    const record = await prisma.industryRecord.update({ where: { id: existing.id }, data: { data: { ...operation.data, timeline: [...operation.data.timeline, event] } } });
    await recordAuditLog(req, "BROKER_OPERATION_EVENT_RECORDED", "broker_operation", record.id, event);
    res.status(201).json(operationPayload(record));
  } catch (error) {
    console.error("Create broker timeline event error:", error);
    res.status(500).json({ error: "No se pudo registrar el evento." });
  }
});

brokerRouter.get("/broker/records/:area", async (req, res) => {
  try {
    const area = String(req.params.area || "");
    if (!isBrokerRecordArea(area)) return res.status(404).json({ error: "Área operativa no encontrada." });
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: BROKER_RECORD_AREAS[area] } }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    res.json(records);
  } catch (error) {
    console.error("List broker records error:", error);
    res.status(500).json({ error: "No se pudieron obtener los registros operativos." });
  }
});

brokerRouter.post("/broker/records", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const recordType = text(req.body?.recordType).toLowerCase();
    const title = text(req.body?.title);
    if (!BROKER_RECORD_TYPES.includes(recordType)) return res.status(400).json({ error: "Tipo de registro Broker no válido." });
    if (!title) return res.status(400).json({ error: "El nombre del registro es requerido." });
    const recordData = { ...dataOf({ data: req.body?.data }) };
    const propertyId = text(recordData.propertyId || req.body?.propertyId);
    if (propertyId) recordData.propertyId = propertyId;
    const validation = validateBrokerRecord({ recordType, data: recordData, status: req.body?.status });
    if (!validation.ok) return res.status(422).json({ error: validation.error });
    await assertRelatedProperty(req, propertyId);
    await assertAssignedUser(req, text(req.body?.assignedToId));
    const record = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType,
        title,
        status: validation.status,
        assignedToId: text(req.body?.assignedToId) || null,
        data: { ...recordData, propertyId: propertyId || null, createdFrom: "broker_os" }
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    });
    await recordAuditLog(req, "BROKER_RECORD_CREATED", recordType, record.id, { propertyId: propertyId || null, status: record.status });
    res.status(201).json(record);
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Create broker record error:", error);
    res.status(500).json({ error: "No se pudo crear el registro operativo." });
  }
});

brokerRouter.patch("/broker/records/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: brokerWhere(req, { id: req.params.id, recordType: { in: BROKER_RECORD_TYPES } }) });
    if (!existing) return res.status(404).json({ error: "Registro operativo no encontrado." });
    const nextData = req.body?.data === undefined
      ? dataOf(existing)
      : { ...dataOf(existing), ...dataOf({ data: req.body.data }) };
    const propertyId = text(nextData.propertyId);
    const nextStatus = req.body?.status === undefined ? existing.status : text(req.body.status, existing.status).toUpperCase();
    const validation = validateBrokerRecord({ recordType: existing.recordType, data: nextData, status: nextStatus });
    if (!validation.ok) return res.status(422).json({ error: validation.error });
    await assertRelatedProperty(req, propertyId);
    if (req.body?.assignedToId !== undefined) await assertAssignedUser(req, text(req.body.assignedToId));
    const record = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: { title: req.body?.title === undefined ? existing.title : text(req.body.title, existing.title), status: validation.status, ...(req.body?.assignedToId === undefined ? {} : { assignedToId: text(req.body.assignedToId) || null }), data: nextData }
    });
    await recordAuditLog(req, "BROKER_RECORD_UPDATED", record.recordType, record.id, { status: record.status });
    res.json(record);
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada") || error?.message?.includes("usuario asignado")) return res.status(400).json({ error: error.message });
    console.error("Update broker record error:", error);
    res.status(500).json({ error: "No se pudo actualizar el registro operativo." });
  }
});

brokerRouter.get("/broker/properties/:propertyId/expedient", async (req, res) => {
  try {
    const property = await assertRelatedProperty(req, req.params.propertyId);
    const records = await prisma.industryRecord.findMany({
      where: brokerWhere(req, { recordType: { in: [...BROKER_RECORD_TYPES, "broker_operation", "visit", "realty_alert"] } }),
      orderBy: { updatedAt: "desc" },
      take: 500
    });
    const related = records.filter((record) => String(dataOf(record).propertyId || "") === property.id);
    const grouped = Object.fromEntries(Object.keys(BROKER_RECORD_AREAS).map((area) => [area, related.filter((record) => BROKER_RECORD_AREAS[area].includes(record.recordType))]));
    res.json({
      property,
      records: related,
      grouped,
      completion: { missing: missingPropertyData(property), complete: missingPropertyData(property).length === 0 }
    });
  } catch (error) {
    if (error?.message?.includes("propiedad relacionada")) return res.status(404).json({ error: "Propiedad no encontrada." });
    console.error("Broker property expediente error:", error);
    res.status(500).json({ error: "No se pudo preparar el expediente de la propiedad." });
  }
});
