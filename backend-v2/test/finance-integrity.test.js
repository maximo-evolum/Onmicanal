import test from "node:test";
import assert from "node:assert/strict";
import { FinanceOperationError, withFinanceWrite, findAllFinanceRecords } from "../src/services/finance-integrity.service.js";

test("las consultas de integridad incluyen los registros posteriores a la primera página", async () => {
  const data = Array.from({ length: 1248 }, (_, id) => ({ id: String(id) }));
  let calls = 0;
  const db = { industryRecord: { findMany: async (query) => {
    calls += 1;
    const offset = query.cursor ? Number(query.cursor.id) + query.skip : 0;
    assert.deepEqual(query.where, { tenantId: "tenant-a" });
    return data.slice(offset, offset + query.take);
  } } };
  const result = await findAllFinanceRecords(db, { where: { tenantId: "tenant-a" }, take: 10 });
  assert.equal(result.length, 1248);
  assert.equal(result.at(-1).id, "1247");
  assert.equal(calls, 3);
});

test("una escritura financiera vuelve a leer el estado cuando Prisma detecta conflicto concurrente", async () => {
  let calls = 0;
  let executions = 0;
  const db = { $transaction: async (operation, options) => {
    calls += 1;
    assert.equal(options.isolationLevel, "Serializable");
    const result = await operation({ attempt: calls });
    if (calls === 1) throw Object.assign(new Error("conflict"), { code: "P2034" });
    return result;
  } };
  const result = await withFinanceWrite(db, async (tx) => { executions += 1; return tx.attempt; });
  assert.equal(result, 2);
  assert.equal(executions, 2);
});

test("un fallo de negocio no se reintenta ni se transforma en éxito", async () => {
  let calls = 0;
  const db = { $transaction: async (operation) => { calls += 1; return operation({}); } };
  await assert.rejects(withFinanceWrite(db, async () => { throw new FinanceOperationError(409, "Ya conciliado"); }),
    (error) => error.status === 409 && error.message === "Ya conciliado");
  assert.equal(calls, 1);
});

test("los conflictos persistentes finalizan con respuesta controlada tras tres intentos", async () => {
  let calls = 0;
  const db = { $transaction: async () => { calls += 1; throw Object.assign(new Error("conflict"), { code: "P2034" }); } };
  await assert.rejects(withFinanceWrite(db, async () => {}), (error) => error.status === 409);
  assert.equal(calls, 3);
});
