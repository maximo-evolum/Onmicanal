import { calculateBrokerAdministrationLiquidation } from "./broker-workflows.service.js";

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function numberValue(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

export const ADMINISTRATION_LIQUIDATION_STAGES = Object.freeze(["DRAFT", "PENDING_APPROVAL", "ISSUED", "PAID"]);

export function normalizeAdministrationPeriod(value, now = new Date()) {
  const candidate = text(value);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)) return candidate;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function administrationActionForLiquidationStage(stage) {
  const normalized = text(stage).toUpperCase();
  return ["ISSUED", "PAID"].includes(normalized) ? "APPROVE" : "EDIT";
}

export function validateAdministrationLiquidationTransition({ currentStatus, nextStatus }) {
  const current = text(currentStatus, "DRAFT").toUpperCase();
  const next = text(nextStatus).toUpperCase();
  if (!ADMINISTRATION_LIQUIDATION_STAGES.includes(next)) return { ok: false, error: "El estado de liquidación no es válido." };
  const currentIndex = ADMINISTRATION_LIQUIDATION_STAGES.indexOf(current);
  const nextIndex = ADMINISTRATION_LIQUIDATION_STAGES.indexOf(next);
  if (currentIndex < 0) return { ok: false, error: "El estado actual de liquidación no es válido." };
  if (nextIndex > currentIndex + 1) return { ok: false, error: "No se puede saltar etapas de la liquidación mensual." };
  if (current === "PAID" && next !== "PAID") return { ok: false, error: "La liquidación ya fue registrada como pagada." };
  return { ok: true, current, next, terminal: next === "PAID" };
}

function recordsForProperty(records, propertyId) {
  return records.filter((record) => String(dataOf(record).propertyId || "") === String(propertyId));
}

// Arma una vista mensual a partir de los antecedentes ya confirmados por el
// equipo. No asume que un cobro esté pagado ni ordena una transferencia.
export function buildMonthlyAdministration({ period, profiles = [], contracts = [], payments = [], utilities = [], maintenance = [], liquidations = [], properties = [] }) {
  const normalizedPeriod = normalizeAdministrationPeriod(period);
  const propertyTitleById = new Map(properties.map((property) => [property.id, property.title]));
  const activeProfiles = profiles.filter((profile) => String(profile.status).toUpperCase() === "ACTIVE");

  const rows = activeProfiles.map((profile) => {
    const profileData = dataOf(profile);
    const propertyId = text(profileData.propertyId);
    const contract = recordsForProperty(contracts, propertyId).find((item) => ["ACTIVE", "PENDING_RENEWAL"].includes(String(item.status).toUpperCase()));
    const contractData = dataOf(contract);
    const periodPayments = recordsForProperty(payments, propertyId).filter((item) => text(dataOf(item).period) === normalizedPeriod);
    const paidAmount = periodPayments
      .filter((item) => String(item.status).toUpperCase() === "PAID")
      .reduce((sum, item) => sum + numberValue(dataOf(item).amount), 0);
    const periodUtilities = recordsForProperty(utilities, propertyId)
      .filter((item) => text(dataOf(item).period) === normalizedPeriod || text(dataOf(item).dueDate).startsWith(normalizedPeriod));
    const utilitiesAmount = periodUtilities.reduce((sum, item) => sum + numberValue(dataOf(item).amount), 0);
    const periodMaintenance = recordsForProperty(maintenance, propertyId)
      .filter((item) => text(dataOf(item).period) === normalizedPeriod || text(dataOf(item).completedAt).startsWith(normalizedPeriod))
      .reduce((sum, item) => sum + numberValue(dataOf(item).amount || dataOf(item).estimatedAmount), 0);
    const existingLiquidation = recordsForProperty(liquidations, propertyId).find((item) => text(dataOf(item).period) === normalizedPeriod) || null;
    const monthlyRent = numberValue(contractData.monthlyRent);
    const managementRatePct = numberValue(profileData.managementRatePct);
    const preview = calculateBrokerAdministrationLiquidation({
      monthlyRent,
      paidAmount,
      commonExpenses: utilitiesAmount,
      utilities: 0,
      maintenanceCost: periodMaintenance,
      managementRatePct,
    });
    return {
      propertyId,
      propertyTitle: propertyTitleById.get(propertyId) || text(profile.title, "Propiedad sin nombre"),
      profileId: profile.id,
      ownerName: text(profileData.ownerName, "Propietario pendiente"),
      tenantName: text(profileData.tenantName || contractData.tenantName, "Arrendatario pendiente"),
      monthlyRent,
      paidAmount,
      commonExpenses: utilitiesAmount,
      utilities: 0,
      maintenanceCost: periodMaintenance,
      managementRatePct,
      ownerPaymentDay: numberValue(profileData.ownerPaymentDay),
      contractStatus: contract ? contract.status : "MISSING",
      paymentCount: periodPayments.length,
      utilityCount: periodUtilities.length,
      maintenanceCount: periodMaintenance ? 1 : 0,
      preview,
      liquidation: existingLiquidation ? { id: existingLiquidation.id, title: existingLiquidation.title, status: existingLiquidation.status, data: dataOf(existingLiquidation), updatedAt: existingLiquidation.updatedAt } : null,
      readyToPrepare: Boolean(propertyId && contract && monthlyRent > 0),
    };
  });

  const summary = {
    managedProperties: rows.length,
    readyToPrepare: rows.filter((row) => row.readyToPrepare && !row.liquidation).length,
    pendingApproval: rows.filter((row) => row.liquidation?.status === "PENDING_APPROVAL").length,
    issued: rows.filter((row) => row.liquidation?.status === "ISSUED").length,
    paid: rows.filter((row) => row.liquidation?.status === "PAID").length,
    expectedRent: rows.reduce((sum, row) => sum + row.monthlyRent, 0),
    paidRent: rows.reduce((sum, row) => sum + row.paidAmount, 0),
    proposedOwnerAmount: rows.reduce((sum, row) => sum + numberValue(row.preview.ownerTransferAmount), 0),
  };
  return { period: normalizedPeriod, rows, summary };
}
