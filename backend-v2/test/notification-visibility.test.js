/** Archivo: Verifica mediante pruebas automatizadas el aislamiento de notificaciones por vertical. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTIFICATION_SCOPES, notificationScopeFor, notificationVisibleForIndustry } from "../src/lib/notifications.js";

test("clasifica los avisos de Nubox y Finanzas aunque sean registros históricos", () => {
  const nubox = { title: "Nubox sincronizó documentos financieros", data: { provider: "nubox", screen: "connections" } };
  const cartola = { title: "Movimientos bancarios disponibles", data: { body: "Cartola lista para conciliación." } };

  assert.equal(notificationScopeFor(nubox), NOTIFICATION_SCOPES.FINANCE);
  assert.equal(notificationScopeFor(cartola), NOTIFICATION_SCOPES.FINANCE);
  assert.equal(notificationVisibleForIndustry(nubox, "REAL_ESTATE"), false);
  assert.equal(notificationVisibleForIndustry(cartola, "INMOBILIARIA"), false);
  assert.equal(notificationVisibleForIndustry(nubox, "FINANCE"), true);
});

test("Broker OS conserva sus avisos, CRM y Core, pero no recibe finanzas", () => {
  const broker = { title: "Nueva visita confirmada", targetUrl: "/realty?view=activity", data: { notificationType: "broker" } };
  const core = { title: "Nuevo mensaje", targetUrl: "/inbox", data: { notificationType: "message" } };
  const finance = { title: "Finanzas detectó excepciones", targetUrl: "/finance?tab=excepciones", data: { notificationScope: "FINANCE" } };

  assert.equal(notificationScopeFor(broker), NOTIFICATION_SCOPES.REAL_ESTATE);
  assert.equal(notificationScopeFor(core), NOTIFICATION_SCOPES.CORE);
  assert.equal(notificationScopeFor(finance), NOTIFICATION_SCOPES.FINANCE);
  assert.equal(notificationVisibleForIndustry(broker, "REAL_ESTATE"), true);
  assert.equal(notificationVisibleForIndustry(core, "REAL_ESTATE"), true);
  assert.equal(notificationVisibleForIndustry(finance, "REAL_ESTATE"), false);
});

test("la URL financiera domina sobre metadata genérica para impedir cruces", () => {
  const notification = { title: "Resultado disponible", targetUrl: "/finance?tab=cartolas", data: { notificationType: "general", notificationScope: "CORE" } };
  assert.equal(notificationScopeFor(notification), NOTIFICATION_SCOPES.FINANCE);
  assert.equal(notificationVisibleForIndustry(notification, "REAL_ESTATE"), false);
});

test("la ruta protege lista, lectura individual y lectura masiva con el mismo alcance", () => {
  const source = readFileSync(new URL("../src/routes/notifications.routes.js", import.meta.url), "utf8");
  assert.match(source, /notificationVisibleForIndustry\(record, req\.tenant\?\.industry\)/);
  assert.match(source, /notificationVisibleForIndustry\(current, req\.tenant\?\.industry\)/);
  assert.match(source, /visibleIds/);
});
