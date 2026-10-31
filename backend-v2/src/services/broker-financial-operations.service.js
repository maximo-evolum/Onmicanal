/** Archivo: Deriva la cobranza, recaudación y reportes internos de Broker OS sin ejecutar pagos ni comunicaciones externas. */

const COLLECTION_SOURCE_TYPES = Object.freeze(["commission_settlement", "rental_payment", "administration_liquidation"]);
const PAYMENT_TERMINAL_STATUSES = new Set(["PAID", "WAIVED", "CANCELLED", "CANCELED"]);
const DAY = 86_400_000;

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function dataOf(record) {
  return record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function dateOf(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value) {
  const parsed = dateOf(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function daysLate(dueDate, now) {
  const due = dateOf(dueDate);
  if (!due) return 0;
  return Math.max(0, Math.floor((new Date(now).getTime() - due.getTime()) / DAY));
}

function sourceDefinition(record) {
  const data = dataOf(record);
  if (record.recordType === "commission_settlement") {
    return {
      sourceKind: "COMMISSION",
      resource: "commissions",
      party: text(data.brokerName || data.broker || data.recipientName || data.ownerName, "Corredor pendiente"),
      propertyId: text(data.propertyId) || null,
      operationId: text(data.operationId) || null,
      period: text(data.period) || null,
      dueDate: isoDate(data.dueDate || data.settlementDate),
      totalAmount: amount(data.amount || data.companyAmount || data.totalCommission),
      brokerAmount: amount(data.brokerAmount),
      companyAmount: amount(data.companyAmount),
      area: "commercial",
      reportGroup: text(data.operationType || data.service || data.category).toUpperCase().includes("RENT") || text(data.operationType || data.service || data.category).toUpperCase().includes("ARRIENDO")
        ? "RENTAL_PLACEMENT"
        : "SALE"
    };
  }
  if (record.recordType === "rental_payment") {
    return {
      sourceKind: "RENT",
      resource: "administration",
      party: text(data.tenantName || data.clientName || data.payerName, "Arrendatario pendiente"),
      propertyId: text(data.propertyId) || null,
      operationId: text(data.operationId) || null,
      period: text(data.period) || null,
      dueDate: isoDate(data.dueDate),
      totalAmount: amount(data.amount || data.monthlyRent),
      brokerAmount: 0,
      companyAmount: 0,
      area: "rentals",
      reportGroup: "ADMINISTRATION"
    };
  }
  return {
    sourceKind: "ADMINISTRATION",
    resource: "administration",
    party: text(data.ownerName || data.recipientName, "Propietario pendiente"),
    propertyId: text(data.propertyId) || null,
    operationId: text(data.operationId) || null,
    period: text(data.period) || null,
    dueDate: isoDate(data.transferDate || data.dueDate),
    totalAmount: amount(data.ownerTransferAmount || data.amount),
    brokerAmount: 0,
    companyAmount: amount(data.managementFee),
    area: "rentals",
    reportGroup: "ADMINISTRATION"
  };
}

function paymentReport(data) {
  const report = data.paymentReport;
  return report && typeof report === "object" && !Array.isArray(report) ? report : null;
}

function collectionState(record, definition, now) {
  const data = dataOf(record);
  const normalizedStatus = text(record.status).toUpperCase();
  const report = paymentReport(data);
  const totalAmount = definition.totalAmount;
  if (PAYMENT_TERMINAL_STATUSES.has(normalizedStatus)) return { code: "PAID", label: "Pagado registrado", terminal: true, outstanding: 0 };
  if (report?.amount) {
    const reportedAmount = amount(report.amount);
    return {
      code: "PAYMENT_REPORTED",
      label: reportedAmount >= totalAmount && totalAmount > 0 ? "Pago informado pendiente de revisión" : "Abono informado pendiente de revisión",
      terminal: false,
      outstanding: Math.max(0, totalAmount - reportedAmount),
      reportedAmount
    };
  }
  const overdueDays = daysLate(definition.dueDate, now);
  if (normalizedStatus === "OVERDUE" || overdueDays > 0) return { code: "OVERDUE", label: "Vencido", terminal: false, outstanding: totalAmount };
  if (["PENDING_APPROVAL", "ISSUED"].includes(normalizedStatus)) return { code: "PENDING_APPROVAL", label: "Pendiente de aprobación", terminal: false, outstanding: totalAmount };
  if (normalizedStatus === "DRAFT") return { code: "DRAFT", label: "Borrador interno", terminal: false, outstanding: totalAmount };
  return { code: "PENDING", label: "Pendiente", terminal: false, outstanding: totalAmount };
}

function collectionPriority({ state, overdueDays, outstanding }) {
  if (state === "OVERDUE" && overdueDays >= 60) return "CRITICAL";
  if (state === "OVERDUE" && overdueDays >= 30) return "HIGH";
  if (state === "OVERDUE") return "MEDIUM";
  if (state === "PAYMENT_REPORTED") return "HIGH";
  if (outstanding > 0) return "LOW";
  return "INFO";
}

function sourceHref(entry) {
  const params = new URLSearchParams({ view: "broker_os", tab: entry.area, recordId: entry.id });
  return `/realty?${params.toString()}`;
}

function reportMetric(rows) {
  const total = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const reported = rows.reduce((sum, row) => sum + Number(row.reportedAmount || 0), 0);
  const paid = rows.filter((row) => row.state === "PAID").reduce((sum, row) => sum + row.totalAmount, 0);
  const pending = rows.filter((row) => row.state !== "PAID").reduce((sum, row) => sum + row.outstanding, 0);
  return { count: rows.length, total, paid, reported, pending };
}

function dateInPeriod(value, period) {
  return Boolean(period && isoDate(value)?.startsWith(period));
}

function propertyNameById(properties = []) {
  return new Map(properties.map((property) => [String(property.id), text(property.title, "Propiedad sin nombre")]));
}

// Una fuente de verdad: todas las filas conservan el ID de su registro de
// origen. Esta función no crea documentos financieros paralelos.
export function buildBrokerFinancialOperations({ records = [], properties = [], period = "", now = new Date() } = {}) {
  const names = propertyNameById(properties);
  const normalizedPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(text(period)) ? text(period) : "";
  const rows = records
    .filter((record) => COLLECTION_SOURCE_TYPES.includes(record.recordType))
    .map((record) => {
      const definition = sourceDefinition(record);
      const state = collectionState(record, definition, now);
      const overdueDays = daysLate(definition.dueDate, now);
      const data = dataOf(record);
      const reminderEvents = Array.isArray(data.collectionActions) ? data.collectionActions.filter((event) => event?.type === "REMINDER_PREPARED") : [];
      const row = {
        id: record.id,
        title: record.title,
        recordType: record.recordType,
        sourceKind: definition.sourceKind,
        resource: definition.resource,
        area: definition.area,
        sourceHref: sourceHref({ id: record.id, area: definition.area }),
        party: definition.party,
        propertyId: definition.propertyId,
        propertyTitle: definition.propertyId ? names.get(String(definition.propertyId)) || "Propiedad no visible" : "Sin propiedad vinculada",
        operationId: definition.operationId,
        period: definition.period,
        dueDate: definition.dueDate,
        totalAmount: definition.totalAmount,
        outstanding: state.outstanding,
        reportedAmount: Number(state.reportedAmount || 0),
        state: state.code,
        stateLabel: state.label,
        terminal: state.terminal,
        overdueDays,
        priority: collectionPriority({ state: state.code, overdueDays, outstanding: state.outstanding }),
        reminderPreparedAt: reminderEvents.at(-1)?.at || null,
        paymentReport: paymentReport(data),
        reportGroup: definition.reportGroup,
        brokerAmount: definition.brokerAmount,
        companyAmount: definition.companyAmount,
        updatedAt: record.updatedAt || null
      };
      return row;
    })
    .filter((row) => !normalizedPeriod || row.period === normalizedPeriod || dateInPeriod(row.dueDate, normalizedPeriod))
    .sort((left, right) => right.overdueDays - left.overdueDays || right.outstanding - left.outstanding || String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31")));

  const queue = rows.filter((row) => !row.terminal);
  const sales = rows.filter((row) => row.reportGroup === "SALE");
  const rentalPlacement = rows.filter((row) => row.reportGroup === "RENTAL_PLACEMENT");
  const administration = rows.filter((row) => row.reportGroup === "ADMINISTRATION");
  const costs = records
    .filter((record) => ["maintenance_ticket", "utility_monitoring", "material_purchase", "provider_quote"].includes(record.recordType))
    .filter((record) => !normalizedPeriod || text(dataOf(record).period) === normalizedPeriod || dateInPeriod(dataOf(record).dueDate || dataOf(record).completedAt, normalizedPeriod))
    .reduce((sum, record) => sum + amount(dataOf(record).amount || dataOf(record).estimatedAmount), 0);
  const grossRevenue = rows.reduce((sum, row) => sum + row.companyAmount, 0);
  const margin = grossRevenue - costs;
  const brokerSettlements = [...rows.filter((row) => row.sourceKind === "COMMISSION")]
    .reduce((groups, row) => {
      const key = row.party.toLocaleLowerCase("es-CL");
      const current = groups.get(key) || { broker: row.party, count: 0, gross: 0, paid: 0, pending: 0, reported: 0 };
      current.count += 1;
      current.gross += row.brokerAmount;
      current.paid += row.state === "PAID" ? row.brokerAmount : 0;
      current.pending += row.state === "PAID" ? 0 : row.brokerAmount;
      current.reported += row.state === "PAYMENT_REPORTED" ? Math.min(row.brokerAmount, row.reportedAmount) : 0;
      groups.set(key, current);
      return groups;
    }, new Map());

  return {
    period: normalizedPeriod || null,
    queue,
    summary: {
      pendingCount: queue.length,
      overdueCount: queue.filter((row) => row.state === "OVERDUE").length,
      reviewCount: queue.filter((row) => row.state === "PAYMENT_REPORTED" || row.state === "PENDING_APPROVAL").length,
      pendingAmount: queue.reduce((sum, row) => sum + row.outstanding, 0),
      reportedAmount: queue.reduce((sum, row) => sum + row.reportedAmount, 0)
    },
    reports: {
      sales: reportMetric(sales),
      rentalPlacement: reportMetric(rentalPlacement),
      administration: reportMetric(administration),
      margin: { grossRevenue, costs, amount: margin, roiPct: costs > 0 ? Number(((margin / costs) * 100).toFixed(2)) : null, basis: "Ingresos de empresa registrados en liquidaciones y comisiones, menos costos internos informados." },
      brokerSettlements: [...brokerSettlements.values()].sort((left, right) => right.pending - left.pending || left.broker.localeCompare(right.broker, "es-CL"))
    },
    // Vista de consulta que reutiliza exactamente los mismos estados de los
    // cobros de administración. No habilita un portal público ni permite que
    // el arrendatario modifique un pago desde esta simulación.
    tenantSimulation: rows
      .filter((row) => row.sourceKind === "RENT")
      .map((row) => ({
        id: row.id,
        tenantName: row.party,
        propertyTitle: row.propertyTitle,
        period: row.period,
        dueDate: row.dueDate,
        totalAmount: row.totalAmount,
        outstanding: row.outstanding,
        reportedAmount: row.reportedAmount,
        state: row.state,
        stateLabel: row.stateLabel,
        sourceHref: row.sourceHref
      })),
    renewalAlerts: records
      .filter((record) => record.recordType === "rental_contract")
      .map((record) => {
        const data = dataOf(record);
        const endDate = isoDate(data.endDate || data.contractEndAt || data.expiresAt);
        const days = daysLate(endDate, now) * -1;
        const futureDays = endDate ? Math.ceil((dateOf(endDate).getTime() - new Date(now).getTime()) / DAY) : null;
        return { id: record.id, title: record.title, propertyId: text(data.propertyId) || null, propertyTitle: names.get(String(data.propertyId || "")) || "Propiedad no visible", tenantName: text(data.tenantName, "Arrendatario pendiente"), endDate, daysRemaining: futureDays, status: record.status, sourceHref: sourceHref({ id: record.id, area: "rentals" }) };
      })
      .filter((row) => row.daysRemaining !== null && row.daysRemaining <= 60 && row.daysRemaining >= 0)
      .sort((left, right) => Number(left.daysRemaining) - Number(right.daysRemaining))
  };
}

export function validateBrokerFinancialAction({ record, action, input = {}, now = new Date() } = {}) {
  if (!record || !COLLECTION_SOURCE_TYPES.includes(record.recordType)) return { ok: false, error: "El antecedente no pertenece a la cobranza operativa de Broker OS." };
  const normalizedAction = text(action).toUpperCase();
  if (!["PREPARE_REMINDER", "REPORT_PAYMENT", "REQUEST_REVIEW"].includes(normalizedAction)) return { ok: false, error: "La acción financiera no es válida." };
  const definition = sourceDefinition(record);
  const state = collectionState(record, definition, now);
  if (state.terminal) return { ok: false, error: "El antecedente ya está cerrado como pagado o eximido." };
  const note = text(input.note).slice(0, 1200);
  if (normalizedAction === "REPORT_PAYMENT") {
    const reportedAmount = amount(input.amount || definition.totalAmount);
    if (!(reportedAmount > 0)) return { ok: false, error: "Indica un monto informado mayor que cero." };
    return { ok: true, action: normalizedAction, note, reportedAmount };
  }
  return { ok: true, action: normalizedAction, note, reportedAmount: null };
}

export function applyBrokerFinancialAction({ record, action, input = {}, actor = "Usuario autorizado", now = new Date() } = {}) {
  const validation = validateBrokerFinancialAction({ record, action, input, now });
  if (!validation.ok) return validation;
  const data = dataOf(record);
  const at = new Date(now).toISOString();
  const collectionActions = Array.isArray(data.collectionActions) ? data.collectionActions : [];
  const event = {
    at,
    type: validation.action,
    note: validation.note || null,
    by: text(actor, "Usuario autorizado"),
    externalDelivery: false,
    requiresHumanApproval: validation.action === "REPORT_PAYMENT"
  };
  const nextData = { ...data, collectionActions: [...collectionActions, event], lastCollectionActionAt: at, requiresHumanApproval: true, automaticPayment: false, automaticCollection: false };
  if (validation.action === "REPORT_PAYMENT") {
    nextData.paymentReport = { amount: validation.reportedAmount, reportedAt: at, reportedBy: text(actor, "Usuario autorizado"), note: validation.note || null, status: "PENDING_REVIEW" };
  }
  return { ok: true, action: validation.action, data: nextData, event };
}

export { COLLECTION_SOURCE_TYPES };
