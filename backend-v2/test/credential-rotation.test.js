/** Archivo: Verifica la rotación segura de secretos y el bloqueo temporal de integraciones externas. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  credentialEncryptionStatus,
  decryptSecret,
  decryptSecretDetails,
  encryptSecret,
  secretNeedsRewrap,
} from "../src/lib/credential-crypto.js";
import {
  CredentialRotationPausedError,
  assertExternalOperationAllowed,
  credentialRotationActive,
  securityRotationPosture,
} from "../src/lib/security-rotation.js";
import { syncNuboxForTenant } from "../src/services/finance-sync.service.js";
import { prepareCollectionTransport } from "../src/services/finance-collection-transport.service.js";
import { runAutomationCycle } from "../src/services/automation.service.js";
import { sendWhatsAppText } from "../src/services/whatsapp.service.js";
import { sendInstagramText } from "../src/services/instagram.service.js";
import { sendTenantPushNotification } from "../src/lib/push-notifications.js";

const original = Object.fromEntries([
  "CONNECTIONS_ENCRYPTION_KEY",
  "CONNECTIONS_ENCRYPTION_PREVIOUS_KEY",
  "CONNECTIONS_STATE_SECRET",
  "CREDENTIAL_ROTATION_MODE",
  "JWT_SECRET",
  "METRICS_TOKEN",
  "DATABASE_URL",
].map((key) => [key, process.env[key]]));

function restore() {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.after(restore);

test("una clave anterior puede abrir y marcar credenciales que requieren recifrado", () => {
  process.env.CONNECTIONS_ENCRYPTION_KEY = "clave-anterior-de-pruebas-rotacion-2026";
  delete process.env.CONNECTIONS_ENCRYPTION_PREVIOUS_KEY;
  const encryptedWithOldKey = encryptSecret("token-de-prueba");

  process.env.CONNECTIONS_ENCRYPTION_KEY = "clave-nueva-de-pruebas-rotacion-2026";
  process.env.CONNECTIONS_ENCRYPTION_PREVIOUS_KEY = "clave-anterior-de-pruebas-rotacion-2026";
  const details = decryptSecretDetails(encryptedWithOldKey);
  assert.equal(details.value, "token-de-prueba");
  assert.equal(details.source, "previous");
  assert.equal(secretNeedsRewrap(encryptedWithOldKey), true);

  const rewrapped = encryptSecret(details.value);
  assert.equal(decryptSecret(rewrapped), "token-de-prueba");
  assert.equal(decryptSecretDetails(rewrapped).source, "current");
  assert.equal(secretNeedsRewrap(rewrapped), false);
  assert.deepEqual(credentialEncryptionStatus(), { configured: true, previousConfigured: true });
});

test("el modo de rotación impide comunicaciones externas pero no expone secretos", () => {
  process.env.CREDENTIAL_ROTATION_MODE = "true";
  process.env.CONNECTIONS_STATE_SECRET = "estado-oauth-de-pruebas-con-longitud-segura-2026";
  process.env.JWT_SECRET = "sesion-de-pruebas-con-longitud-segura-2026";
  process.env.METRICS_TOKEN = "metricas-de-pruebas-con-longitud-segura-2026";
  process.env.DATABASE_URL = "postgresql://internal@postgres.railway.internal:5432/railway";
  assert.equal(credentialRotationActive(), true);
  assert.throws(() => assertExternalOperationAllowed("una prueba"), CredentialRotationPausedError);

  const posture = securityRotationPosture();
  assert.equal(posture.rotationMode, true);
  assert.equal(posture.externalOperationsAllowed, false);
  assert.equal(posture.controls.find((item) => item.key === "database_network")?.status, "active");
  assert.equal(JSON.stringify(posture).includes(process.env.JWT_SECRET), false);
});

test("el modo de rotación bloquea Nubox, cobranzas y automatizaciones antes de consultar datos", async () => {
  process.env.CREDENTIAL_ROTATION_MODE = "true";
  await assert.rejects(() => syncNuboxForTenant({ tenantId: "tenant-prueba" }), CredentialRotationPausedError);
  await assert.rejects(() => prepareCollectionTransport({}, { tenantId: "tenant-prueba", channel: "gmail", templateName: "cobranza" }), CredentialRotationPausedError);
  assert.deepEqual(await runAutomationCycle(), { processed: 0, skipped: "credential_rotation_active" });
});

test("el modo de rotación bloquea mensajería externa antes de resolver credenciales", async () => {
  const previous = process.env.CREDENTIAL_ROTATION_MODE;
  process.env.CREDENTIAL_ROTATION_MODE = "true";
  try {
    await assert.rejects(() => sendWhatsAppText({ to: "56911111111", message: "prueba" }), { code: "CREDENTIAL_ROTATION_ACTIVE" });
    await assert.rejects(() => sendInstagramText({ to: "123", message: "prueba" }), { code: "CREDENTIAL_ROTATION_ACTIVE" });
    await assert.rejects(() => sendTenantPushNotification({ tenantId: "tenant-prueba", title: "Prueba" }), { code: "CREDENTIAL_ROTATION_ACTIVE" });
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ROTATION_MODE;
    else process.env.CREDENTIAL_ROTATION_MODE = previous;
  }
});
