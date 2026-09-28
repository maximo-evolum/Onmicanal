import ExcelJS from "exceljs";
import { FinanceOperationError } from "../services/finance-integrity.service.js";

export const PROCESS_REPORT_COLUMNS = [
  ["id", "Identificador", 30], ["date", "Fecha operativa", 16], ["description", "Descripción", 45],
  ["statusLabel", "Estado verificado", 28], ["direction", "Tipo de movimiento", 20], ["amount", "Monto", 20], ["currency", "Moneda", 12],
  ["bank", "Banco", 25], ["account", "Cuenta", 25], ["last4", "Últimos 4 dígitos", 18],
  ["sourceFile", "Archivo de origen", 35], ["sourceSheet", "Hoja de origen", 24], ["sourceRow", "Fila de origen", 16],
  ["reference", "Referencia", 25], ["movementId", "Movimiento vinculado", 30], ["batchId", "Cartola vinculada", 30],
  ["reconciliationId", "Conciliación", 30], ["documents", "Documentos y asignaciones", 55],
  ["approvedBy", "Aprobado por (ID)", 30], ["approvedAt", "Fecha de aprobación", 28],
  ["category", "Categoría", 28], ["detail", "Observación", 70], ["resolution", "Resolución", 60],
  ["resolvedBy", "Resuelto por (ID)", 30], ["resolvedAt", "Fecha de resolución", 28]
];
const compact = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
export function processReportSummary(report) {
  return [["Reporte", report.title], ["Empresa", report.company.name], ["Identificador de empresa", report.company.id],
    ["Período operativo", report.query.period], ["Cuenta", report.query.accountKey || "Todas las cuentas de la moneda"], ["Moneda", report.query.currency],
    ["Filtro de estado", report.query.status ? report.summary.counts[report.query.status]?.label : "Todos"], ["Búsqueda", report.query.search || "Sin búsqueda"],
    ["Generado (UTC)", report.generatedAt], ["Huella de la instantánea", report.fingerprint], ["Registros incluidos", report.summary.total],
    ...Object.values(report.summary.counts).map((s) => [s.label, s.count]),
    ...(report.summary.credits === null ? [] : [["Abonos no excluidos", report.summary.credits], ["Cargos no excluidos", report.summary.debits]]),
    ["Registros sin fecha", report.summary.undated], ["Registros sin monto validado", report.summary.withoutAmount],
    ["Observaciones de evidencia del contexto completo", report.issues.length], ...report.notices.map((n) => ["Alcance y limitaciones", n])];
}

export async function financeProcessReportExcel(report) {
  const book = new ExcelJS.Workbook(); book.creator = "EVOLUM Finance OS"; book.created = new Date(report.generatedAt);
  const summary = book.addWorksheet("Resumen"); summary.columns = [{ header: "Concepto", width: 48 }, { header: "Valor", width: 110 }];
  for (const row of processReportSummary(report)) {
    const added = summary.addRow(row);
    if (typeof row[1] === "number") added.getCell(2).numFmt = /Abonos|Cargos/.test(row[0]) && report.query.currency !== "CLP" ? report.query.currency === "UF" ? '#,##0.0000' : '#,##0.00' : '#,##0';
  }
  const columns = PROCESS_REPORT_COLUMNS.filter(([key]) => report.query.kind === "exceptions" ? !["reconciliationId", "documents", "approvedBy", "approvedAt"].includes(key) : !["category", "resolution", "resolvedBy", "resolvedAt"].includes(key));
  const sheet = book.addWorksheet("Detalle"); sheet.columns = columns.map(([key, header, width]) => ({ key, header, width }));
  for (const item of report.rows) {
    // Plain string values cannot become spreadsheet formulas or external links.
    for (const [key] of columns) if (typeof item[key] === "string" && item[key].length > 32767) throw new FinanceOperationError(422, "Un campo excede el tamaño de una celda Excel. No se exportaron datos truncados.");
    const row = sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, item[key] === "" ? "Sin registro" : typeof item[key] === "string" ? compact(item[key]) : item[key]])));
    row.getCell("amount").numFmt = report.query.currency === "CLP" ? '#,##0;[Red](#,##0);"-"' : report.query.currency === "UF" ? '#,##0.0000;[Red](#,##0.0000);"-"' : '#,##0.00;[Red](#,##0.00);"-"';
  }
  const issues = book.addWorksheet("Evidencia del contexto"); issues.columns = [{ header: "Código de control", width: 40 }, { header: "Identificador", width: 40 }, { header: "Observación", width: 120 }];
  for (const issue of report.issues) issues.addRow([issue.type, issue.id, issue.title]);
  for (const ws of book.worksheets) {
    ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: ws.columnCount } };
    ws.getRow(1).height = 30;
    ws.eachRow((row, i) => {
      row.alignment = { vertical: "top", wrapText: true };
      let maxLines = 1;
      row.eachCell((cell, column) => { const width = Math.max(8, (ws.getColumn(column).width || 12) - 3); maxLines = Math.max(maxLines, String(cell.value ?? "").split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / width)), 0)); });
      const height = Math.max(30, maxLines * 16 + 12);
      if (height > 409 || row.values.some((v) => typeof v === "string" && v.length > 32767)) throw new FinanceOperationError(422, "Un texto es demasiado largo para mostrarse completo en Excel. Descarga el PDF; no se exportaron celdas recortadas.");
      row.height = height;
      row.eachCell((cell) => { cell.font = { name: "Calibri", size: 11, color: { argb: i === 1 ? "FFFFFFFF" : "FF173D46" }, bold: i === 1 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 1 ? "FF075663" : i % 2 ? "FFF0F7F7" : "FFFFFFFF" } }; });
    });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

// A deliberately simple, paginated text report. Fixed-width font permits exact
// line wrapping; WinAnsi preserves Spanish accents without a runtime font service.
export function financeProcessReportPdf(report) {
  const lines = [];
  function add(value) {
    const text = compact(value).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\xff\n]/g, "?");
    for (const paragraph of text.split("\n")) {
      let rest = paragraph;
      while (rest.length > 94) { let cut = rest.lastIndexOf(" ", 94); if (cut < 35) cut = 94; lines.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); }
      lines.push(rest);
    }
  }
  processReportSummary(report).forEach(([label, value]) => add(`${label}: ${value}`));
  add(""); add("DETALLE DE REGISTROS");
  if (!report.rows.length) add("Sin registros para los filtros seleccionados.");
  for (const [i, row] of report.rows.entries()) {
    add(""); add(`${i + 1}. ${row.description}`);
    for (const [key, label] of PROCESS_REPORT_COLUMNS) if (row[key] !== "" && row[key] !== null && row[key] !== undefined && key !== "description") add(`${label}: ${row[key]}`);
    if (!row.date) add("Fecha operativa: sin determinar; requiere revisión.");
    if (row.amount === null) add("Monto: sin validar; no se incluyó en los totales.");
  }
  add(""); add("OBSERVACIONES DE EVIDENCIA DEL CONTEXTO COMPLETO");
  for (const issue of report.issues) add(`${issue.id}: ${issue.title}`);
  if (!report.issues.length) add("Sin observaciones en los controles aplicados. Esto no certifica cobertura completa.");
  const pageLines = 65, pageCount = Math.ceil(lines.length / pageLines);
  if (pageCount > 500) throw new FinanceOperationError(422, "El PDF supera 500 páginas. Acota los filtros o descarga Excel. No se generó un PDF incompleto.");
  const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"];
  const kids = [];
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  for (let p = 0; p < pageCount; p++) {
    const pageId = objects.length + 1, streamId = pageId + 1; kids.push(`${pageId} 0 R`);
    const commands = ["0.02 0.28 0.32 rg", `BT /F1 13 Tf 38 805 Td (${escape(report.title)}) Tj ET`, "0.1 0.15 0.18 rg"];
    lines.slice(p * pageLines, (p + 1) * pageLines).forEach((line, n) => commands.push(`BT /F1 9 Tf 38 ${780 - n * 11} Td (${escape(line)}) Tj ET`));
    commands.push(`BT /F1 8 Tf 38 30 Td (Finance OS - ${report.query.period} - Pagina ${p + 1} de ${pageCount}) Tj ET`);
    const stream = commands.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>"; objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;
  let content = "%PDF-1.4\n", offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(content, "latin1")); content += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const start = Buffer.byteLength(content, "latin1");
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content, "latin1");
}
