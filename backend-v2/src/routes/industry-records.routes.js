import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { buildBalancedAssignments } from "../lib/industries.js";
import { isModuleAllowedForIndustry } from "../lib/industry-module-access.js";
import { ensureTenantModuleEligibility } from "../services/tenant-modules.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { mergeMetadata, normalizeMetadata } from "../lib/metadata.js";
import { recordAuditLog } from "../lib/audit.js";
import { ensureAutomatedMetadataDraft, getPublishedMetadataSchema } from "../services/metadata-schemas.service.js";
import { evaluateMetadataRecord } from "../services/metadata-quality.service.js";
import { redactMetadataForRole } from "../lib/metadata-access.js";
import { runWorkflowsForEvent } from "./workflows.routes.js";
import { runFinancePostIngestionAnalysis } from "../services/finance-automation.service.js";
import { canMutateFinanceRecord, financeActionForRecordMutation, isFinanceRecordType } from "../services/finance-security.service.js";
import { financeRecordModule, financeRecordRequiredModules, GENERIC_FINANCE_WRITABLE_TYPES } from "../services/finance-record-access.service.js";
import { normalizeFinanceDocumentData, validateFinanceDocumentData } from "../services/finance-document.service.js";

export const industryRecordsRouter = Router();

const RECORD_MODULES = Object.freeze({
  property: MODULES.PROPERTIES,
  property_import: MODULES.REALTY_LOADS,
  // La formación pertenece al equipo de corredores; no a la carga de
  // propiedades. Esto permite llevar progreso de capacitación sin mezclarlo
  // con inventario ni importaciones.
  property_training: MODULES.BROKERS,
  owner: MODULES.PROPERTIES,
  broker_profile: MODULES.BROKERS,
  seller_assignment: MODULES.PROPERTY_ASSIGNMENTS,
  lead: MODULES.SALES,
  visit: MODULES.BOOKINGS,
  realty_alert: MODULES.REALTY_ACTIVITY,
  broker_followup: MODULES.BROKER_PORTAL,
  deal: MODULES.SALES,
  commission_distribution: MODULES.SALES,
  forecast: MODULES.AI_OPS,
  ai_interaction: MODULES.AI_OPS,
  customer: MODULES.REALTY_CLIENTS,
  // Broker OS: expedientes independientes por propiedad, arriendo y servicio.
  // Se asocian a una capacidad existente de la vertical para no forzar una
  // migración de planes al habilitar el nuevo núcleo operacional.
  broker_operation: MODULES.PROPERTIES,
  property_mandate: MODULES.PROPERTIES,
  property_appraisal: MODULES.PROPERTIES,
  property_offer: MODULES.PROPERTIES,
  property_promise: MODULES.PROPERTIES,
  property_inspection: MODULES.REALTY_ACTIVITY,
  property_handover: MODULES.REALTY_ACTIVITY,
  rental_application: MODULES.BROKER_PORTAL,
  rental_contract: MODULES.BROKER_PORTAL,
  rental_payment: MODULES.BROKER_PORTAL,
  administration_liquidation: MODULES.BROKER_PORTAL,
  maintenance_ticket: MODULES.REALTY_ACTIVITY,
  service_provider: MODULES.BROKERS,
  provider_quote: MODULES.REALTY_ACTIVITY,
  material_purchase: MODULES.REALTY_ACTIVITY,
  remodeling_project: MODULES.REALTY_ACTIVITY,
  project_budget: MODULES.REALTY_ACTIVITY,
  project_milestone: MODULES.REALTY_ACTIVITY,
  marketing_publication: MODULES.MARKETING,
  post_sale_case: MODULES.REALTY_ACTIVITY,
  warranty_case: MODULES.REALTY_ACTIVITY,
  property_document: MODULES.DOCUMENTS,
  legal_document: MODULES.DOCUMENTS,
  digital_signature: MODULES.DOCUMENTS,
  commission_settlement: MODULES.PROPERTY_ASSIGNMENTS,
  operation_financing: MODULES.PAYMENTS,
  operation_financing_expense: MODULES.PAYMENTS,
  patient: MODULES.PATIENTS,
  exam: MODULES.EXAMS,
  revenue: MODULES.REVENUE,
  vehicle: MODULES.VEHICLE_OWNERS,
  part: MODULES.PARTS_INVENTORY,
  work_order: MODULES.MECHANIC_ASSIGNMENTS,
  ready_notification: MODULES.READY_NOTIFICATIONS,
  shift: MODULES.SHIFT_MANAGEMENT,
  restaurant_table: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_order: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_daily_close: MODULES.GASTRONOMY_OPERATIONS,
  restaurant_guest: MODULES.GASTRONOMY_OPERATIONS,
  dental_patient: MODULES.DENTAL_CARE,
  dental_odontogram: MODULES.DENTAL_CARE,
  dental_treatment: MODULES.DENTAL_CARE,
  dental_consent: MODULES.DENTAL_CARE,
  clinical_patient: MODULES.HEALTH_CARE,
  clinical_attention: MODULES.HEALTH_CARE,
  clinical_order: MODULES.HEALTH_CARE,
  clinical_followup: MODULES.HEALTH_CARE,
  veterinary_pet: MODULES.VETERINARY_CARE,
  veterinary_vaccine: MODULES.VETERINARY_CARE,
  veterinary_hospitalization: MODULES.VETERINARY_CARE,
  veterinary_prescription: MODULES.VETERINARY_CARE,
  document: MODULES.DOCUMENTS,
  workflow_definition: MODULES.WORKFLOWS,
  workflow_run: MODULES.WORKFLOWS,
  finance_invoice: MODULES.FINANCE_INVOICES,
  bank_statement: MODULES.FINANCE_BANK_SYNC,
  finance_bank_account: MODULES.FINANCE_BANK_SYNC,
  bank_movement: MODULES.FINANCE_BANK_SYNC,
  finance_reconciliation: MODULES.FINANCE_RECONCILIATION,
  finance_monthly_close: MODULES.FINANCE_ANALYTICS,
  finance_period_reopening: MODULES.FINANCE_ANALYTICS,
  finance_period_coverage: MODULES.FINANCE_ANALYTICS,
  finance_historical_correction: MODULES.FINANCE_ANALYTICS,
  finance_customer_credit: MODULES.FINANCE_RECONCILIATION,
  finance_credit_application: MODULES.FINANCE_RECONCILIATION,
  finance_reconciliation_difference: MODULES.FINANCE_RECONCILIATION,
  finance_reconciliation_group: MODULES.FINANCE_RECONCILIATION,
  finance_exception: MODULES.FINANCE_EXCEPTIONS,
  finance_collection_case: MODULES.FINANCE_COLLECTIONS,
    finance_reminder_batch: MODULES.FINANCE_COLLECTIONS,
    finance_collection_delivery: MODULES.FINANCE_COLLECTIONS,
  finance_invoice_receipt: MODULES.FINANCE_INVOICES,
  finance_payable: MODULES.FINANCE_PAYABLES,
  finance_payable_payment: MODULES.FINANCE_PAYABLES,
  finance_migration_batch: MODULES.FINANCE_MIGRATION,
  finance_opening_balance: MODULES.FINANCE_MIGRATION
});

// Estos expedientes tienen un flujo estricto en Broker OS. Evitamos que una
// actualización genérica salte una confirmación, una recepción o una garantía
// solo cambiando el estado del registro histórico.
const BROKER_CONTROLLED_STATUS_RECORDS = new Set([
  "maintenance_ticket", "remodeling_project", "property_inspection",
  "property_handover", "post_sale_case", "warranty_case"
]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRecordType(value) {
  return cleanText(value, "property").toLowerCase().replace(/\s+/g, "_");
}

function isFinanceDocumentRecord(recordType) {
  return ["finance_invoice", "finance_payable"].includes(recordType);
}

async function assertRecordModule(req, recordType, data) {
  const financial = isFinanceRecordType(recordType);
  const module = financial ? financeRecordModule(recordType, data) : RECORD_MODULES[recordType];
  if (financial && !module) return false;
  if (!module) return true;
  const role = req.user?.role;
  if (role === "SUPER_ADMIN") return true;
  req.recordModuleAccess ||= new Map();
  for (const required of financial ? financeRecordRequiredModules(recordType, data) : [module]) {
    if (!isModuleAllowedForIndustry(required, req.tenant?.industry)) return false;
    if (!req.recordModuleAccess.has(required)) req.recordModuleAccess.set(required,
      ensureTenantModuleEligibility({ tenantId: req.tenantId, module: required, tenant: req.tenant }));
    if (!(await req.recordModuleAccess.get(required))) return false;
  }
  return true;
}

function assertFinanceRecordMutation(req, res, recordType, existing) {
  if (isFinanceRecordType(recordType) && !GENERIC_FINANCE_WRITABLE_TYPES.has(recordType)) {
    res.status(409).json({ error: "Este registro financiero se gestiona desde su acción específica para conservar permisos, saldos y auditoría." });
    return false;
  }
  if (recordType === "finance_bank_account") {
    res.status(409).json({ error: "Utiliza la gestión de cuentas bancarias. Su identidad, moneda e historial no se editan por la ficha genérica." });
    return false;
  }
  if (recordType === "finance_reconciliation_group") {
    res.status(409).json({ error: "Utiliza Conciliaciones agrupadas para aprobar o revertir el grupo completo. No se edita ni elimina directamente." });
    return false;
  }
  if (recordType === "finance_reconciliation_difference") {
    res.status(409).json({ error: "Utiliza Diferencias justificadas: requiere propuesta, aprobación y reversa auditada. No admite edición ni eliminación directa." });
    return false;
  }
  if (["finance_customer_credit", "finance_credit_application"].includes(recordType)) {
    res.status(409).json({ error: "Utiliza Anticipos y saldos a favor: su saldo, aplicaciones y reversas son auditados y no se editan ni eliminan directamente." });
    return false;
  }
  if (recordType === "finance_historical_correction") {
    res.status(409).json({ error: "El historial de correcciones es inmutable. Utiliza Revisión histórica para registrar una nueva corrección respaldada." });
    return false;
  }
  if (recordType === "finance_period_coverage") {
    res.status(409).json({ error: "La revisión de cobertura se registra desde Cierre mensual y no se edita ni elimina por la ficha genérica." });
    return false;
  }
  if (recordType === "bank_movement" && req.body?.assignedToId !== undefined && (req.body.assignedToId || null) !== (existing?.assignedToId || null)) {
    res.status(409).json({ error: "Asigna el responsable desde el detalle del movimiento, con motivo e historial." });
    return false;
  }
  if (["finance_exception", "finance_collection_case", "finance_reminder_batch", "finance_collection_delivery"].includes(recordType)) {
    res.status(409).json({ error: "Utiliza las acciones de Excepciones o Cobranza para conservar estados, períodos y trazabilidad. No se editan ni eliminan mediante la ficha genérica." });
    return false;
  }
  if (recordType === "bank_statement" || (["bank_movement", "finance_exception"].includes(recordType) && (existing?.data?.importBatchId || req.body?.data?.importBatchId))) {
    res.status(409).json({ error: "Los registros de una cartola se gestionan desde Cartolas y movimientos para proteger los períodos y conservar el archivo original." });
    return false;
  }
  if (["finance_reconciliation", "finance_invoice_receipt", "finance_payable_payment", "finance_opening_balance", "finance_migration_batch", "finance_sii_import_batch", "finance_monthly_close", "finance_period_reopening"].includes(recordType)) {
    res.status(409).json({ error: "Este registro conserva saldos y trazabilidad. Utiliza la acción correspondiente en Finanzas: registrar cobro, conciliar, revertir, cerrar o reabrir; no se modifica directamente." });
    return false;
  }
  const action = financeActionForRecordMutation(recordType);
  if (!action || canMutateFinanceRecord(req.user?.role, recordType)) return true;
  console.warn("[FINANCE_RECORD_MUTATION_FORBIDDEN]", {
    userId: req.user?.id,
    tenantId: req.tenantId,
    role: req.user?.role,
    recordType,
    action
  });
  res.status(403).json({
    error: "Tu rol no tiene permiso para modificar este registro financiero.",
    action
  });
  return false;
}

async function evaluateRecordMetadata(tenantId, recordType, data) {
  const schema = await getPublishedMetadataSchema(tenantId, recordType);
  return evaluateMetadataRecord({ tenantId, data, schema });
}

function metadataValidationResponse(evaluation) {
  if (!evaluation.result) return null;
  return {
    schemaVersion: evaluation.schemaVersion,
    mode: evaluation.mode,
    ok: evaluation.result.ok,
    errors: evaluation.result.errors,
    unknownFields: evaluation.result.unknownFields
  };
}

async function redactRecordForViewer(req, record) {
  // Las copias originales pueden contener datos de módulos no habilitados al
  // lector del listado genérico. Sólo auditoría superadmin accede al contenido.
  if (record.recordType === "finance_historical_correction" && req.user?.role !== "SUPER_ADMIN") {
    return { ...record, title: "Corrección histórica auditada", data: { at: record.data?.at, restricted: true } };
  }
  const schema = await getPublishedMetadataSchema(req.tenantId, record.recordType);
  if (!schema || req.user?.role === "SUPER_ADMIN") return record;
  const redacted = redactMetadataForRole(record.data, schema, req.user?.role);
  return { ...record, data: redacted.data, metadataAccess: redacted.hiddenFields.length ? { hiddenFields: redacted.hiddenFields } : undefined };
}

function tenantRecordWhere(req, extra = {}) {
  if (req.user?.role === "SUPER_ADMIN" && req.query?.tenantId) {
    return { tenantId: String(req.query.tenantId), ...extra };
  }
  return { tenantId: req.tenantId, ...extra };
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

industryRecordsRouter.get("/industry-records/users", async (req, res) => {
  try {
    const users = await prisma.workspaceUser.findMany({
      where: {
        tenantId: req.user?.role === "SUPER_ADMIN" && req.query?.tenantId ? String(req.query.tenantId) : req.tenantId,
        isActive: true
      },
      select: { id: true, name: true, email: true, role: true, jobTitle: true },
      orderBy: [{ role: "asc" }, { name: "asc" }]
    });
    res.json(users);
  } catch (error) {
    console.error("List industry users error:", error);
    res.status(500).json({ error: "No se pudieron obtener usuarios del rubro" });
  }
});

industryRecordsRouter.get("/industry-records", async (req, res) => {
  try {
    const recordType = req.query.type ? normalizeRecordType(req.query.type) : null;
    if (recordType && !(await assertRecordModule(req, recordType))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${recordType}` });
    }

    const records = await prisma.industryRecord.findMany({
      where: tenantRecordWhere(req, {
        ...(recordType ? { recordType } : {}),
        ...(req.query.status ? { status: String(req.query.status) } : {})
      }),
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: Math.min(Number(req.query.limit || 200), 500)
    });
    const allowed = await Promise.all(records.map(record => assertRecordModule(req, record.recordType, record.data)));
    res.set("Cache-Control", "no-store").json(await Promise.all(records.filter((_, i) => allowed[i]).map((record) => redactRecordForViewer(req, record))));
  } catch (error) {
    console.error("List industry records error:", error);
    res.status(500).json({ error: "No se pudieron obtener registros del rubro" });
  }
});

industryRecordsRouter.post("/industry-records/brokers", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await assertRecordModule(req, "broker_profile"))) {
      return res.status(403).json({ error: "Modulo de corredores no habilitado" });
    }

    const name = cleanText(req.body?.name);
    const email = cleanText(req.body?.email).toLowerCase();
    const password = cleanText(req.body?.password);
    const phone = cleanText(req.body?.phone);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nombre, email y contrasena son requeridos" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres" });
    }

    const existing = await prisma.workspaceUser.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Ya existe un usuario con este correo" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.workspaceUser.create({
        data: {
          tenantId: req.tenantId,
          name,
          email,
          passwordHash: await hashPassword(password),
          role: "SELLER",
          jobTitle: "Corredor inmobiliario",
          isActive: true
        },
        select: { id: true, name: true, email: true, role: true, jobTitle: true }
      });

      const profile = await tx.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "broker_profile",
          title: name,
          status: "ACTIVE",
          assignedToId: user.id,
          data: {
            name,
            email,
            phone,
            role: "Corredor",
            workspaceRole: "SELLER",
            userId: user.id,
            moduleScope: ["crm", "inbox", "agenda", "dashboard", "pipeline", "ai_ops", "properties", "broker_portal"]
          }
        },
        include: { assignedTo: { select: { id: true, name: true, email: true, role: true, jobTitle: true } } }
      });

      return { user, profile };
    });

    await recordAuditLog(req, "BROKER_USER_CREATED", "broker_profile", result.profile.id, {
      userId: result.user.id,
      email: result.user.email
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Create broker user error:", error);
    res.status(500).json({ error: "No se pudo crear el corredor" });
  }
});

// El perfil de corredor y su usuario son una sola unidad operacional. Al
// eliminarlo, la cartera queda disponible para reasignacion sin perder fichas.
industryRecordsRouter.delete("/industry-records/brokers/:userId", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    if (!(await assertRecordModule(req, "broker_profile"))) {
      return res.status(403).json({ error: "Modulo de corredores no habilitado" });
    }

    const requestedId = String(req.params.userId || "");
    const brokerUser = await prisma.workspaceUser.findFirst({
      where: { id: req.params.userId, tenantId: req.tenantId },
      select: { id: true, name: true, email: true, role: true, jobTitle: true }
    });

    // Algunos corredores históricos existen solo como ficha (su usuario pudo
    // haberse eliminado antes). El frontend los muestra igual, por lo que la
    // baja debe poder limpiar esa ficha sin devolver un falso "no encontrado".
    const brokerProfiles = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "broker_profile" },
      select: { id: true, title: true, assignedToId: true, data: true }
    });
    const matchingProfiles = brokerProfiles.filter((profile) => {
      const data = profile.data && typeof profile.data === "object" && !Array.isArray(profile.data) ? profile.data : {};
      return profile.id === requestedId || profile.assignedToId === requestedId || String(data.userId || "") === requestedId;
    });

    if (!brokerUser && !matchingProfiles.length) return res.status(404).json({ error: "Corredor no encontrado" });

    const jobTitle = String(brokerUser?.jobTitle || "").toLowerCase();
    if (brokerUser && brokerUser.role !== "SELLER" && !jobTitle.includes("corredor")) {
      return res.status(400).json({ error: "Solo se pueden eliminar perfiles de corredor desde este modulo" });
    }

    const brokerIds = new Set([requestedId]);
    if (brokerUser?.id) brokerIds.add(brokerUser.id);
    for (const profile of matchingProfiles) {
      brokerIds.add(profile.id);
      if (profile.assignedToId) brokerIds.add(profile.assignedToId);
      const data = profile.data && typeof profile.data === "object" && !Array.isArray(profile.data) ? profile.data : {};
      if (data.userId) brokerIds.add(String(data.userId));
    }

    const properties = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "property" },
      select: { id: true, data: true, assignedToId: true }
    });
    const assignedProperties = properties.filter((property) => {
      const data = property.data && typeof property.data === "object" && !Array.isArray(property.data) ? property.data : {};
      return brokerIds.has(String(property.assignedToId || "")) || brokerIds.has(String(data.assignedBrokerId || ""));
    });

    await prisma.$transaction(async (tx) => {
      for (const property of assignedProperties) {
        const currentData = property.data && typeof property.data === "object" && !Array.isArray(property.data)
          ? property.data
          : {};
        await tx.industryRecord.update({
          where: { id: property.id },
          data: {
            assignedToId: null,
            data: {
              ...currentData,
              assignedBrokerId: "",
              assignedBrokerName: "",
              assignmentMode: "sin_corredor"
            }
          }
        });
      }

      if (matchingProfiles.length) {
        await tx.industryRecord.deleteMany({ where: { id: { in: matchingProfiles.map((profile) => profile.id) } } });
      }
      if (brokerUser) await tx.workspaceUser.delete({ where: { id: brokerUser.id } });
    });

    const profileData = matchingProfiles[0]?.data && typeof matchingProfiles[0].data === "object" && !Array.isArray(matchingProfiles[0].data)
      ? matchingProfiles[0].data
      : {};
    await recordAuditLog(req, "BROKER_USER_DELETED", "broker_profile", brokerUser?.id || matchingProfiles[0]?.id || requestedId, {
      name: brokerUser?.name || cleanText(profileData.name) || matchingProfiles[0]?.title || "Corredor sin usuario",
      email: brokerUser?.email || cleanText(profileData.email),
      unassignedProperties: assignedProperties.length
    });
    res.json({ ok: true, unassignedProperties: assignedProperties.length });
  } catch (error) {
    console.error("Delete broker user error:", error);
    res.status(500).json({ error: "No se pudo eliminar el corredor" });
  }
});

industryRecordsRouter.post("/industry-records", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    assertFinancialDraftScope(req.body?.expectedScope, req.tenantId, req.user?.id);
    const recordType = normalizeRecordType(req.body?.recordType);
    if (!assertFinanceRecordMutation(req, res, recordType)) return;
    if (!(await assertRecordModule(req, recordType, req.body?.data))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${recordType}` });
    }

    const title = cleanText(req.body?.title);
    if (!title) return res.status(400).json({ error: "title es requerido" });

    const assignedToId = cleanText(req.body?.assignedToId) || null;
    if (assignedToId) {
      const user = await prisma.workspaceUser.findFirst({ where: { id: assignedToId, tenantId: req.tenantId, isActive: true } });
      if (!user) return res.status(400).json({ error: "Usuario asignado no pertenece a este cliente" });
    }

    let normalizedData = normalizeMetadata(req.body?.data, {});
    if (req.body?.idempotencyKey && isFinanceDocumentRecord(recordType)) {
      financialDate(normalizedData.issueDate);
      financialDate(normalizedData.dueDate);
    }
    if (isFinanceDocumentRecord(recordType)) {
      normalizedData = normalizeFinanceDocumentData(normalizedData, recordType);
      const financeValidation = validateFinanceDocumentData(normalizedData);
      if (!financeValidation.ok) {
        return res.status(422).json({ error: `Completa o corrige: ${financeValidation.errors.join(", ")}.`, financeValidation });
      }
    }
    const automatedSchema = await ensureAutomatedMetadataDraft({
      tenantId: req.tenantId,
      industry: req.tenant?.industry,
      recordType
    });
    if (automatedSchema) {
      await recordAuditLog(req, "METADATA_SCHEMA_AUTO_DRAFT_CREATED", "metadata_schema", automatedSchema.id, {
        recordType,
        version: automatedSchema.version,
        industry: req.tenant?.industry || "GENERAL"
      });
    }
    const evaluation = await evaluateRecordMetadata(req.tenantId, recordType, normalizedData);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }

    const record = await writeManualFinanceRecord(prisma, { tenantId: req.tenantId, userId: req.user?.id, recordType: recordType, existing: undefined, nextData: normalizedData, nextStatus: cleanText(req.body?.status, "ACTIVE").toUpperCase(), operation: "CREATE",
      idempotencyKey: req.body?.idempotencyKey, creationContext: { title, assignedToId },
      write: (tx, persistedData) => tx.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType,
        title,
        status: cleanText(req.body?.status, "ACTIVE").toUpperCase(),
        assignedToId,
        data: persistedData || normalizedData,
        schemaVersion: evaluation.schemaVersion
      },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    }),
      audit: { action: "INDUSTRY_RECORD_CREATED", metadata: { recordType: recordType } }
    });
    if (!MANUAL_FINANCE_RECORDS.has(recordType)) await recordAuditLog(req, "INDUSTRY_RECORD_CREATED", recordType, record.id, { recordType, status: record.status });
    // Los workflows por evento trabajan en segundo plano lógico: si uno falla,
    // queda en su cola de errores y no se pierde la ficha recién creada.
    const workflowDispatch = record.manualReplayed ? { event: "record.created", matched: 0, replayed: true } : await runWorkflowsForEvent({
      tenantId: req.tenantId,
      event: "record.created",
      input: { recordType, status: record.status },
      target: { id: record.id, recordType, status: record.status }
    }).catch((error) => ({ event: "record.created", matched: 0, error: error?.message || "dispatch_failed" }));
    // Facturas y movimientos recién cargados quedan disponibles al instante.
    // El análisis se ejecuta aparte para no retrasar ni bloquear el guardado;
    // solo prepara sugerencias o excepciones según la política del tenant.
    if (!record.manualReplayed && ["finance_invoice", "bank_movement", "bank_statement"].includes(recordType)) {
      void runFinancePostIngestionAnalysis({ tenantId: req.tenantId, source: `record:${recordType}` })
        .catch((error) => console.warn("[FINANCE_POST_INGESTION_WARNING]", error?.message || error));
    }
    res.status(record.manualReplayed ? 200 : 201).json({
      ...(await redactRecordForViewer(req, record)),
      metadataValidation: metadataValidationResponse(evaluation),
      automatedSchema: automatedSchema ? { id: automatedSchema.id, label: automatedSchema.label, version: automatedSchema.version } : null,
      workflowDispatch
    });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Create industry record error:", error);
    res.status(500).json({ error: "No se pudo crear el registro del rubro" });
  }
});

industryRecordsRouter.patch("/industry-records/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    if (!assertFinanceRecordMutation(req, res, existing.recordType, existing)) return;
    if (!(await assertRecordModule(req, existing.recordType, existing.data)) || !(await assertRecordModule(req, existing.recordType, { ...existing.data, ...req.body?.data }))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${existing.recordType}` });
    }

    const data = {};
    if (req.body?.title !== undefined) data.title = cleanText(req.body.title, existing.title);
    if (req.body?.status !== undefined) {
      if (BROKER_CONTROLLED_STATUS_RECORDS.has(existing.recordType)) {
        return res.status(422).json({ error: "Este expediente tiene un flujo controlado. Cambia de etapa desde su Control operativo para conservar evidencias y confirmaciones." });
      }
      data.status = cleanText(req.body.status, existing.status).toUpperCase();
    }
    if (req.body?.assignedToId !== undefined) {
      const assignedToId = cleanText(req.body.assignedToId) || null;
      if (assignedToId) {
        const user = await prisma.workspaceUser.findFirst({ where: { id: assignedToId, tenantId: req.tenantId, isActive: true } });
        if (!user) return res.status(400).json({ error: "Usuario asignado no pertenece a este cliente" });
      }
      data.assignedToId = assignedToId;
    }
    let nextMetadata = req.body?.data !== undefined ? normalizeMetadata(req.body.data, {}) : existing.data;
    if (isFinanceDocumentRecord(existing.recordType) && req.body?.data !== undefined) {
      nextMetadata = normalizeFinanceDocumentData(mergeMetadata(existing.data, nextMetadata), existing.recordType);
      const financeValidation = validateFinanceDocumentData(nextMetadata);
      if (!financeValidation.ok) {
        return res.status(422).json({ error: `Completa o corrige: ${financeValidation.errors.join(", ")}.`, financeValidation });
      }
    }
    const evaluation = await evaluateRecordMetadata(req.tenantId, existing.recordType, nextMetadata);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }
    if (req.body?.data !== undefined) data.data = nextMetadata;
    if (evaluation.schemaVersion) data.schemaVersion = evaluation.schemaVersion;

    const record = await writeManualFinanceRecord(prisma, { tenantId: req.tenantId, userId: req.user?.id, recordType: existing.recordType, existing: existing, nextData: data.data ?? existing.data, nextStatus: data.status ?? existing.status, operation: "UPDATE",
      write: (tx) => tx.industryRecord.update({
      where: { id: existing.id },
      data,
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    }),
      audit: { action: "INDUSTRY_RECORD_UPDATED", metadata: { recordType: existing.recordType } }
    });
    if (!MANUAL_FINANCE_RECORDS.has(existing.recordType)) await recordAuditLog(req, "INDUSTRY_RECORD_UPDATED", existing.recordType, record.id, { recordType: existing.recordType, status: record.status });
    const workflowDispatch = await runWorkflowsForEvent({
      tenantId: req.tenantId,
      event: "record.updated",
      input: { recordType: existing.recordType, status: record.status },
      target: { id: record.id, recordType: existing.recordType, status: record.status }
    }).catch((error) => ({ event: "record.updated", matched: 0, error: error?.message || "dispatch_failed" }));
    res.json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation), workflowDispatch });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Update industry record error:", error);
    res.status(500).json({ error: "No se pudo actualizar el registro" });
  }
});

industryRecordsRouter.patch("/industry-records/:id/metadata", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    if (!assertFinanceRecordMutation(req, res, existing.recordType, existing)) return;
    if (!(await assertRecordModule(req, existing.recordType, existing.data)) || !(await assertRecordModule(req, existing.recordType, { ...existing.data, ...(req.body?.metadata ?? req.body?.data) }))) {
      return res.status(403).json({ error: `Modulo no habilitado para ${existing.recordType}` });
    }

    const patch = normalizeMetadata(req.body?.metadata ?? req.body?.data, {});
    let nextMetadata = mergeMetadata(existing.data, patch);
    if (isFinanceDocumentRecord(existing.recordType)) {
      nextMetadata = normalizeFinanceDocumentData(nextMetadata, existing.recordType);
      const financeValidation = validateFinanceDocumentData(nextMetadata);
      if (!financeValidation.ok) {
        return res.status(422).json({ error: `Completa o corrige: ${financeValidation.errors.join(", ")}.`, financeValidation });
      }
    }
    const evaluation = await evaluateRecordMetadata(req.tenantId, existing.recordType, nextMetadata);
    if (evaluation.blocking) {
      return res.status(422).json({ error: "Los metadatos no cumplen el esquema publicado", metadataValidation: metadataValidationResponse(evaluation) });
    }
    const record = await writeManualFinanceRecord(prisma, { tenantId: req.tenantId, userId: req.user?.id, recordType: existing.recordType, existing: existing, nextData: nextMetadata, nextStatus: existing.status, operation: "UPDATE",
      write: (tx) => tx.industryRecord.update({
      where: { id: existing.id },
      data: { data: nextMetadata, ...(evaluation.schemaVersion ? { schemaVersion: evaluation.schemaVersion } : {}) },
      include: { assignedTo: { select: { id: true, name: true, email: true, role: true } } }
    }),
      audit: { action: "INDUSTRY_RECORD_METADATA_UPDATED", metadata: { recordType: existing.recordType } }
    });
    if (!MANUAL_FINANCE_RECORDS.has(existing.recordType)) await recordAuditLog(req, "INDUSTRY_RECORD_METADATA_UPDATED", existing.recordType, record.id, { recordType: existing.recordType });
    res.json({ ...(await redactRecordForViewer(req, record)), metadataValidation: metadataValidationResponse(evaluation) });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Update industry metadata error:", error);
    res.status(500).json({ error: "No se pudieron actualizar los metadatos" });
  }
});

industryRecordsRouter.delete("/industry-records/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: "Registro no encontrado" });
    if (!assertFinanceRecordMutation(req, res, existing.recordType, existing)) return;
    if (!(await assertRecordModule(req, existing.recordType, existing.data))) return res.status(403).json({ error: "Módulo no habilitado para este registro." });
    await writeManualFinanceRecord(prisma, { tenantId: req.tenantId, userId: req.user?.id, recordType: existing.recordType, existing, operation: "DELETE",
      write: (tx) => tx.industryRecord.delete({ where: { id: existing.id } }),
      audit: { action: "INDUSTRY_RECORD_DELETED", metadata: { recordType: existing.recordType, title: existing.title } }
    });
    if (!MANUAL_FINANCE_RECORDS.has(existing.recordType)) await recordAuditLog(req, "INDUSTRY_RECORD_DELETED", existing.recordType, existing.id, { recordType: existing.recordType, title: existing.title });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof FinanceOperationError) return res.status(error.status).json({ error: error.message });
    console.error("Delete industry record error:", error);
    res.status(500).json({ error: "No se pudo eliminar el registro" });
  }
});

industryRecordsRouter.post("/industry-records/assignments/balance", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const recordType = normalizeRecordType(req.body?.recordType || "property");
    if (isFinanceRecordType(recordType)) return res.status(409).json({ error: "Utiliza la asignación auditada de responsables en Finanzas." });
    if (!(await assertRecordModule(req, recordType))) return res.status(403).json({ error: "Módulo no habilitado." });
    const assigneeRole = cleanText(req.body?.assigneeRole, "SELLER").toUpperCase();
    const records = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType, status: { not: "ARCHIVED" } },
      orderBy: [{ createdAt: "asc" }]
    });
    const assignees = await prisma.workspaceUser.findMany({
      where: { tenantId: req.tenantId, isActive: true, role: assigneeRole },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" }
    });

    const plan = buildBalancedAssignments(records, assignees);
    res.json({ recordType, assigneeRole, assignments: plan });
  } catch (error) {
    console.error("Balance industry assignments error:", error);
    res.status(500).json({ error: "No se pudo calcular la asignacion" });
  }
});
import { MANUAL_FINANCE_RECORDS, writeManualFinanceRecord, financialDate, assertFinancialDraftScope } from "../services/finance-manual-writes.service.js";
import { FinanceOperationError } from "../services/finance-integrity.service.js";
