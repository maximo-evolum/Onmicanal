import crypto from "crypto";
import { env } from "./env.js";

const PREFIX = "enc:v1:";

function secretMaterial() {
  const dedicatedKey = process.env.CONNECTIONS_ENCRYPTION_KEY;
  if (dedicatedKey) return dedicatedKey;

  if (env.nodeEnv === "production") {
    throw new Error("CONNECTIONS_ENCRYPTION_KEY es obligatoria en produccion para cifrar credenciales de integraciones.");
  }

  return env.jwtSecret || "evolum-local-development-key";
}

function encryptionKey() {
  const raw = String(secretMaterial()).trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Ignore invalid base64 and derive a stable key below.
  }

  return crypto.createHash("sha256").update(raw).digest();
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

export function decryptSecret(value) {
  const text = String(value || "");
  if (!text) return null;
  if (!isEncryptedSecret(text)) return text;

  const [ivText, tagText, encryptedText] = text.slice(PREFIX.length).split(".");
  if (!ivText || !tagText || !encryptedText) return null;

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function hasSecret(value) {
  return Boolean(String(value || "").trim());
}
