/** Archivo: Proporciona infraestructura y utilidades compartidas para credential crypto. */
import crypto from "crypto";
import { env } from "./env.js";

const PREFIX = "enc:v1:";

function secretMaterial({ previous = false } = {}) {
  const dedicatedKey = previous
    ? process.env.CONNECTIONS_ENCRYPTION_PREVIOUS_KEY
    : process.env.CONNECTIONS_ENCRYPTION_KEY;
  if (dedicatedKey) return dedicatedKey;

  if (previous) return null;

  if (env.nodeEnv === "production") {
    throw new Error("CONNECTIONS_ENCRYPTION_KEY es obligatoria en produccion para cifrar credenciales de integraciones.");
  }

  return env.jwtSecret || "evolum-local-development-key";
}

function encryptionKey(options = {}) {
  const material = secretMaterial(options);
  if (!material) return null;
  const raw = String(material).trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Ignora base64 no válido y deriva una clave estable más abajo.
  }

  return crypto.createHash("sha256").update(raw).digest();
}

function decryptWithKey(value, key) {
  const [ivText, tagText, encryptedText] = value.slice(PREFIX.length).split(".");
  if (!ivText || !tagText || !encryptedText) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function credentialEncryptionStatus() {
  return {
    configured: Boolean(String(process.env.CONNECTIONS_ENCRYPTION_KEY || "").trim()),
    previousConfigured: Boolean(String(process.env.CONNECTIONS_ENCRYPTION_PREVIOUS_KEY || "").trim()),
  };
}

export function isEncryptedSecret(value) {
  return String(value || "").startsWith(PREFIX);
}

export function encryptSecret(value) {
  const plain = String(value || "").trim();
  if (!plain) return null;
  if (isEncryptedSecret(plain)) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecretDetails(value) {
  const text = String(value || "");
  if (!text) return { value: null, source: "empty", encrypted: false };
  if (!isEncryptedSecret(text)) return { value: text, source: "plaintext", encrypted: false };

  const currentKey = encryptionKey();
  try {
    return { value: decryptWithKey(text, currentKey), source: "current", encrypted: true };
  } catch {
    const previousKey = encryptionKey({ previous: true });
    if (!previousKey) throw new Error("No se pudo descifrar la credencial con la clave de cifrado configurada.");
    try {
      return { value: decryptWithKey(text, previousKey), source: "previous", encrypted: true };
    } catch {
      throw new Error("No se pudo descifrar la credencial con las claves de rotación configuradas.");
    }
  }
}

export function decryptSecret(value) {
  return decryptSecretDetails(value).value;
}

export function secretNeedsRewrap(value) {
  const details = decryptSecretDetails(value);
  return Boolean(details.value) && details.source !== "current";
}

export function hasSecret(value) {
  return Boolean(String(value || "").trim());
}
