import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentStorageKey } from "../src/services/document-storage.service.js";

test("las claves de almacenamiento de documentos no conservan rutas del cliente", () => {
  assert.equal(
    createDocumentStorageKey("tenant/../uno", "../../reporte final.pdf"),
    "tenant-..-uno/..-..-reporte-final.pdf"
  );
});
