import test from "node:test";
import assert from "node:assert/strict";
import { redactMetadataForRole } from "../src/lib/metadata-access.js";

test("hides fields restricted to other roles", () => {
  const result = redactMetadataForRole({ address: "A", price: 100 }, { fields: { price: { accessRoles: ["OWNER", "ADMIN"] } } }, "AGENT");
  assert.deepEqual(result.data, { address: "A" });
  assert.deepEqual(result.hiddenFields, ["price"]);
});
