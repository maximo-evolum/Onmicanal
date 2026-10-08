import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db.js";
import { env } from "../src/lib/env.js";
import { encryptSecret } from "../src/lib/credential-crypto.js";
import { getNuboxSale, downloadNuboxSaleFile } from "../src/services/finance-sync.service.js";

test("servicio Nubox: empresa obligatoria antes de consultar credenciales", async () => {
  await assert.rejects(getNuboxSale({ documentId: "1" }), e => e.status === 401);
});

test("servicio Nubox: contrato de descargas, cifrado y alcance de credenciales por empresa", async t => {
  const previous = { find: prisma.tenantChannelConfig.findFirst, fetch: globalThis.fetch, base: env.nuboxApiBaseUrl };
  t.after(() => { prisma.tenantChannelConfig.findFirst = previous.find; globalThis.fetch = previous.fetch; env.nuboxApiBaseUrl = previous.base; });
  env.nuboxApiBaseUrl = "https://api.test-nubox.com/nbxpymapi-uat";
  const seen = [];
  prisma.tenantChannelConfig.findFirst = async ({ where }) => {
    assert.equal(where.channel, "finance_nubox"); assert.equal(where.isActive, true);
    return where.tenantId === "demo-a" ? { accessToken: encryptSecret("FAKE_KEY_A"), verifyToken: encryptSecret("FAKE_TOKEN_A") } : null;
  };
  globalThis.fetch = async (url, options) => {
    seen.push(url); assert.equal(options.headers["X-Api-Key"], "FAKE_KEY_A"); assert.equal(options.headers.Authorization, "Bearer FAKE_TOKEN_A");
    if (url.includes("/pdf")) {
      assert.ok(url.endsWith("/v1/sales/document_1/pdf?template=TEMPLATE_A4")); assert.equal(options.headers.Accept, "application/pdf");
      return new Response("%PDF-1.7 demo");
    }
    assert.ok(url.endsWith("/v1/sales/document_1/xml")); assert.equal(options.headers.Accept, "application/xml");
    return new Response('<DTE version="1.0"></DTE>');
  };
  for (const format of ["pdf", "xml"]) await downloadNuboxSaleFile({ tenantId: "demo-a", documentId: "document_1", format });
  await assert.rejects(downloadNuboxSaleFile({ tenantId: "demo-b", documentId: "document_1", format: "pdf" }), /no está configurado/);
  assert.equal(seen.length, 2);
});
