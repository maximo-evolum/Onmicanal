/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de broker financial operations.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { applyBrokerFinancialAction, buildBrokerFinancialOperations, validateBrokerFinancialAction } from "../src/services/broker-financial-operations.service.js";
import { canBrokerAction, normalizeBrokerAccessProfile } from "../src/services/broker-access.service.js";

const record = (id, recordType, status, data, title = recordType) => ({ id, recordType, status, data, title, updatedAt: "2026-08-01T12:00:00.000Z" });

test("La cola financiera deriva comisiones, arriendos y liquidaciones sin duplicar los antecedentes", () => {
  const output = buildBrokerFinancialOperations({
    period: "2026-08",
    now: new Date("2026-08-30T12:00:00.000Z"),
    properties: [{ id: "p-1", title: "Departamento Providencia" }],
    records: [
      record("commission-1", "commission_settlement", "PENDING", { propertyId: "p-1", brokerName: "Ana Corredora", amount: 200000, brokerAmount: 100000, companyAmount: 100000, settlementDate: "2026-08-10", operationType: "SALE" }, "Comisión venta Providencia"),
      record("rental-1", "rental_payment", "PENDING", { propertyId: "p-1", tenantName: "Carlos Pérez", amount: 850000, dueDate: "2026-08-05", period: "2026-08" }, "Arriendo agosto"),
      record("liquidation-1", "administration_liquidation", "ISSUED", { propertyId: "p-1", ownerName: "María Soto", ownerTransferAmount: 700000, managementFee: 85000, transferDate: "2026-08-12", period: "2026-08" }, "Liquidación agosto"),
      record("maintenance-1", "maintenance_ticket", "COMPLETED", { propertyId: "p-1", amount: 50000, period: "2026-08" })
    ]
  });

  assert.equal(output.queue.length, 3);
  assert.equal(output.queue[0].id, "rental-1");
  assert.equal(output.queue[0].state, "OVERDUE");
  assert.equal(output.summary.pendingAmount, 1_750_000);
  assert.equal(output.reports.sales.total, 200000);
  assert.equal(output.reports.administration.total, 1_550_000);
  assert.equal(output.reports.margin.grossRevenue, 185000);
  assert.equal(output.reports.margin.costs, 50000);
  assert.equal(output.reports.margin.amount, 135000);
  assert.equal(output.reports.brokerSettlements[0].broker, "Ana Corredora");
  assert.equal(output.tenantSimulation.length, 1);
  assert.equal(output.tenantSimulation[0].state, "OVERDUE");
  assert.match(output.queue[0].sourceHref, /tab=rentals/);
});

test("Informar un pago conserva el estado de origen y exige revisión humana", () => {
  const source = record("rental-1", "rental_payment", "PENDING", { propertyId: "p-1", tenantName: "Carlos Pérez", amount: 850000, dueDate: "2026-08-05", period: "2026-08" });
  const result = applyBrokerFinancialAction({ record: source, action: "REPORT_PAYMENT", input: { amount: 400000, note: "Comprobante recibido por correo." }, actor: "María Administración", now: new Date("2026-08-20T12:00:00.000Z") });

  assert.equal(result.ok, true);
  assert.equal(source.status, "PENDING");
  assert.equal(result.data.paymentReport.status, "PENDING_REVIEW");
  assert.equal(result.data.paymentReport.amount, 400000);
  assert.equal(result.data.automaticPayment, false);
  const derived = buildBrokerFinancialOperations({ records: [{ ...source, data: result.data }], now: new Date("2026-08-20T12:00:00.000Z") });
  assert.equal(derived.queue[0].state, "PAYMENT_REPORTED");
  assert.equal(derived.queue[0].outstanding, 450000);
  assert.equal(derived.queue[0].reportedAmount, 400000);
});

test("Las acciones internas no se permiten sobre antecedentes ya cerrados", () => {
  const source = record("commission-1", "commission_settlement", "PAID", { amount: 200000, settlementDate: "2026-08-01" });
  const validation = validateBrokerFinancialAction({ record: source, action: "PREPARE_REMINDER" });
  assert.equal(validation.ok, false);
  assert.match(validation.error, /cerrado/i);
});

test("Un corredor puede consultar sus comisiones, pero no editarlas", () => {
  const access = { ...normalizeBrokerAccessProfile({ businessRole: "CORREDOR", accessScope: "ASSIGNED" }, { role: "SELLER" }), technicalRole: "SELLER" };
  assert.equal(canBrokerAction(access, "commissions", "VIEW"), true);
  assert.equal(canBrokerAction(access, "commissions", "EDIT"), false);
});
