/** Archivo: Centraliza el modo de rotación de credenciales y su postura segura sin revelar secretos. */
import { credentialEncryptionStatus } from "./credential-crypto.js";

const enabled = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const configured = (name) => Boolean(String(process.env[name] || "").trim());
const atLeast = (name, size) => String(process.env[name] || "").trim().length >= size;

export class CredentialRotationPausedError extends Error {
  constructor(operation = "esta operación") {
    super(`La rotación de credenciales está activa. ${operation} no puede comunicarse con proveedores externos hasta completar el reemplazo y las verificaciones.`);
    this.name = "CredentialRotationPausedError";
    this.status = 503;
    this.code = "CREDENTIAL_ROTATION_ACTIVE";
  }
}

export function credentialRotationActive() {
  return enabled(process.env.CREDENTIAL_ROTATION_MODE);
}

export function assertExternalOperationAllowed(operation) {
  if (credentialRotationActive()) throw new CredentialRotationPausedError(operation);
}

function databaseExposure() {
  const value = String(process.env.DATABASE_URL || "").trim();
  if (!value) return "missing";
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith(".railway.internal") ? "private" : "public_or_external";
  } catch {
    return "invalid";
  }
}

function control(key, label, isActive, detail = null) {
  return { key, label, status: isActive ? "active" : "review", ...(detail ? { detail } : {}) };
}

// Este resumen nunca incorpora valores, longitudes exactas, hosts ni huellas de
// los secretos. Puede mostrarse a responsables técnicos sin exponer credenciales.
export function securityRotationPosture() {
  const encryption = credentialEncryptionStatus();
  const database = databaseExposure();
  const rotationMode = credentialRotationActive();
  const stateSecretConfigured = configured("CONNECTIONS_STATE_SECRET") && atLeast("CONNECTIONS_STATE_SECRET", 32);
  const controls = [
    control("rotation_mode", "Modo de rotación de credenciales", true, rotationMode ? "Llamadas externas pausadas por configuración." : "Las integraciones externas pueden operar."),
    control("jwt_secret", "Secreto de sesiones robusto", configured("JWT_SECRET") && atLeast("JWT_SECRET", 32)),
    control("connections_state", "Secreto independiente para estados OAuth", stateSecretConfigured, stateSecretConfigured ? "Configurado de forma separada." : "Configura CONNECTIONS_STATE_SECRET antes de exigir su uso estricto."),
    control("credential_encryption", "Cifrado de credenciales de integraciones", encryption.configured, encryption.previousConfigured ? "Transición de clave disponible." : "Clave actual configurada."),
    control("credential_key_retirement", "Retiro de clave anterior", !encryption.previousConfigured, encryption.previousConfigured ? "Existe una clave anterior temporal; ejecuta la migración y retírala al finalizar." : "No hay clave anterior configurada."),
    control("metrics_token", "Protección de métricas", configured("METRICS_TOKEN") && atLeast("METRICS_TOKEN", 24)),
    control("database_network", "Acceso de base de datos por red privada", database === "private", database === "private" ? "Configuración interna detectada." : database === "missing" ? "No hay URL de base de datos configurada." : "Revisa la referencia privada de Railway antes del siguiente ciclo de despliegue."),
  ];
  return {
    rotationMode,
    externalOperationsAllowed: !rotationMode,
    generatedAt: new Date().toISOString(),
    controls,
    nextSteps: controls.filter((item) => item.status !== "active").map((item) => item.key),
  };
}
