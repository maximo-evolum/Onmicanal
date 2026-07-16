import test from "node:test";
import assert from "node:assert/strict";
import { validateMetadata } from "../src/lib/metadata.js";

const propertySchema = {
  fields: {
    address: { type: "string", required: true },
    price: { type: "number", required: true },
    operation: { type: "string", options: ["venta", "arriendo"] },
    tags: "array"
  }
};

test("validates required fields, types, and enumerated metadata options", () => {
  const result = validateMetadata({ address: "Av. Central 100", price: "120000", operation: "permuta", tags: "nuevo" }, propertySchema);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((item) => item.code), ["INVALID_TYPE", "INVALID_OPTION", "INVALID_TYPE"]);
});

test("accepts valid metadata and can reject fields outside the published schema", () => {
  const valid = validateMetadata({ address: "Av. Central 100", price: 120000, operation: "venta", tags: ["nuevo"] }, propertySchema, { allowUnknown: false });
  assert.equal(valid.ok, true);

  const extra = validateMetadata({ address: "Av. Central 100", price: 120000, extra: "x" }, propertySchema, { allowUnknown: false });
  assert.equal(extra.ok, false);
  assert.equal(extra.errors.at(-1).code, "UNKNOWN_FIELD");
});
