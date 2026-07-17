import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAiOutput, needsHumanApproval, normalizeAiGovernance } from "../src/services/ai-governance.service.js";

test("las políticas IA conservan límites seguros y acciones que requieren aprobación", () => {
  const governance = normalizeAiGovernance({ requireApprovalFor: ["create_booking"], maxAutonomousActions: 99, blockedTerms: ["secreto"] });
  assert.equal(governance.maxAutonomousActions, 10);
  assert.equal(needsHumanApproval(governance, "create_booking"), true);
  assert.equal(needsHumanApproval(governance, "lookup_products"), false);
});

test("la evaluación de salida detecta términos restringidos", () => {
  const result = evaluateAiOutput({ output: "No compartas el secreto del cliente", governance: { blockedTerms: ["secreto"] } });
  assert.equal(result.passed, false);
  assert.equal(result.matches[0], "secreto");
  assert.equal(result.score, 65);
});
