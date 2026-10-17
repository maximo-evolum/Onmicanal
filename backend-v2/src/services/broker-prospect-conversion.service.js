/** Archivo: Implementa reglas de negocio y procesos del dominio broker prospect conversion. */
import { normalizeBrokerCapture } from "./broker-capture.service.js";
import { stagesForBrokerOperation, brokerStageChecklist } from "./broker-workflows.service.js";
import { BROKER_JOURNEY_VERSION } from "./broker-operation-contract.service.js";
import { createHash } from "node:crypto";
import { CONVERSION_VERSION } from "./broker-conversion-plan.service.js";
const dataOf = record => record?.data || {};
export async function convertBrokerProspect(db, req, prospect, terms, { ensureBrokerCaptureProperty, propertyDataFromCapture, ensureBrokerSaleCase, ensureBrokerRentalCase }) {
  const raw = prospect.data;
  const tenantId = req.tenantId;
  const assignedToId = prospect.assignedToId;
  // Las claves primarias estables son una segunda protección detrás del CAS transaccional del prospecto.
  const entityId = kind => `bc_${kind}_${createHash('sha256').update(`${tenantId}:${prospect.id}`).digest('hex')}`;
  const convertedAt = new Date().toISOString();
  const operationType = { VENTA: "SALE", ARRIENDO: "RENTAL", ADMINISTRACION: "ADMINISTRATION" }[raw.intendedService];
  // Los adjuntos siguen siendo documentos privados del tenant. Al convertir la
  // captación se copian sus referencias al expediente, nunca se duplican ni se
  // vuelven públicos por una URL que pueda compartirse fuera de la sesión.
  const captureDocuments = Array.isArray(raw.captureDocuments) ? raw.captureDocuments : [];
  const capture = normalizeBrokerCapture({ ...raw, captureBrokerId: assignedToId, status: "MANDATO_FIRMADO", suggestedPrice: raw.valuation?.amount, preliminaryAppraisal: raw.valuation?.amount, comparableSummary: raw.valuation?.rationale, documentChecklist: captureDocuments });
  const { stage: prospectStage, timeline: captureTimeline, version: prospectVersion, outcome, ...propertyFields } = raw;
  const propertyData = propertyDataFromCapture({ ...propertyFields, region: raw.region || "Sin informar", currency: terms.currency, captureTimeline: captureTimeline || [], price: terms.publicationPrice, commissionRatePct: terms.commissionPct, assignedBrokerId: assignedToId, prospectId: prospect.id }, capture);
  const property = await db.industryRecord.create({ data: { id: entityId('property'), tenantId, assignedToId, recordType: "property", title: raw.title, status: "ACTIVE", data: propertyData } });
  const strictProperty = await ensureBrokerCaptureProperty(db, { tenantId, property, propertyData });
  await db.brokerPropertyCapture.create({ data: { tenantId, propertyId: strictProperty.id, ...capture } });
  let owner = await db.industryRecord.findFirst({ where: { tenantId, recordType: "owner", data: { path: ["brokerOwnerId"], equals: strictProperty.ownerId } } });
  if (!owner) owner = await db.industryRecord.create({ data: { tenantId, assignedToId, recordType: "owner", title: raw.ownerName, status: "ACTIVE", data: { brokerOwnerId: strictProperty.ownerId, rut: raw.ownerRut || "", phone: raw.ownerPhone || "", email: raw.ownerEmail || "", propertyId: property.id, propertyIds: [property.id], source: "captacion_broker" } } });
  else await db.industryRecord.update({ where: { id: owner.id }, data: { data: { ...dataOf(owner), propertyIds: [...new Set([...(Array.isArray(dataOf(owner).propertyIds) ? dataOf(owner).propertyIds : []), dataOf(owner).propertyId, property.id].filter(Boolean))] } } });
  const end = new Date(terms.signedAt);
  end.setUTCDate(end.getUTCDate() + terms.exclusivityDays);
  const mandate = await db.industryRecord.create({ data: { id: entityId('mandate'), tenantId, assignedToId, recordType: "property_mandate", title: `Mandato · ${raw.title}`, status: "SIGNED", data: { propertyId: property.id, ownerId: strictProperty.ownerId, ownerRecordId: owner.id, ownerName: raw.ownerName, operationId: entityId('operation'), startDate: terms.signedAt, endDate: end.toISOString(), exclusivityDays: terms.exclusivityDays, exclusivityMonths: terms.exclusivityDays / 30, commissionRatePct: terms.commissionPct, publicationPrice: terms.publicationPrice, currency: terms.currency, evidenceReference: terms.evidenceReference, evidenceDocumentIds: captureDocuments.filter((document) => document?.role === "MANDATO").map((document) => document.id), signatureSource: "EVIDENCIA_REGISTRADA_POR_USUARIO", prospectId: prospect.id } } });
  const stage = stagesForBrokerOperation(operationType)[0];
  const handoff = { version: CONVERSION_VERSION, convertedAt, convertedBy: req.user.id, prospectId: prospect.id, ownerRecordId: owner.id, propertyId: property.id, mandateId: mandate.id, origin: raw.captureOrigin, intendedService: raw.intendedService, ownerName: raw.ownerName, propertyTitle: raw.title, address: raw.address, comuna: raw.comuna, valuation: raw.valuation || null, captureHistory: captureTimeline || [], captureDocuments, terms: { ...terms, expiresAt: end.toISOString() } };
  const operation = await db.industryRecord.create({ data: { id: entityId('operation'), tenantId, assignedToId, recordType: "broker_operation", title: `${({ SALE: "Venta", RENTAL: "Arriendo", ADMINISTRATION: "Administración" })[operationType]} · ${raw.title}`, status: "ACTIVE", data: { operationType, stage, stageEnteredAt: convertedAt, propertyId: property.id, mandateId: mandate.id, prospectId: prospect.id, ownerId: strictProperty.ownerId, ownerRecordId: owner.id, ownerName: raw.ownerName, currency: terms.currency, price: terms.publicationPrice, commissionRatePct: terms.commissionPct, mandateTerms: handoff.terms, conversion: handoff, journeyVersion: BROKER_JOURNEY_VERSION, checklist: brokerStageChecklist(operationType, stage), timeline: [{ at: convertedAt, type: "MANDATO_FIRMADO", stage, note: "Conversión de captación con evidencia de mandato registrado; no acredita aprobación jurídica ni pago de comisión", actorUserId: req.user.id, ...terms }] } } });
  if (operationType === "SALE") await ensureBrokerSaleCase(db, { tenantId, operation, property });
  if (operationType === "RENTAL") await ensureBrokerRentalCase(db, { tenantId, operation, property });
  return { propertyId: property.id, ownerId: owner.id, operationId: operation.id, mandateId: mandate.id };
}

