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

async function requireAzureResponse(response, action) {
  if (response.ok) return response;
  const detail = await response.text().catch(() => "");
  throw new Error(`Azure Blob no pudo ${action} el documento (${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}).`);
}

export async function storeDocumentFile({ tenantId, filePath, fileName, mimeType }) {
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
