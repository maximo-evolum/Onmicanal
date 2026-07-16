import test from "node:test";
import assert from "node:assert/strict";
import { validateMetadataSchemaDefinition } from "../src/lib/metadata-governance.js";

test("requires a purpose for personal or sensitive metadata fields", () => {
  const errors = validateMetadataSchemaDefinition({ phone: { type: "string", sensitivity: "PERSONAL" } });
  assert.equal(errors.some((item) => item.code === "PURPOSE_REQUIRED"), true);
});

test("accepts governed metadata field definitions", () => {
  const errors = validateMetadataSchemaDefinition({ phone: { type: "string", sensitivity: "PERSONAL", purpose: "Contacto comercial", retentionDays: 365, accessRoles: ["OWNER", "AGENT"] } });
  assert.deepEqual(errors, []);
});
