/** Archivo: Verifica las reglas de borrador, aprobación y proveedor de publicaciones Broker OS. */
import test from "node:test";
import assert from "node:assert/strict";
import { brokerPublicationAnalytics, brokerPublicationConnectionKey, brokerPublicationExport, brokerPublicationProviderPreflight, brokerPublicationReadiness, createBrokerPublicationData, normalizeBrokerPublicationMetrics, normalizeBrokerPublicationProvider, transitionBrokerPublication } from "../src/services/broker-publication.service.js";

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

test("Mercado Libre Inmuebles queda disponible como borrador, no como publicación automática", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const data = createBrokerPublicationData({ property, channel: "MERCADOLIBRE_INMUEBLES", readiness, actor: "María Corredora" });
  assert.equal(data.channelLabel, "Mercado Libre Inmuebles");
  assert.equal(data.publicationStatus, "DRAFT");
  assert.equal(data.provider.integrationEnabled, false);
  assert.equal(data.provider.state, "PENDING_PROVIDER");
});

test("la prevalidación de Mercado Libre cruza revisión, proveedor y OAuth sin habilitar un envío", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const draft = createBrokerPublicationData({ property, channel: "MERCADOLIBRE_INMUEBLES", readiness, actor: "María Corredora" });
  const approved = transitionBrokerPublication(
    transitionBrokerPublication(draft, "REQUEST_REVIEW", { actor: "María Corredora" }),
    "APPROVE",
    { actor: "Dirección" }
  );
  const prepared = transitionBrokerPublication(approved, "PREPARE_PROVIDER", { actor: "Dirección" });
  const result = brokerPublicationProviderPreflight({
    publication: { id: "publication-ml", status: "PROVIDER_PENDING", data: prepared },
    property,
    provider: { data: { providerStatus: "READY_FOR_TEST" } },
    connection: { state: "CONNECTED", label: "Mercado Libre Inmuebles", message: "La última verificación técnica fue satisfactoria." },
  });
  assert.equal(brokerPublicationConnectionKey("MERCADOLIBRE_INMUEBLES"), "broker_mercadolibre_real_estate");
  assert.equal(result.readyForProviderTest, true);
  assert.equal(result.externalDelivery, false);
  assert.equal(result.connection.state, "CONNECTED");
  assert.equal(result.checks.every((check) => check.ready), true);
});

test("la prevalidación bloquea una prueba cuando falta proveedor o conexión", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const data = createBrokerPublicationData({ property, channel: "MERCADOLIBRE_INMUEBLES", readiness, actor: "María Corredora" });
  const result = brokerPublicationProviderPreflight({
    publication: { id: "publication-blocked", status: "DRAFT", data },
    property,
    connection: { state: "NOT_CONFIGURED", label: "Mercado Libre Inmuebles", message: "Aún no se ha iniciado la conexión OAuth de Mercado Libre." },
  });
  assert.equal(result.readyForProviderTest, false);
  assert.equal(result.externalDelivery, false);
  assert.ok(result.missing.includes("Aprobación interna de la publicación"));
  assert.ok(result.missing.includes("Preparación comercial del portal"));
  assert.ok(result.missing.includes("Conexión autorizada del portal"));
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
  const provider = normalizeBrokerPublicationProvider("PORTAL_INMOBILIARIO", { providerStatus: "CONTRACTED", accountReference: "Cuenta demostración", technicalContact: "integraciones@portal.ejemplo", notes: "Integración pendiente", apiKey: "secreto-que-no-debe-guardarse" });
  const metrics = normalizeBrokerPublicationMetrics({ reportDate: "2026-10-24", views: 120, contacts: -3, favorites: 7, publishedUrl: "https://portal.ejemplo/publicacion" });
  assert.equal(provider.externalPublishingEnabled, false);
  assert.equal(provider.credentialStorage, "CENTRO_DE_CONEXIONES_CIFRADO");
  assert.equal("apiKey" in provider, false);
  assert.equal(provider.technicalContact, "integraciones@portal.ejemplo");
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

test("solo una evidencia humana permite registrar una publicación externa manual", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const draft = createBrokerPublicationData({ property, channel: "PORTAL_INMOBILIARIO", readiness, actor: "María Corredora" });
  const approved = transitionBrokerPublication(
    transitionBrokerPublication(draft, "REQUEST_REVIEW", { actor: "María Corredora" }),
    "APPROVE",
    { actor: "Dirección" }
  );
  assert.throws(() => transitionBrokerPublication(approved, "CONFIRM_EXTERNAL_PUBLICATION", { actor: "María Corredora" }), /URL publicada o el comprobante/);
  const published = transitionBrokerPublication(approved, "CONFIRM_EXTERNAL_PUBLICATION", {
    actor: "María Corredora",
    delivery: { externalReference: "PI-2026-001", publishedUrl: "https://portal.ejemplo/PI-2026-001" }
  });
  assert.equal(published.publicationStatus, "PUBLISHED");
  assert.equal(published.provider.deliveryMode, "MANUAL_CONFIRMED");
  assert.equal(published.provider.integrationEnabled, false);
});

test("el rechazo editorial y una incidencia de proveedor exigen una explicación", () => {
  const readiness = brokerPublicationReadiness({ property, mandate: { status: "SIGNED" } });
  const draft = createBrokerPublicationData({ property, channel: "YAPO", readiness, actor: "María Corredora" });
  const pending = transitionBrokerPublication(draft, "REQUEST_REVIEW", { actor: "María Corredora" });
  assert.throws(() => transitionBrokerPublication(pending, "REJECT", { actor: "Dirección" }), /motivo del rechazo/);
  const rejected = transitionBrokerPublication(pending, "REJECT", { actor: "Dirección", note: "Falta validar superficie útil." });
  assert.equal(rejected.publicationStatus, "REJECTED");
  const approved = transitionBrokerPublication(pending, "APPROVE", { actor: "Dirección" });
  assert.throws(() => transitionBrokerPublication(approved, "REPORT_PROVIDER_FAILURE", { actor: "María Corredora" }), /Describe el error/);
  const pendingProvider = transitionBrokerPublication(approved, "REPORT_PROVIDER_FAILURE", { actor: "María Corredora", delivery: { error: "El portal rechazó el formato de la imagen." } });
  assert.equal(pendingProvider.publicationStatus, "PROVIDER_PENDING");
  assert.equal(pendingProvider.provider.deliveryMode, "MANUAL_ERROR_REPORTED");
});
