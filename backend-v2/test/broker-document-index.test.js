/** Archivo: Verifica el índice documental derivado y de solo lectura de Broker OS. */
import test from "node:test";
import assert from "node:assert/strict";
import { BROKER_DOCUMENT_SOURCE_TYPES, brokerDocumentSourceArea, buildBrokerDocumentIndex } from "../src/services/broker-document-index.service.js";

const now = new Date("2026-10-30T12:00:00.000Z");
const properties = [{ id: "property-1", title: "Departamento Providencia" }];
const records = [
  { id: "mandate-1", recordType: "property_mandate", title: "Mandato exclusivo", status: "SIGNED", updatedAt: new Date("2026-10-20T12:00:00.000Z"), data: { propertyId: "property-1", ownerName: "Ana Pérez", evidenceReference: "MAND-001", endDate: "2026-11-20" } },
  { id: "legal-1", recordType: "legal_document", title: "Certificado de dominio", status: "PENDING", updatedAt: new Date("2026-10-21T12:00:00.000Z"), data: { propertyId: "property-1", documentType: "Certificado de dominio", ownerName: "Ana Pérez" } },
  { id: "rental-1", recordType: "rental_contract", title: "Contrato de arriendo", status: "ACTIVE", updatedAt: new Date("2026-10-22T12:00:00.000Z"), data: { propertyId: "property-1", tenantName: "Carlos Soto", signedDocumentReference: "ARR-001", contractEndAt: "2026-10-15" } },
  { id: "signature-1", recordType: "digital_signature", title: "Firma de promesa", status: "SIGNED", updatedAt: new Date("2026-10-23T12:00:00.000Z"), data: { propertyId: "property-1", signerName: "Ana Pérez", evidenceReference: "FIRMA-001" } }
];

test("El índice deriva documentos sin duplicar registros ni alterar sus estados", () => {
  const index = buildBrokerDocumentIndex({ properties, records, now });
  assert.equal(index.summary.total, 4);
  assert.equal(index.summary.expiringIn60Days, 1);
  assert.equal(index.summary.overdue, 1);
  assert.equal(index.summary.evidenceIncomplete, 1);
  assert.equal(index.summary.signaturesRegistered, 2);
  const signature = index.items.find((item) => item.sourceRecordId === "signature-1");
  assert.equal(signature.documentStatus, "SIGNED");
  assert.equal(signature.signature.externalIntegration, false);
  assert.match(signature.source.href, /tab=documents/);
  assert.equal(index.items.filter((item) => item.sourceRecordId === "mandate-1").length, 1);
});

test("El índice filtra por propiedad, persona, tipo, estado y vencimiento", () => {
  assert.equal(buildBrokerDocumentIndex({ properties, records, now, filters: { propertyId: "property-1" } }).items.length, 4);
  assert.equal(buildBrokerDocumentIndex({ properties, records, now, filters: { person: "carlos" } }).items.map((item) => item.sourceRecordId).join(), "rental-1");
  assert.equal(buildBrokerDocumentIndex({ properties, records, now, filters: { type: "certificado" } }).items.map((item) => item.sourceRecordId).join(), "legal-1");
  assert.equal(buildBrokerDocumentIndex({ properties, records, now, filters: { status: "SIGNED" } }).items.length, 2);
  assert.equal(buildBrokerDocumentIndex({ properties, records, now, filters: { expiry: "OVERDUE" } }).items.map((item) => item.sourceRecordId).join(), "rental-1");
});

test("El estado firmado no reemplaza una evidencia documental verificable", () => {
  const index = buildBrokerDocumentIndex({
    properties,
    now,
    records: [{ id: "promise-without-proof", recordType: "property_promise", title: "Promesa sin respaldo", status: "SIGNED", updatedAt: now, data: { propertyId: "property-1", buyerName: "Carlos Soto" } }]
  });
  assert.equal(index.items[0].evidence.status, "MISSING");
});

test("Los adjuntos de captación se indexan desde su expediente sin copiar archivos", () => {
  const index = buildBrokerDocumentIndex({
    properties,
    now,
    records: [{ id: "prospect-1", recordType: "broker_capture_prospect", title: "Casa Ñuñoa", status: "TASACION", updatedAt: now, data: { ownerName: "Ana Pérez", captureDocuments: [{ id: "private-file-1", role: "TITULO", originalName: "Certificado de dominio.pdf" }, { id: "private-file-2", role: "PLANO", originalName: "Plano de arquitectura.pdf" }] } }]
  });
  assert.equal(index.summary.total, 2);
  assert.equal(index.items.every((item) => item.evidence.status === "REGISTERED"), true);
  assert.equal(index.items[0].source.href, "/realty?view=operations&prospectId=prospect-1");
  assert.equal(index.items.some((item) => item.documentType === "Antecedente de título"), true);
});

test("El contrato documental cubre captación, negocio, arriendo y administración", () => {
  for (const recordType of ["broker_capture_prospect", "property_appraisal", "property_mandate", "property_offer", "property_promise", "rental_application", "rental_contract", "administration_profile", "administration_liquidation"]) {
    assert.equal(BROKER_DOCUMENT_SOURCE_TYPES.includes(recordType), true);
    assert.ok(brokerDocumentSourceArea(recordType));
  }
});
