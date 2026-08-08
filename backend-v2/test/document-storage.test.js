import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertDocumentStorageReady,
  createDocumentStorageKey,
  documentStorageStatus,
  validateUploadedDocumentFile
} from "../src/services/document-storage.service.js";

test("las claves de almacenamiento de documentos no conservan rutas del cliente", () => {
  assert.equal(
    createDocumentStorageKey("tenant/../uno", "../../reporte final.pdf"),
    "tenant-..-uno/..-..-reporte-final.pdf"
  );
});

test("la carga valida la firma real y no solo la extensión declarada", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evolum-document-test-"));
  try {
    const validPdf = path.join(directory, "informe.pdf");
    const renamedExecutable = path.join(directory, "malicioso.pdf");
    await writeFile(validPdf, Buffer.from("%PDF-1.7\ncontenido de prueba"));
    await writeFile(renamedExecutable, Buffer.from("MZ\x90\x00archivo no permitido"));

    await assert.doesNotReject(validateUploadedDocumentFile({ filePath: validPdf, fileName: "informe.pdf" }));
    await assert.rejects(
      validateUploadedDocumentFile({ filePath: renamedExecutable, fileName: "malicioso.pdf" }),
      { code: "DOCUMENT_CONTENT_INVALID", statusCode: 415 }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el modo durable bloquea cargas si falta configurar Azure Blob", () => {
  const previousDriver = process.env.DOCUMENT_STORAGE_DRIVER;
  const previousUrl = process.env.AZURE_BLOB_CONTAINER_URL;
  const previousRequired = process.env.DOCUMENT_STORAGE_REQUIRE_DURABLE;
  try {
    process.env.DOCUMENT_STORAGE_DRIVER = "local";
    process.env.AZURE_BLOB_CONTAINER_URL = "";
    process.env.DOCUMENT_STORAGE_REQUIRE_DURABLE = "true";
    const status = documentStorageStatus();
    assert.equal(status.durable, false);
    assert.equal(status.ready, false);
    assert.throws(assertDocumentStorageReady, { code: "DOCUMENT_STORAGE_NOT_READY", statusCode: 503 });
  } finally {
    if (previousDriver === undefined) delete process.env.DOCUMENT_STORAGE_DRIVER; else process.env.DOCUMENT_STORAGE_DRIVER = previousDriver;
    if (previousUrl === undefined) delete process.env.AZURE_BLOB_CONTAINER_URL; else process.env.AZURE_BLOB_CONTAINER_URL = previousUrl;
    if (previousRequired === undefined) delete process.env.DOCUMENT_STORAGE_REQUIRE_DURABLE; else process.env.DOCUMENT_STORAGE_REQUIRE_DURABLE = previousRequired;
  }
});
