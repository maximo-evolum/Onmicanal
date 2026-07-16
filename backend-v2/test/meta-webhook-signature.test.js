import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyMetaWebhookSignature } from "../src/lib/meta-webhook-signature.js";

const appSecret = "test-meta-app-secret";
const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

test("accepts a valid Meta SHA-256 webhook signature", () => {
  assert.equal(verifyMetaWebhookSignature({ rawBody, signature, appSecret }), true);
});

test("rejects absent, forged, or mismatched Meta webhook signatures", () => {
  assert.equal(verifyMetaWebhookSignature({ rawBody, signature: "", appSecret }), false);
  assert.equal(verifyMetaWebhookSignature({ rawBody, signature: "sha256=" + "0".repeat(64), appSecret }), false);
  assert.equal(verifyMetaWebhookSignature({ rawBody: Buffer.from("{}"), signature, appSecret }), false);
  assert.equal(verifyMetaWebhookSignature({ rawBody, signature, appSecret: "other-secret" }), false);
});
