import ExcelJS from "exceljs";
import { FinanceOperationError } from "./finance-integrity.service.js";
export async function movementLedgerExcel(result, context = {}) {
  if (result.records.length !== result.total) throw new FinanceOperationError(409, "La exportación requiere todos los resultados, no una página.");
  if (result.total > 100000) throw new FinanceOperationError(422, "Hay más de 100.000 movimientos. Reduce el período o los filtros para exportar; no se generó un archivo parcial.");
  const book = new ExcelJS.Workbook(); book.creator = "Finance OS"; book.created = new Date();
  const sheet = book.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 1 }] });
  const keys = ["date", "description", "amount", "currency", "direction", "status", "reference", "rut", "payer", "bank", "account", "last4", "sourceFile", "sourceRow", "sourceSheet", "id", "importRevision", "confidenceLabel"];
  const headers = ["Fecha", "Descripción", "Monto", "Moneda", "Tipo", "Estado", "Referencia", "RUT", "Contraparte", "Banco", "Cuenta", "Últimos 4 dígitos", "Cartola", "Fila origen", "Hoja origen", "Identificador", "Revisión importada", "Puntaje de conciliación vigente"];
  const labels = { CREDIT: "Abono", DEBIT: "Cargo", UNKNOWN: "Por identificar", MATCHED: "Conciliado", PENDING: "Pendiente", REVIEW: "En revisión", EXCLUDED: "Excluido", OTHER: "Otro estado" };
  sheet.columns = keys.map((key, i) => ({ key, header: headers[i], width: ["description", "sourceFile", "payer"].includes(key) ? 42 : key === "id" ? 32 : 20 }));
  for (const record of result.records) {
    // Explicit strings never become ExcelJS formula or hyperlink objects.
    sheet.addRow(keys.map((key) => key === "amount" ? record.amount : String(key === "direction" || key === "status" ? labels[record[key]] || record[key] : record[key] ?? "")));
  }
  sheet.autoFilter = { from: "A1", to: "R1" };
  sheet.getColumn(19).header = "Responsable (ID)"; sheet.getColumn(19).width = 32;
  result.records.forEach((r, index) => { sheet.getCell(index + 2, 19).value = String(r.assignedToId || ""); });
  sheet.autoFilter = { from: "A1", to: "S1" };
  sheet.getColumn(3).numFmt = '#,##0.####;[Red]-#,##0.####';
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF086B70" } };
  sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  const summary = book.addWorksheet("Contexto y totales"); summary.columns = [{ width: 35 }, { width: 85 }];
  summary.addRows([["Finance OS", "Exportación de movimientos filtrados"], ["Generado UTC", book.created.toISOString()], ["Cantidad", result.total], ["Abonos", result.summary.credits], ["Cargos", result.summary.debits], ["Sin clasificar o monto inválido", result.summary.unclassified], ["Advertencia", "Totales de registros filtrados. No son saldo bancario ni prueba de cobertura completa."], ["Columnas", "Se incluyen todas las columnas, aunque estén ocultas en pantalla."]]);
  if (result.scopeNotice) summary.addRow(["Alcance de fechas", result.scopeNotice]);
  if (context.owner) summary.addRow(["Filtro de responsable", context.owner === "NONE" ? "Sin responsable" : context.owner === "ASSIGNED" ? "Con responsable" : String(context.owner)]);
  summary.addRow(["Puntaje", "Puntaje almacenado de la conciliación aprobada vigente. No es probabilidad ni una sugerencia actual. Las reversas no aportan puntaje vigente."]);
  if (context.importRevision) summary.addRow(["Filtro de revisión importada", context.importRevision === "UNKNOWN" ? "Sin versión registrada" : String(context.importRevision)]);
  if (context.confidence) summary.addRow(["Filtro de puntaje", ({ ALL: "Todos", HIGH: "Alto: 95 a 100", MEDIUM: "Medio: 80 a menos de 95", LOW: "Bajo: menos de 80", UNKNOWN: "Sin puntaje vigente" })[context.confidence] || "No especificado"]);
  for (const key of ["period", "currency", "accountKey", "search", "from", "to", "min", "max", "direction", "status", "sort"]) {
    const name = { period: "Período", currency: "Moneda", accountKey: "Identificador de cuenta", search: "Búsqueda", from: "Desde", to: "Hasta", min: "Monto mínimo", max: "Monto máximo", direction: "Tipo", status: "Estado", sort: "Orden" }[key];
    if (context[key]) summary.addRow([key === "period" && result.dateScope === "UNDATED" ? "Período activo (no aplicado)" : name, labels[context[key]] || ({ ALL: "Todos", date_desc: "Más recientes", date_asc: "Más antiguos", amount_desc: "Mayor monto", amount_asc: "Menor monto" }[context[key]]) || String(context[key])]);
  }
  summary.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  return Buffer.from(await book.xlsx.writeBuffer());
}
