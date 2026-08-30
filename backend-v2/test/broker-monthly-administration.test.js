import test from "node:test";
import assert from "node:assert/strict";
import {
  administrationActionForLiquidationStage,
  buildMonthlyAdministration,
  normalizeAdministrationPeriod,
  validateAdministrationLiquidationTransition,
} from "../src/services/broker-monthly-administration.service.js";

const record = (recordType, status, data, id = `${recordType}-${status}`) => ({ id, title: recordType, recordType, status, data });

test("La administración mensual consolida contrato, cobro y gasto del período", () => {
  const monthly = buildMonthlyAdministration({
    period: "2026-08",
    properties: [{ id: "property-1", title: "Departamento Providencia" }],
    profiles: [record("administration_profile", "ACTIVE", { propertyId: "property-1", ownerName: "María Soto", tenantName: "Carlos Pérez", managementRatePct: 8, ownerPaymentDay: 10 })],
    contracts: [record("rental_contract", "ACTIVE", { propertyId: "property-1", monthlyRent: 900000, tenantName: "Carlos Pérez" })],
    payments: [record("rental_payment", "PAID", { propertyId: "property-1", period: "2026-08", amount: 900000 })],
    utilities: [record("utility_monitoring", "PENDING", { propertyId: "property-1", period: "2026-08", amount: 80000 })],
    maintenance: [record("maintenance_ticket", "COMPLETED", { propertyId: "property-1", period: "2026-08", amount: 30000 })],
  });
  assert.equal(monthly.rows.length, 1);
  assert.equal(monthly.rows[0].readyToPrepare, true);
  assert.equal(monthly.rows[0].paidAmount, 900000);
  assert.equal(monthly.rows[0].commonExpenses, 80000);
  assert.equal(monthly.rows[0].maintenanceCost, 30000);
  assert.equal(monthly.rows[0].preview.ownerTransferAmount, 718000);
});

test("La liquidación mensual no permite saltar la revisión humana", () => {
  assert.equal(validateAdministrationLiquidationTransition({ currentStatus: "DRAFT", nextStatus: "ISSUED" }).ok, false);
  assert.equal(validateAdministrationLiquidationTransition({ currentStatus: "DRAFT", nextStatus: "PENDING_APPROVAL" }).ok, true);
  assert.equal(validateAdministrationLiquidationTransition({ currentStatus: "PENDING_APPROVAL", nextStatus: "ISSUED" }).ok, true);
  assert.equal(validateAdministrationLiquidationTransition({ currentStatus: "ISSUED", nextStatus: "PAID" }).terminal, true);
  assert.equal(administrationActionForLiquidationStage("PENDING_APPROVAL"), "EDIT");
  assert.equal(administrationActionForLiquidationStage("ISSUED"), "APPROVE");
});

test("El período mensual se normaliza sin aceptar fechas ambiguas", () => {
  assert.equal(normalizeAdministrationPeriod("2026-02"), "2026-02");
  assert.equal(normalizeAdministrationPeriod("febrero"), "2026-08");
});
