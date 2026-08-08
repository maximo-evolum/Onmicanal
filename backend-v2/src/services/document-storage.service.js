import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

function safeSegment(value) {
  return String(value || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "") || "document";
}

export function documentStorageDriver() {
  return String(process.env.DOCUMENT_STORAGE_DRIVER || "local").trim().toLowerCase() === "azure_blob"
    ? "azure_blob"
    : "local";
}

/**
 * Estado seguro del almacenamiento de documentos. No devuelve URLs ni SAS
 * tokens: sirve para que operaciones pueda saber si los archivos sobrevivirán
 * a un redeploy sin exponer secretos de Azure.
 */
export function documentStorageStatus() {
  const driver = documentStorageDriver();
  const azureConfigured = Boolean(String(process.env.AZURE_BLOB_CONTAINER_URL || "").trim());
  const durableRequired = String(process.env.DOCUMENT_STORAGE_REQUIRE_DURABLE || "").trim().toLowerCase() === "true";
  const durable = driver === "azure_blob" && azureConfigured;
  return {
    driver,
    durable,
    durableRequired,
    ready: driver !== "azure_blob" ? !durableRequired : azureConfigured,
    label: durable
      ? "Almacenamiento privado externo configurado"
      : durableRequired
        ? "Falta configurar almacenamiento privado externo"
        : "Almacenamiento local temporal"
  };
}

export function assertDocumentStorageReady() {
  const status = documentStorageStatus();
  if (status.ready) return status;
  const error = new Error("La carga de documentos está temporalmente deshabilitada hasta configurar almacenamiento privado.");
  error.statusCode = 503;
  error.code = "DOCUMENT_STORAGE_NOT_READY";
  throw error;
}

export function createDocumentStorageKey(tenantId, fileName) {
  return `${safeSegment(tenantId)}/${safeSegment(fileName)}`;
}

function azureBlobUrl(key) {
  const containerUrl = String(process.env.AZURE_BLOB_CONTAINER_URL || "").trim();
  if (!containerUrl) throw new Error("Falta AZURE_BLOB_CONTAINER_URL para el almacenamiento privado de documentos.");
  const parsed = new URL(containerUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return parsed.toString();
}

function contentValidationError(message) {
  const error = new Error(message);
  error.statusCode = 415;
  error.code = "DOCUMENT_CONTENT_INVALID";
  return error;
}

function hasPrefix(buffer, ...bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

async function readHeader(filePath, length = 512) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Multer puede comprobar el MIME declarado por el cliente, pero no el contenido
 * real. Esta verificación ligera bloquea archivos ejecutables renombrados sin
 * interpretar documentos completos ni cargar archivos enteros en RAM.
 */
export async function validateUploadedDocumentFile({ filePath, fileName }) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const header = await readHeader(filePath);
  const isZip = hasPrefix(header, 0x50, 0x4b) && [0x03, 0x05, 0x07].includes(header[2]) && [0x04, 0x06, 0x08].includes(header[3]);
  const isOle = hasPrefix(header, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

  if (extension === ".pdf" && !hasPrefix(header, 0x25, 0x50, 0x44, 0x46, 0x2d)) {
    throw contentValidationError("El archivo no contiene un PDF válido.");
  }
  if (extension === ".png" && !hasPrefix(header, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    throw contentValidationError("El archivo no contiene una imagen PNG válida.");
  }
  if ([".jpg", ".jpeg"].includes(extension) && !hasPrefix(header, 0xff, 0xd8, 0xff)) {
    throw contentValidationError("El archivo no contiene una imagen JPEG válida.");
  }
  if (extension === ".webp" && !(hasPrefix(header, 0x52, 0x49, 0x46, 0x46) && header.subarray(8, 12).toString("ascii") === "WEBP")) {
    throw contentValidationError("El archivo no contiene una imagen WEBP válida.");
  }
  if (extension === ".xlsx" && !isZip) {
    throw contentValidationError("El archivo no contiene una planilla XLSX válida.");
  }
  if ([".doc", ".xls"].includes(extension) && !(isOle || isZip)) {
    throw contentValidationError("El archivo Office no tiene un formato válido.");
  }
  if ([".txt", ".csv"].includes(extension) && header.includes(0)) {
    throw contentValidationError("El archivo de texto contiene datos binarios no permitidos.");
  }
  return true;
}

async function requireAzureResponse(response, action) {
  if (response.ok) return response;
  const detail = await response.text().catch(() => "");
  throw new Error(`Azure Blob no pudo ${action} el documento (${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}).`);
}

export async function storeDocumentFile({ tenantId, filePath, fileName, mimeType }) {
  assertDocumentStorageReady();
  const driver = documentStorageDriver();
  const storageKey = createDocumentStorageKey(tenantId, fileName);
  if (driver === "local") return { driver, storageKey };
  const content = await fs.promises.readFile(filePath);
  const response = await fetch(azureBlobUrl(storageKey), {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": mimeType || "application/octet-stream" },
    body: content
  });
  await requireAzureResponse(response, "guardar");
  await fs.promises.unlink(filePath).catch(() => undefined);
  return { driver, storageKey };
}

export async function openDocumentFile({ tenantId, localRoot, metadata }) {
  const driver = String(metadata?.storageDriver || "local").toLowerCase();
  const storageKey = String(metadata?.storageKey || metadata?.fileName || "");
  if (!storageKey) return null;
  if (driver !== "azure_blob") {
    const tenantDirectory = path.resolve(localRoot, tenantId);
    const filePath = path.resolve(tenantDirectory, path.basename(storageKey));
    if (!filePath.startsWith(`${tenantDirectory}${path.sep}`) || !fs.existsSync(filePath)) return null;
    return { stream: fs.createReadStream(filePath), size: fs.statSync(filePath).size };
  }
  const response = await fetch(azureBlobUrl(storageKey));
  if (response.status === 404) return null;
  await requireAzureResponse(response, "leer");
  if (!response.body) throw new Error("Azure Blob no entregó contenido para el documento.");
  return { stream: Readable.fromWeb(response.body), size: Number(response.headers.get("content-length") || 0) || undefined };
}

export async function removeDocumentFile({ tenantId, localRoot, metadata }) {
  const driver = String(metadata?.storageDriver || "local").toLowerCase();
  const storageKey = String(metadata?.storageKey || metadata?.fileName || "");
  if (!storageKey) return;
  if (driver !== "azure_blob") {
    const tenantDirectory = path.resolve(localRoot, tenantId);
    const filePath = path.resolve(tenantDirectory, path.basename(storageKey));
    if (filePath.startsWith(`${tenantDirectory}${path.sep}`)) await fs.promises.unlink(filePath).catch(() => undefined);
    return;
  }
  const response = await fetch(azureBlobUrl(storageKey), { method: "DELETE" });
  if (response.status !== 404) await requireAzureResponse(response, "eliminar");
}
