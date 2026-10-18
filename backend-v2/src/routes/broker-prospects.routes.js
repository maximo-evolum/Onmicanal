/** Archivo: Expone las rutas HTTP del dominio broker prospects y delega su lógica a servicios protegidos. */
import { Router } from "express";
import { createHash } from "node:crypto";
import { brokerRecordWhere, canBrokerAction, requireBrokerAction } from "../services/broker-access.service.js";
import { claimProspect, comparableValuation, prospectEvent, prospectInput, prospectPresentation, prospectTransition } from "../services/broker-prospect.service.js";
import { brokerConversionPlan } from "../services/broker-conversion-plan.service.js";

const CAPTURE_DOCUMENT_ROLES = new Set(["FOTOGRAFIA", "PLANO", "TITULO", "MANDATO", "OTRO"]);

function captureDocumentsInput(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) {
    throw Object.assign(new Error("Selecciona entre 1 y 10 documentos para vincular."), { status: 422 });
  }
  const documents = input.map((item) => ({
    id: String(item?.id || "").trim(),
    role: String(item?.role || "OTRO").trim().toUpperCase()
  }));
  if (documents.some((item) => !/^[a-zA-Z0-9_-]{8,160}$/.test(item.id) || !CAPTURE_DOCUMENT_ROLES.has(item.role))) {
    throw Object.assign(new Error("Los documentos o su tipo de captación no son válidos."), { status: 422 });
  }
  if (new Set(documents.map((item) => item.id)).size !== documents.length) {
    throw Object.assign(new Error("No puedes vincular el mismo documento más de una vez."), { status: 422 });
  }
  return documents;
}

export function createBrokerProspectsRouter({ prisma, assertAssignedUser, convert }) {
  const router = Router();
  const type = "broker_capture_prospect";
  const scoped = (req, extra = {}) => brokerRecordWhere(req, { ...extra, recordType: type });
  const audited = (db, req, id, action, metadata = {}) => db.tenantAuditLog.create({ data: { tenantId: req.tenantId, actorUserId: req.user.id, action, entity: type, entityId: id, metadata } });
  const handle = fn => async (req, res) => { try { await fn(req, res); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error("[BROKER_PROSPECT]", e.code || e.name); res.status(500).json({ error: "No se pudo guardar la captación. Recarga y vuelve a intentar." }); } };
  router.get("/", requireBrokerAction("commercial", "VIEW"), handle(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = scoped(req);
    const [rows, total] = await Promise.all([prisma.industryRecord.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*100, take: 100 }), prisma.industryRecord.count({ where })]);
    res.json({ items: rows.map(r => prospectPresentation(r)), total, page, pageSize: 100 });
  }));
  router.post("/", requireBrokerAction("commercial", "CREATE"), handle(async (req, res) => {
    const data = prospectInput(req.body);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(req.body.requestKey || "")) return res.status(422).json({ error: "Falta el identificador de la solicitud." });
    const assignedToId = String(req.body.assignedToId || req.user.id);
    if (assignedToId !== req.user.id && !canBrokerAction(req.brokerAccess, "commercial", "ASSIGN")) return res.status(403).json({ error: "No puedes asignar el prospecto a otra persona." });
    await assertAssignedUser(req, assignedToId);
    const id = "prospect_" + createHash("sha256").update(`${req.tenantId}:${req.user.id}:${req.body.requestKey}`).digest("hex");
    const saved = await prisma.$transaction(async db => {
      const existing = await db.industryRecord.findFirst({ where: scoped(req, { id }) });
      if (existing) return existing;
      const created = await db.industryRecord.create({ data: { id, tenantId: req.tenantId, recordType: type, title: data.title, assignedToId, status: "ACTIVE", data: prospectEvent({ ...data, stage: "PROSPECCION", stageEnteredAt: new Date().toISOString(), isReferral: req.body.isReferral === true }, "PROSPECTO_CREADO", req.user.id) } });
      await audited(db, req, id, "PROSPECTO_CREADO");
      return created;
    });
    res.status(201).json(prospectPresentation(saved));
  }));
  router.get("/:id/owner", requireBrokerAction("commercial", "VIEW"), handle(async (req, res) => {
    const prospect = await prisma.industryRecord.findFirst({ where: scoped(req, { id: req.params.id }) });
    if (!prospect?.data?.conversion?.ownerId) return res.status(404).json({ error: "Captación convertida no encontrada en tu alcance." });
    const owner = await prisma.industryRecord.findFirst({ where: { tenantId: prospect.tenantId, id: prospect.data.conversion.ownerId, recordType: "owner" } });
    if (!owner) return res.status(404).json({ error: "Propietario no encontrado." });
    // Solo la ficha de contacto vinculada, nunca otras propiedades del dueño.
    res.json({ id: owner.id, name: owner.title, rut: owner.data?.rut || "", phone: owner.data?.phone || "", email: owner.data?.email || "", propertyId: prospect.data.conversion.propertyId, propertyTitle: prospect.title });
  }));
  router.get("/:id", requireBrokerAction("commercial", "VIEW"), handle(async (req, res) => {
    const row = await prisma.industryRecord.findFirst({ where: scoped(req, { id: req.params.id }) });
    if (!row) return res.status(404).json({ error: "Captación no encontrada en tu alcance." });
    res.json(prospectPresentation(row));
  }));
  router.post("/:id/conversion-preview", requireBrokerAction("commercial", "EDIT"), requireBrokerAction("operations", "CREATE"), handle(async (req, res) => {
    const row = await prisma.industryRecord.findFirst({ where: scoped(req, { id: req.params.id }) });
    if (!row) return res.status(404).json({ error: "Prospecto no encontrado en tu alcance." });
    if (row.data.version !== req.body.version) return res.status(409).json({ error: "La ficha cambió. Actualiza antes de revisar la conversión." });
    res.json(brokerConversionPlan(row, req.body));
  }));
  router.post("/:id/actions", requireBrokerAction("commercial", "EDIT"), handle(async (req, res) => {
    const { action, version } = req.body;
    const allowed = ["SAVE", "ASSIGN", "ADVANCE", "NOTE", "VALUE", "ESTIMATE", "LINK_DOCUMENTS", "UNLINK_DOCUMENT", "DISCARD", "REOPEN", "CONVERT_REFERRAL", "SIGN"];
    if (!allowed.includes(action)) return res.status(422).json({ error: "Acción desconocida." });
    if (action === "SIGN" && !canBrokerAction(req.brokerAccess, "operations", "CREATE")) return res.status(403).json({ error: "Tu perfil no permite convertir mandatos en negocios." });
    const saved = await prisma.$transaction(async db => {
      const row = await db.industryRecord.findFirst({ where: scoped(req, { id: req.params.id }) });
      if (!row) throw Object.assign(new Error("Prospecto no encontrado en tu alcance."), { status: 404 });
      if (action === "SIGN" && row.data.outcome === "CONVERTED") return row;
      await claimProspect(db, row, version);
      let data = row.data;
      let assignedToId = row.assignedToId;
      if (data.outcome && !(action === "REOPEN" && data.outcome === "DISCARDED")) throw Object.assign(new Error("La captación está cerrada."), { status: 409 });
      let details = {};
      if (action === "ASSIGN") {
        if (!canBrokerAction(req.brokerAccess, "commercial", "REASSIGN")) throw Object.assign(new Error("No tienes permiso para reasignar prospectos."), { status: 403 });
        assignedToId = String(req.body.assignedToId || "");
        if (!assignedToId) throw Object.assign(new Error("Selecciona un responsable."), { status: 422 });
        await assertAssignedUser(req, assignedToId);
        details = { previousAssignedToId: row.assignedToId, assignedToId };
      }
      if (action === "SAVE") {
        const next = prospectInput(req.body.fields || {}, data);
        if (data.valuation && ["comuna", "propertyType", "intendedService", "currency", "usableSquareMeters"].some(key => next[key] !== data[key])) {
          throw Object.assign(new Error("La valorización ya fue emitida. Registra una nueva captación si cambia el inmueble, destino o moneda."), { status: 422 });
        }
        data = next;
      }
      if (action === "LINK_DOCUMENTS") {
        const requested = captureDocumentsInput(req.body.documents);
        const records = await db.industryRecord.findMany({
          where: {
            tenantId: row.tenantId,
            recordType: "document",
            status: "ACTIVE",
            id: { in: requested.map((document) => document.id) }
          }
        });
        if (records.length !== requested.length) {
          throw Object.assign(new Error("Uno o más documentos no existen, fueron eliminados o no pertenecen a esta empresa."), { status: 404 });
        }
        const byId = new Map(records.map((document) => [document.id, document]));
        const additions = requested.map((document) => {
          const source = byId.get(document.id);
          const sourceData = source?.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data : {};
          return {
            id: document.id,
            role: document.role,
            title: String(source?.title || "Documento"),
            originalName: String(sourceData.originalName || source?.title || "Documento"),
            mimeType: String(sourceData.mimeType || "application/octet-stream"),
            linkedAt: new Date().toISOString()
          };
        });
        const previous = Array.isArray(data.captureDocuments) ? data.captureDocuments.filter((document) => document && !requested.some((item) => item.id === document.id)) : [];
        data = { ...data, captureDocuments: [...previous, ...additions] };
        details = { documentIds: additions.map((document) => document.id), documentRoles: additions.map((document) => document.role), documentCount: additions.length };
      }
      if (action === "UNLINK_DOCUMENT") {
        const documentId = String(req.body.documentId || "").trim();
        if (!/^[a-zA-Z0-9_-]{8,160}$/.test(documentId)) throw Object.assign(new Error("El documento indicado no es válido."), { status: 422 });
        const previous = Array.isArray(data.captureDocuments) ? data.captureDocuments : [];
        const linked = previous.find((document) => document?.id === documentId);
        if (!linked) throw Object.assign(new Error("Ese documento no está vinculado a esta captación."), { status: 404 });
        // Solo se elimina la referencia de esta captación. El archivo sigue disponible para
        // otros expedientes del mismo tenant y no se borra del almacenamiento compartido.
        data = { ...data, captureDocuments: previous.filter((document) => document?.id !== documentId) };
        details = { documentId, documentRole: linked.role || "OTRO" };
      }
      if (action === "ADVANCE") data = prospectTransition(data, req.body.stage);
      if (action === "NOTE") {
        const note = String(req.body.note || "").trim();
        if (!note || note.length > 5000) throw Object.assign(new Error("La nota debe contener entre 1 y 5.000 caracteres."), { status: 422 });
        details = { note };
      }
      if (["VALUE", "ESTIMATE"].includes(action)) {
        if (!["TASACION", "NEGOCIACION"].includes(data.stage)) throw Object.assign(new Error("Avanza a tasación antes de valorizar."), { status: 422 });
        let valuation;
        if (action === "ESTIMATE") {
          const records = await db.industryRecord.findMany({ where: brokerRecordWhere(req, { recordType: "property", status: "ACTIVE" }), take: 1000 });
          valuation = comparableValuation(data, records);
        } else {
          const amount = Number(req.body.amount), rationale = String(req.body.rationale || "").trim();
          if (!(amount > 0) || !Number.isFinite(amount) || rationale.length < 10) throw Object.assign(new Error("Indica un valor positivo y el fundamento de la evaluación."), { status: 422 });
          valuation = { amount, rationale: rationale.slice(0, 5000), method: "EVALUACION_PROFESIONAL", currency: data.currency, generatedAt: new Date().toISOString(), preliminary: true };
        }
        data = { ...data, valuation };
        details = { valuation };
      }
      if (action === "DISCARD") {
        const reason = String(req.body.reason || "").trim();
        if (!reason) throw Object.assign(new Error("Indica el motivo del descarte."), { status: 422 });
        data = { ...data, outcome: "DISCARDED" }; details = { reason: reason.slice(0, 1000) };
      }
      if (action === "REOPEN") {
        if (data.outcome !== "DISCARDED") throw Object.assign(new Error("Solo se reabren captaciones descartadas."), { status: 422 });
        data = { ...data, outcome: null, stageEnteredAt: new Date().toISOString() };
      }
      if (action === "CONVERT_REFERRAL") {
        if (!data.isReferral || data.referralConvertedAt) throw Object.assign(new Error("El referido ya fue incorporado o no corresponde."), { status: 409 });
        data = { ...data, referralConvertedAt: new Date().toISOString() };
      }
      if (action === "SIGN") {
        if (data.isReferral && !data.referralConvertedAt) throw Object.assign(new Error("Incorpora primero el referido al embudo."), { status: 422 });
        const { terms } = brokerConversionPlan(row, req.body);
        // Defensa en profundidad: el POST acotado ya exige la empresa activa;
        // cada relación y auditoría generada también conserva el tenant de origen.
        const sourceRequest = { ...req, tenantId: row.tenantId };
        await assertAssignedUser(sourceRequest, row.assignedToId);
        const links = await convert(db, sourceRequest, row, terms);
        data = { ...data, outcome: "CONVERTED", convertedAt: new Date().toISOString(), conversion: links, mandate: terms };
        details = { ...links, ...terms };
      }
      const events = { SAVE: "FICHA_ACTUALIZADA", ASSIGN: "RESPONSABLE_REASIGNADO", ADVANCE: "ETAPA_ACTUALIZADA", NOTE: "NOTA_REGISTRADA", VALUE: "VALORIZACION_REGISTRADA", ESTIMATE: "VALORIZACION_GENERADA", LINK_DOCUMENTS: "DOCUMENTOS_VINCULADOS", UNLINK_DOCUMENT: "DOCUMENTO_DESVINCULADO", SIGN: "MANDATO_FIRMADO", DISCARD: "PROSPECTO_DESCARTADO", REOPEN: "PROSPECTO_REABIERTO", CONVERT_REFERRAL: "REFERIDO_CONVERTIDO" };
      const updated = await db.industryRecord.update({ where: { id: row.id }, data: { assignedToId, title: data.title, status: data.outcome ? "ARCHIVED" : "ACTIVE", data: prospectEvent(data, events[action], req.user.id, { ...details, stage: data.stage }) } });
      await audited(db, { ...req, tenantId: row.tenantId }, row.id, events[action], details);
      return updated;
    });
    res.json(prospectPresentation(saved));
  }));
  return router;
}
