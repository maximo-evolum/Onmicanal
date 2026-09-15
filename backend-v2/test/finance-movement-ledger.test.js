import test from "node:test";
import assert from "node:assert/strict";
import { movementLedger, movementLedgerCsv, readMovementLedger } from "../src/services/finance-movement-ledger.service.js";
import { financeAccountKey } from "../src/services/finance-context.service.js";
const movement = (id, fields = {}, status = "PENDING") => ({ id: String(id), recordType: "bank_movement", status, data: { transactionDate: "2025-01-15", amount: 100, direction: "CREDIT", description: "Abono cliente", ...fields } });
test("totales y exportación incluyen las 1248 filas, no solo la página", () => {
  const records = Array.from({ length: 1248 }, (_, id) => movement(id));
  const result = movementLedger(records, { page: "50", period: "2025-01" });
  assert.equal(result.total, 1248); assert.equal(result.records.length, 23); assert.equal(result.summary.credits, 124800);
  assert.equal(movementLedgerCsv(movementLedger(records, {}, { all: true })).split("\r\n").length, 1249);
});
test("consulta base conserva alcance de empresa en todas las páginas", async () => {
  const records = Array.from({ length: 1001 }, (_, id) => movement(id));
  const db = { industryRecord: { findMany: async (query) => { assert.equal(query.where.tenantId, "a"); const offset = query.cursor ? Number(query.cursor.id) + 1 : 0; return records.slice(offset, offset + query.take); } } };
  assert.equal((await readMovementLedger(db, "a", {})).total, 1001);
});
test("filtra período, moneda y cuenta por origen de lote, incluido legado", () => {
  const account = { bankKey: "santander", accountAlias: "Principal", accountLast4: "1234" };
  const batch = { id: "batch", recordType: "bank_statement", data: { account, sourceFile: "Cartola enero" } };
  const records = [batch, movement(1, { sourceBatchId: "batch" }), movement(2, { transactionDate: "2026-01-15", importBatchId: "batch" }), movement(3, { currency: "USD", importBatchId: "batch" }), movement(4)];
  const result = movementLedger(records, { period: "2025-01", accountKey: financeAccountKey(account) });
  assert.equal(result.total, 1); assert.equal(result.records[0].sourceFile, "Cartola enero");
});
test("abono explícito y cargo negativo; positivo sin marca queda sin clasificar", () => {
  const result = movementLedger([movement(1), movement(2, { amount: -40, direction: "" }), movement(3, { amount: 200, direction: "" }), movement(4, { amount: "bad" })]);
  assert.deepEqual(result.summary, { credits: 100, debits: 40, unclassified: 2 });
});
test("búsqueda por RUT referencia y nombre no depende de acentos", () => {
  const records = [movement(1, { payerName: "José Pérez", rut: "1234-5", reference: "F-ABC" })];
  for (const search of ["jose", "1234-5", "f-abc"]) assert.equal(movementLedger(records, { search }).total, 1);
});
test("combina fechas monto tipo estado y orden", () => {
  const records = [movement(1, { amount: 50 }, "MATCHED"), movement(2, { amount: 150 }), movement(3, { amount: 250 }), movement(4, { amount: 400, direction: "DEBIT" })];
  const result = movementLedger(records, { from: "2025-01-01", to: "2025-01-31", min: "100", max: "300", direction: "CREDIT", status: "PENDING", sort: "amount_desc" });
  assert.deepEqual(result.records.map((r) => r.id), ["3", "2"]); assert.equal(result.summary.credits, 400);
});
test("rechaza filtros inválidos y fechas imposibles", () => {
  for (const query of [{ from: "2025-02-30" }, { from: "2025-02-02", to: "2025-01-01" }, { min: "abc" }, { min: "-1" }, { max: "Infinity" }, { direction: "hack" }, { status: "hack" }, { sort: "hack" }]) assert.throws(() => movementLedger([], query));
});
test("detalle expone solo campos previstos y fila numérica, no objetos internos", () => {
  const result = movementLedger([movement(1, { secret: "private", sourceRow: { raw: "private" }, importRow: 27, bankKey: "bank", accountLast4: "123456789" })]);
  assert.equal(result.records[0].sourceRow, "27"); assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(result.records[0].last4, "6789");
});
test("CSV neutraliza fórmulas y conserva comillas y punto y coma", () => {
  const csv = movementLedgerCsv(movementLedger([movement(1, { description: '=HYPERLINK("x");', reference: '+cmd' })], {}, { all: true }));
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'+cmd")); assert.ok(csv.includes('""x""'));
});
test("paginación tiene orden estable y no duplica filas", () => {
  const rows = Array.from({ length: 31 }, (_, id) => movement(id));
  const ids = [1, 2, 3, 4].flatMap((page) => movementLedger(rows, { page, pageSize: 10 }).records.map((r) => r.id));
  assert.equal(new Set(ids).size, 31); assert.equal(ids.length, 31);
});

test("sin fecha incluye ausentes e imposibles, nunca usa fecha de carga", () => {
  const rows = [movement(1), { ...movement(2, { transactionDate: "" }), createdAt: "2025-01-15" }, movement(3, { transactionDate: "2025-02-30" }), movement(4, { transactionDate: "2024-02-29" })];
  const result = movementLedger(rows, { period: "2025-01", dateScope: "UNDATED" });
  assert.deepEqual(result.records.map((r) => r.id), ["2", "3"]);
  assert.ok(result.records.every((r) => r.date === ""));
  assert.equal(result.undatedAvailable, 2);
  assert.equal(result.summary.credits, 200);
  assert.match(result.scopeNotice, /No se atribuyen al mes activo/);
  const normal = movementLedger(rows, { period: "2025-01" });
  assert.equal(normal.total, 1); assert.equal(normal.undatedAvailable, 2);
});

test("sin fecha conserva cuenta y moneda incluso si se resuelven desde lote legado", () => {
  const account = { bankKey: "santander", accountAlias: "Principal", accountLast4: "1234" };
  const records = [{ id: "batch", recordType: "bank_statement", data: { account } }, movement(1, { transactionDate: "", sourceBatchId: "batch" }), movement(2, { transactionDate: "", currency: "USD", sourceBatchId: "batch" }), movement(3, { transactionDate: "" })];
  const result = movementLedger(records, { accountKey: financeAccountKey(account), period: "2025-01", dateScope: "UNDATED" });
  assert.equal(result.total, 1); assert.equal(result.undatedAvailable, 1); assert.equal(result.records[0].id, "1");
});

test("sin fecha combina filtros no temporales y exporta todas las páginas con advertencia", () => {
  const rows = Array.from({ length: 31 }, (_, id) => movement(id, { transactionDate: "", description: "Revisar origen" }));
  const query = { dateScope: "UNDATED", search: "origen", min: "50", max: "150", direction: "CREDIT", status: "PENDING", pageSize: "10" };
  assert.equal(movementLedger(rows, query).records.length, 10);
  const all = movementLedger(rows, query, { all: true });
  assert.equal(all.records.length, 31);
  assert.equal(movementLedgerCsv(all).split("\r\n").length, 32);
  assert.match(movementLedgerCsv(all), /No se atribuyen al mes activo/);
});

test("rechaza filtros temporales incompatibles sin ignorarlos silenciosamente", () => {
  for (const query of [{ dateScope: "invalid" }, { dateScope: "UNDATED", from: "2025-01-01" }, { dateScope: "UNDATED", to: "2025-01-31" }]) assert.throws(() => movementLedger([], query), { status: 400 });
});

const rec = (id, movementId, confidence, status = "APPROVED") => ({ id, recordType: "finance_reconciliation", status, data: { movementId, confidence } });
test("filtra responsable asignado o ausente sobre todo el listado", () => {
  const rows = [{ ...movement(1), assignedToId: "agent" }, { ...movement(2), assignedToId: "other" }, movement(3)];
  assert.equal(movementLedger(rows, { owner: "NONE" }).total, 1);
  assert.equal(movementLedger(rows, { owner: "ASSIGNED" }).total, 2);
  const result = movementLedger(rows, { owner: "agent" });
  assert.equal(result.summary.credits, 100); assert.equal(result.records[0].id, "1");
  assert.match(movementLedgerCsv(result), /agent/);
});
test("puntaje usa solo conciliación vigente con vínculo bidireccional", () => {
  const rows = [movement(1, { reconciliationId: "r1" }, "MATCHED"), rec("r1", "1", 95), movement(2, { reconciliationId: "r2" }), rec("r2", "2", 99), movement(3, { reconciliationId: "r3" }, "MATCHED"), rec("r3", "3", 99, "REVERSED"), movement(4, { reconciliationId: "r4" }, "MATCHED"), rec("r4", "other", 99)];
  const result = movementLedger(rows, { confidence: "HIGH" }, { reconciliationAccess: true });
  assert.deepEqual(result.records.map((r) => r.id), ["1"]);
  assert.equal(result.records[0].confidenceLabel, "95 / 100");
  assert.equal(movementLedger(rows, { confidence: "UNKNOWN" }, { reconciliationAccess: true }).total, 3);
});
test("intervalos de puntaje distinguen cero, ausencia y valores inválidos", () => {
  const scores = [0, 79.9, 80, 94.9, 95, 100, null, "99", -1, 101];
  const rows = scores.flatMap((score, i) => [movement(i, { reconciliationId: `r${i}` }, "MATCHED"), rec(`r${i}`, String(i), score)]);
  for (const [confidence, total] of [["LOW", 2], ["MEDIUM", 2], ["HIGH", 2], ["UNKNOWN", 4]]) assert.equal(movementLedger(rows, { confidence }, { reconciliationAccess: true }).total, total);
});
test("sin permiso no carga conciliaciones ni revela puntaje", async () => {
  const result = movementLedger([movement(1, { reconciliationId: "r1" }, "MATCHED"), rec("r1", "1", 99)]);
  assert.equal(result.records[0].confidenceScore, null);
  assert.equal(result.records[0].confidenceLabel, "Acceso restringido");
  assert.throws(() => movementLedger([], { confidence: "UNKNOWN" }), { status: 403 });
  const db = { industryRecord: { findMany: async (q) => { assert.equal(q.where.tenantId, "company"); assert.ok(!q.where.recordType.in.includes("finance_reconciliation")); return []; } } };
  await readMovementLedger(db, "company", {});
});
test("revisión importada viene del lote, conserva cero y legado no inventa uno", () => {
  const rows = [{ id: "b", recordType: "bank_statement", data: { importRevision: 0 } }, movement(1, { sourceBatchId: "b" }), movement(2), { id: "bad", recordType: "bank_statement", data: { importRevision: "1" } }, movement(3, { importBatchId: "bad" })];
  assert.equal(movementLedger(rows, { importRevision: "0" }).total, 1);
  assert.equal(movementLedger(rows, { importRevision: "UNKNOWN" }).total, 2);
  for (const importRevision of ["-1", "1.5", "abc", "9007199254740992"]) assert.throws(() => movementLedger(rows, { importRevision }), { status: 400 });
});
test("filtros especializados afectan totales y exportación, no solo página", () => {
  const rows = Array.from({ length: 31 }, (_, i) => [movement(i, { reconciliationId: `r${i}` }, "MATCHED"), rec(`r${i}`, String(i), 99)]).flat();
  const result = movementLedger(rows, { confidence: "HIGH", pageSize: 10 }, { reconciliationAccess: true, all: true });
  assert.equal(result.records.length, 31); assert.equal(result.summary.credits, 3100);
  assert.match(movementLedgerCsv(result), /99 \/ 100/);
  assert.throws(() => movementLedger(rows, { confidence: "invalid" }, { reconciliationAccess: true }), { status: 400 });
});
