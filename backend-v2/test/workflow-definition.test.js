import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWorkflowConditions, validateWorkflowDefinition } from "../src/routes/workflows.routes.js";

test("valida acciones y condiciones soportadas", () => {
  const errors = validateWorkflowDefinition({
    conditions: [{ field: "input.source", operator: "equals", value: "web" }],
    actions: [
      { type: "set_status", status: "qualified" },
      { type: "set_field", field: "priority", value: "high" },
      { type: "create_record", recordType: "task" },
      { type: "emit_event", event: "lead.qualified" }
    ]
  });
  assert.deepEqual(errors, []);
});

test("rechaza rutas y acciones inválidas", () => {
  const errors = validateWorkflowDefinition({
    conditions: [{ field: "input.source;drop", operator: "equals", value: "web" }],
    actions: [{ type: "set_field", field: "metadata.*" }, { type: "remove_everything" }]
  });
  assert.equal(errors.length, 3);
});

test("evalúa condiciones sobre input y target", () => {
  const result = evaluateWorkflowConditions([
    { field: "input.source", operator: "equals", value: "web" },
    { field: "target.data.tags", operator: "includes", value: "vip" },
    { field: "input.email", operator: "exists" }
  ], {
    input: { source: "web", email: "cliente@ejemplo.cl" },
    target: { data: { tags: ["vip", "inmobiliaria"] } }
  });
  assert.equal(result.matches, true);
  assert.equal(result.results.length, 3);
});
