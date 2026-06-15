import test from "node:test";
import assert from "node:assert/strict";
import { deriveCommercialState } from "../src/lib/commercial-state.js";

test("derives payment pending from latest payment", () => {
  const state = deriveCommercialState({
    conversation: { status: "OPEN" },
    lead: { status: "QUALIFIED" },
    payment: { status: "PENDING" }
  });

  assert.equal(state.code, "PAYMENT_PENDING");
  assert.equal(state.label, "Espera de pago");
});

test("derives reservation from confirmed booking", () => {
  const state = deriveCommercialState({
    conversation: { status: "OPEN" },
    lead: { status: "CONTACTED" },
    booking: { status: "CONFIRMED" }
  });

  assert.equal(state.code, "RESERVED");
});

test("does not downgrade paid state with handoff", () => {
  const state = deriveCommercialState({
    conversation: { status: "OPEN", aiHandoffRequired: true },
    lead: { status: "READY_TO_CLOSE" },
    payment: { status: "PAID" }
  });

  assert.equal(state.code, "PAID");
});
