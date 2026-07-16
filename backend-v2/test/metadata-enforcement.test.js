import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMetadataSchema } from "../src/lib/metadata-enforcement.js";

const schema = { version: 3, fields: { price: { type: "number", required: true } }, policies: {} };

test("published schemas start in compatible mode and report invalid metadata without blocking", () => {
  const evaluation = evaluateMetadataSchema({ data: { price: "100" }, schema });
  assert.equal(evaluation.mode, "COMPATIBLE");
  assert.equal(evaluation.blocking, false);
  assert.equal(evaluation.result.ok, false);
});

test("strict published schemas block invalid metadata", () => {
  const evaluation = evaluateMetadataSchema({ data: { price: "100" }, schema: { ...schema, policies: { enforcement: "STRICT" } } });
  assert.equal(evaluation.mode, "STRICT");
  assert.equal(evaluation.blocking, true);
});
