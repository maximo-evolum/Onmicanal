import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAdministrativeException, updateCollectionCase, updateFinanceExceptionCase, prepareCollectionReminders, financeActivityDate } from "../src/services/finance-case-actions.service.js";
import { financeActionForRecordMutation, FINANCE_ACTIONS } from "../src/services/finance-security.service.js";
function database() {
  let rows = [], controls = [], audits = [], seq = 0, tail = Promise.resolve();
  const match = (r, w = {}) => Object.entries(w).every(([k, v]) => v?.in ? v.in.includes(r[k]) : v?.path ? v.path.reduce((x, p) => x?.[p], r[k]) === v.equals : r[k] === v);
  const db = {
    get rows() { return rows; }, get controls() { return controls; }, get audits() { return audits; },
    $transaction: (fn, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const p = tail.then(async () => { const before = structuredClone({ rows, controls, audits }); try { return await fn(db); } catch (e) { ({ rows, controls, audits } = before); throw e; } });
      tail = p.catch(() => {}); return p;
    },
    financePeriodControl: { upsert: async ({ where, create }) => { let r = controls.find((x) => match(x, where.tenantId_period)); if (!r) { r = structuredClone(create); controls.push(r); } return structuredClone(r); } },
    industryRecord: {
      findFirst: async ({ where }) => structuredClone(rows.find((r) => match(r, where)) || null),
      findMany: async ({ where, cursor, skip = 0, take = 500 }) => { const list = rows.filter((r) => match(r, where)); const start = cursor ? list.findIndex((r) => r.id === cursor.id) + skip : 0; return structuredClone(list.slice(start, start + take)); },
      create: async ({ data }) => { const r = { id: `r-${++seq}`, createdAt: new Date("2026-09-11T12:00:00Z"), ...structuredClone(data) }; rows.push(r); return structuredClone(r); },
      update: async ({ where, data }) => { const r = rows.find((x) => match(x, where)); assert.ok(r); Object.assign(r, structuredClone(data)); return structuredClone(r); }
    },
    tenant: { findUnique: async () => ({ aiSettings: { financeAgents: { autoCreateExceptions: db.enabled !== false } } }) },
    tenantAuditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  }; return db;
}
const close = (db, period, tenantId = "a") => { const c = db.controls.find((r) => r.tenantId === tenantId && r.period === period); if (c) c.status = "CLOSED"; else db.controls.push({ tenantId, period, status: "CLOSED" }); };
const now = new Date("2026-09-11T12:00:00Z");
const inv = (id = "i1", data = {}, tenantId = "a") => ({ id, tenantId, recordType: "finance_invoice", status: "OPEN", title: "Factura Andes", data: { amount: 100, balance: 100, issueDate: "2026-01-01", dueDate: "2026-01-20", customerName: "Andes", customerRut: "11111111-1", currency: "CLP", ...data } });
const cas = (status = "PENDING", data = {}, tenantId = "a") => ({ id: "c1", tenantId, recordType: "finance_collection_case", title: "Cobranza Andes", status, createdAt: new Date("2026-09-01T12:00:00Z"), data: { invoiceId: "i1", workflowVersion: 0, operatingDate: "2026-09-01", ...data } });
const exc = (status = "OPEN", data = {}, tenantId = "a") => ({ id: "e1", tenantId, recordType: "finance_exception", title: "Ingreso por revisar", status, createdAt: new Date("2026-09-01T12:00:00Z"), data: { transactionDate: "2026-09-01", workflowVersion: 0, ...data } });
const note = "Revisión respaldada por el comprobante del cliente.";
const update = (db, input = {}, extra = {}) => updateCollectionCase(db, { tenantId: "a", userId: "operator", id: "c1", now, input: { expectedVersion: 0, status: "CONTACTED", note, ...input }, ...extra });
const resolve = (db, input = {}, extra = {}) => updateFinanceExceptionCase(db, { tenantId: "a", userId: "operator", id: "e1", now, input: { expectedVersion: 0, status: "RESOLVED", resolution: note, ...input }, ...extra });
const remind = (db, extra = {}) => prepareCollectionReminders(db, { tenantId: "a", userId: "operator", partyKey: "111111111", now, ...extra });
const create = (db, input = {}, extra = {}) => createAdministrativeException(db, { tenantId: "a", userId: "operator", now, input: { title: "Revisar respaldo", detail: note, idempotencyKey: "request-1234567890", ...input }, ...extra });
const rejects = (promise, status) => assert.rejects(promise, (e) => e.status === status);
test("fecha operativa usa el calendario chileno", () => assert.equal(financeActivityDate(new Date("2026-09-11T01:00:00Z")), "2026-09-10"));
test("edición conserva historial completo y factura intacta", async () => {
 const db = database(); db.rows.push(inv(), cas("PENDING", { history: Array.from({length: 120}, () => ({type: "OLD"})) }));
 const before = structuredClone(db.rows[0]); const r = await update(db);
 assert.equal(r.case.status, "CONTACTED"); assert.equal(r.case.data.workflowVersion, 1); assert.equal(r.case.data.history.length, 121);
 assert.deepEqual(db.rows[0], before); assert.equal(db.audits.length, 1);
});
test("exige versión y rechaza edición obsoleta", async () => {
 const db = database(); db.rows.push(inv(), cas()); await rejects(update(db, {expectedVersion: undefined}), 428);
 await update(db); await rejects(update(db), 409); assert.equal(db.audits.length, 1);
});
test("solicitudes simultáneas no sobrescriben la misma versión", async () => {
 const db = database(); db.rows.push(inv(), cas()); const r = await Promise.allSettled([update(db), update(db)]);
 assert.equal(r.filter(x => x.status === "fulfilled").length, 1); assert.equal(db.audits.length, 1);
});
test("no marca pagada una factura con saldo", async () => {
 const db = database(); db.rows.push(inv(), cas()); await rejects(update(db, {status:"PAID"}), 409); assert.equal(db.audits.length, 0);
});
test("permite cerrar como pagada con saldo cero sin registrar otro pago", async () => {
 const db = database(); db.rows.push(inv("i1", {balance:0}), cas()); assert.equal((await update(db, {status:"PAID"})).case.status,"PAID"); assert.equal(db.rows.length,2);
});
test("reapertura requiere administrador y saldo positivo", async () => {
 const db = database(); db.rows.push(inv(), cas("CLOSED")); await rejects(update(db,{status:"PENDING"}),403);
 assert.equal((await update(db,{status:"PENDING"},{canReopen:true})).case.data.history[0].type,"CASE_REOPENED");
});
test("administrador no reabre caso pagado con saldo cero", async () => {
 const db = database(); db.rows.push(inv("i1",{balance:0}),cas("PAID")); await rejects(update(db,{status:"PENDING"},{canReopen:true}),409);
});
test("promesa exige fecha vigente y monto dentro del saldo", async () => {
 const db = database(); db.rows.push(inv(),cas());
 for (const input of [{promiseDueDate:"2026-09-10",promiseAmount:50},{promiseDueDate:"2026-09-12",promiseAmount:101},{promiseDueDate:"2026-09-12",promiseAmount:1.5}]) await rejects(update(db,{status:"PROMISE",...input}),422);
 const r=await update(db,{status:"PROMISE",promiseDueDate:"2026-09-12",promiseAmount:50}); assert.equal(r.case.data.promiseAmount,50);
});
test("rechaza motivo corto, estado desconocido y canal inválido", async () => {
 const db=database();db.rows.push(inv(),cas());
 for (const input of [{note:"ok"},{status:"UNKNOWN"},{channel:"portal-externo"}]) await rejects(update(db,input),422);
});
test("origen ausente no toma por accidente la primera factura",async()=>{
 const db=database();db.rows.push(inv(),cas("PENDING",{invoiceId:undefined}));await rejects(update(db),422);assert.equal(db.audits.length,0);
});
test("factura de otra empresa no se puede editar mediante caso",async()=>{
 const db=database();db.rows.push(inv("i1",{},"b"),cas());await rejects(update(db),404);
});
test("períodos anterior y actual cerrados bloquean edición",async()=>{
 for(const period of ["2026-08","2026-09"]){const db=database();db.rows.push(inv(),cas("PENDING",{operatingDate:"2026-08-10"}));close(db,period);await rejects(update(db),409);assert.equal(db.audits.length,0);}
});
test("caso de factura proveedor solo puede archivarse",async()=>{
 const db=database();db.rows.push(inv("i1",{documentSide:"SUPPLIER"}),cas());await rejects(update(db),409);assert.equal((await update(db,{status:"CLOSED"})).case.status,"CLOSED");
});
test("excepción exige resolución y registra auditoría",async()=>{
 const db=database();db.rows.push(exc());await rejects(resolve(db,{resolution:"ok"}),422);const r=await resolve(db);assert.equal(r.exception.status,"RESOLVED");assert.equal(r.exception.data.resolvedById,"operator");assert.equal(db.audits.length,1);
});
test("no se cierra una excepción sin resolverla primero",async()=>{
 const db=database();db.rows.push(exc());await rejects(resolve(db,{status:"CLOSED"}),409);
});
test("resolver y cerrar no se registra como reapertura",async()=>{
 const db=database();db.rows.push(exc("RESOLVED"));const r=await resolve(db,{status:"CLOSED"});assert.equal(r.exception.data.history[0].type,"EXCEPTION_UPDATED");
});
test("excepción resuelta solo la reabre administrador a abierta",async()=>{
 const db=database();db.rows.push(exc("RESOLVED"));await rejects(resolve(db,{status:"OPEN"}),403);const r=await resolve(db,{status:"OPEN"},{canReopen:true});assert.equal(r.exception.data.resolvedAt,null);assert.equal(r.exception.data.history[0].type,"EXCEPTION_REOPENED");
});
test("excepción bloqueada por fecha real del movimiento",async()=>{
 const db=database();db.rows.push(exc("OPEN",{movementId:"m1"}),{id:"m1",tenantId:"a",recordType:"bank_movement",data:{transactionDate:"2026-01-01"}});close(db,"2026-01");await rejects(resolve(db),409);
});
test("excepción no usa movimiento de otra empresa",async()=>{
 const db=database();db.rows.push(exc("OPEN",{movementId:"m1"}),{id:"m1",tenantId:"b",recordType:"bank_movement",data:{transactionDate:"2026-09-01"}});await rejects(resolve(db),404);
});
test("excepción importada sin fecha requiere corregir origen",async()=>{
 const db=database();db.rows.push(exc("OPEN",{transactionDate:null,importBatchId:"batch"}));await rejects(resolve(db),422);
});
test("excepción administrativa antigua usa fecha de creación comprobable",async()=>{
 const db=database();db.rows.push(exc("OPEN",{transactionDate:null}));assert.equal((await resolve(db)).exception.status,"RESOLVED");
});
test("recordatorio es interno y diario idempotente",async()=>{
 const db=database();db.rows.push(inv());const before=structuredClone(db.rows[0]);
 const first=await remind(db),second=await remind(db);assert.equal(first.count,1);assert.equal(second.replayed,true);assert.equal(second.count,0);
 assert.equal(first.prepared[0].data.requiresApproval,true);assert.equal(first.prepared[0].data.reminderStatus,"Borrador pendiente de aprobación");assert.deepEqual(db.rows[0],before);assert.equal(db.audits.length,1);
});
test("recordatorio conserva contacto y aumenta versión del caso",async()=>{
 const db=database();db.rows.push(inv(),cas("CONTACTED",{workflowVersion:4}));const r=await remind(db);assert.equal(r.prepared[0].status,"CONTACTED");assert.equal(r.prepared[0].data.workflowVersion,5);
});
test("nuevo saldo produce nuevo borrador, no otro caso",async()=>{
 const db=database();db.rows.push(inv());await remind(db);db.rows[0].data.balance=50;assert.equal((await remind(db)).count,1);assert.equal(db.rows.filter(r=>r.recordType==="finance_collection_case").length,1);
});
test("no reactiva casos cerrados por preparar recordatorio",async()=>{
 const db=database();db.rows.push(inv(),cas("CLOSED"));const r=await remind(db);assert.equal(r.count,0);assert.equal(r.deferred[0].reason,"CASE_REQUIRES_REOPENING");assert.equal(db.audits.length,0);
});
test("casos duplicados heredados requieren revisión",async()=>{
 const db=database();db.rows.push(inv(),cas(),{...cas(),id:"c2"});await rejects(remind(db),409);assert.equal(db.audits.length,0);
});
test("recordatorios validan moneda, fechas y saldo",async()=>{
 const db=database();db.rows.push(inv("1",{currency:"USD"}),inv("2",{dueDate:"sin-fecha"}),inv("3",{balance:200}),inv("4",{balance:50.5}));
 const r=await remind(db);assert.equal(r.count,0);assert.equal(r.deferred.length,4);
});
test("recordatorios leen más de mil documentos",async()=>{
 const db=database();for(let i=0;i<1001;i++)db.rows.push(inv("i"+i));const r=await remind(db);assert.equal(r.count,1001);assert.equal(r.prepared[1000].data.invoiceId,"i1000");
});
test("recordatorios concurrentes solo generan un lote",async()=>{
 const db=database();db.rows.push(inv());const r=await Promise.all([remind(db),remind(db)]);assert.equal(r.reduce((s,x)=>s+x.count,0),1);assert.equal(db.audits.length,1);
});
test("recordatorios respetan período cerrado sin cambios parciales",async()=>{
 const db=database();db.rows.push(inv());close(db,"2026-09");await rejects(remind(db),409);assert.equal(db.rows.length,1);
});
test("recordatorios nunca incluyen otras empresas",async()=>{
 const db=database();db.rows.push(inv("a1"),inv("b1",{},"b"));const r=await remind(db);assert.equal(r.count,1);assert.equal(r.prepared[0].data.invoiceId,"a1");
});
test("creación administrativa idempotente y con payload protegido",async()=>{
 const db=database();const a=await create(db),b=await create(db);assert.equal(a.exception.id,b.exception.id);assert.equal(b.replayed,true);await rejects(create(db,{title:"Otro título"}),409);assert.equal(db.audits.length,1);
});
test("creación administrativa exige fecha operativa abierta",async()=>{
 const db=database();close(db,"2026-09");await rejects(create(db),409);assert.equal(db.rows.length,0);
});
test("auditoría y registros revierten juntos ante error",async()=>{
 for(const operation of ["case","exception","reminder","create"]){
 const db=database();db.rows.push(inv(),cas(),exc());const before=structuredClone(db.rows);
 db.tenantAuditLog.create=async()=>{throw new Error("Audit unavailable");};
 await assert.rejects(operation==="case"?update(db):operation==="exception"?resolve(db):operation==="reminder"?remind(db):create(db),/Audit unavailable/);
 assert.deepEqual(db.rows,before);
 }
});
test("todas las acciones exigen contexto de empresa",async()=>{
 const db=database();for(const action of [update,resolve,remind,create]) await rejects(action===remind?action(db,{tenantId:""}):action(db,{}, {tenantId:""}),400);
});
test("lotes no se pueden mutar por API genérica y requieren módulo cobranza",()=>{
 const source=readFileSync(new URL("../src/routes/industry-records.routes.js",import.meta.url),"utf8");
 assert.match(source,/finance_reminder_batch: MODULES.FINANCE_COLLECTIONS/);assert.match(source,/\["finance_exception", "finance_collection_case", "finance_reminder_batch"\]\.includes\(recordType\)/);
 assert.equal(financeActionForRecordMutation("finance_reminder_batch"),FINANCE_ACTIONS.PREPARE);
});
test("saldo corrupto no se normaliza a cero para declarar pagado",async()=>{
 const db=database();db.rows.push(inv("i1",{balance:"ilegible"}),cas());await rejects(update(db,{status:"PAID"}),409);const r=await remind(db);assert.equal(r.count,0);assert.equal(r.deferred[0].reason,"INVALID_BALANCE_OR_CURRENCY");
});
test("proveedor heredado no crea una cobranza a cliente",async()=>{
 const db=database();db.rows.push(inv("i1",{customerName:undefined,supplierName:"Proveedor Andes"}));await rejects(remind(db),404);
});
test("documentos anulados y de demostración no generan recordatorios",async()=>{
 const db=database();db.rows.push({...inv(),status:"ANNULLED"},inv("i2",{isDemo:true}));await rejects(remind(db),404);
});
test("un nuevo lote al día siguiente conserva el mismo caso",async()=>{
 const db=database();db.rows.push(inv());await remind(db);const r=await remind(db,{now:new Date("2026-09-12T12:00:00Z")});assert.equal(r.count,1);assert.equal(db.rows.filter(x=>x.recordType==="finance_collection_case").length,1);
});
