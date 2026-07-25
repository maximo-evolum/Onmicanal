import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFinanceAgentPolicy } from "../src/services/finance-agents.service.js";

test("los agentes de Finance OS conservan revision humana por defecto", () => {
  const policy = normalizeFinanceAgentPolicy();
  assert.equal(policy.minimumConfidenceForSuggestion, 80);
  assert.equal(policy.autoCreateExceptions, false);
  assert.equal(policy.collectionsRequireApproval, true);
  assert.equal(policy.updateErpRequiresApproval, true);
  assert.deepEqual(policy.enabledChannels, []);
});

test("la politica de Finance OS limita umbrales y canales permitidos", () => {
  const policy = normalizeFinanceAgentPolicy({
    minimumConfidenceForSuggestion: 120,
    autoCreateExceptions: true,
    collectionsRequireApproval: false,
    enabledChannels: ["whatsapp", "EMAIL", "webhook", "sms", "email"]
  });
  assert.equal(policy.minimumConfidenceForSuggestion, 99);
  assert.equal(policy.autoCreateExceptions, true);
  assert.equal(policy.collectionsRequireApproval, false);
  assert.deepEqual(policy.enabledChannels, ["whatsapp", "email", "sms"]);
});
