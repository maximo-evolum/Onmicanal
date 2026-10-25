/** Archivo: Verifica las reglas de borrador, aprobación y proveedor de publicaciones Broker OS. */
import test from "node:test";
import assert from "node:assert/strict";
import { brokerPublicationAnalytics, brokerPublicationExport, brokerPublicationReadiness, createBrokerPublicationData, normalizeBrokerPublicationMetrics, normalizeBrokerPublicationProvider, transitionBrokerPublication } from "../src/services/broker-publication.service.js";

const property = {
  id: "property-1",
  title: "Departamento Parque Bustamante",
  data: {
    propertyType: "Departamento",
    operation: "VENTA",
    price: 5200,
    currency: "UF",
    address: "Av. Bustamante 245",
    comuna: "Providencia",
    region: "Metropolitana",
    bedrooms: 2,
    bathrooms: 2,
    usableSquareMeters: 72,
    photoUrls: ["https://cdn.example/foto.jpg"],
    publicationReadiness: "LISTA_PARA_PUBLICAR",
  },
};

test("la publicación exige ficha, evidencia visual y mandato registrado para revisión", () => {
  const incomplete = brokerPublicationReadiness({ property, mandate: null });
  assert.equal(incomplete.readyForReview, false);
  assert.ok(incomplete.missing.includes("Mandato vigente registrado"));
  const complete = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  assert.equal(complete.readyForReview, true);
  assert.equal(complete.score, 100);
});

test("un borrador no publica en un portal ni habilita un proveedor", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const data = createBrokerPublicationData({ property, channel: "TOCTOC", readiness, actor: "María Corredora" });
  assert.equal(data.publicationStatus, "DRAFT");
  assert.equal(data.provider.integrationEnabled, false);
  assert.equal(data.provider.state, "PENDING_PROVIDER");
  assert.match(data.copy.body, /Providencia/);
});

test("la transición obliga revisión humana antes de proveedor", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const draft = createBrokerPublicationData({ property, channel: "YAPO", readiness, actor: "María Corredora" });
  assert.throws(() => transitionBrokerPublication(draft, "APPROVE", { actor: "Dirección" }), /pendiente de revisión/);
  const pending = transitionBrokerPublication(draft, "REQUEST_REVIEW", { actor: "María Corredora" });
  const approved = transitionBrokerPublication(pending, "APPROVE", { actor: "Dirección" });
  const provider = transitionBrokerPublication(approved, "PREPARE_PROVIDER", { actor: "Dirección" });
  assert.equal(provider.publicationStatus, "PROVIDER_PENDING");
  assert.equal(provider.lifecycle.at(-1).action, "PROVEEDOR_PENDIENTE");
});

test("el proveedor no acepta secretos y el rendimiento no permite cantidades negativas", () => {
  const provider = normalizeBrokerPublicationProvider("PORTAL_INMOBILIARIO", { providerStatus: "CONTRACTED", accountReference: "Cuenta demostración", notes: "Integración pendiente" });
  const metrics = normalizeBrokerPublicationMetrics({ reportDate: "2026-10-24", views: 120, contacts: -3, favorites: 7, publishedUrl: "https://portal.ejemplo/publicacion" });
  assert.equal(provider.externalPublishingEnabled, false);
  assert.equal(provider.credentialStorage, "CENTRO_DE_CONEXIONES_CIFRADO");
  assert.equal(metrics.contacts, 0);
});

test("la analítica y el contrato de salida no declaran una publicación externa", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const data = createBrokerPublicationData({ property, channel: "YAPO", readiness, actor: "María Corredora" });
  data.metrics = normalizeBrokerPublicationMetrics({ reportDate: "2026-10-24", views: 80, contacts: 4, favorites: 2 });
  const record = { id: "publication-1", title: "Publicación", data, status: "DRAFT" };
  const analytics = brokerPublicationAnalytics([record]);
  const exported = brokerPublicationExport({ publication: record, property });
  assert.equal(analytics.contacts, 4);
  assert.equal(analytics.contactRatePct, 5);
  assert.equal(exported.externalDelivery, false);
  assert.match(exported.message, /No acredita/);
});
