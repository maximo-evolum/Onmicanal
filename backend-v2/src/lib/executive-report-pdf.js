const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 44;
const BOTTOM = 52;

function pdfText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function formatValue(metric) {
  const label = String(metric?.label || "").toLowerCase();
  const value = Number(metric?.value || 0);
  if (/(cobrado|pendiente|cancelado|forecast|pagado|ingreso|resultado|neto|costo|gasto|caido|devuelto|perdida)/.test(label)) {
    return `$ ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)}`;
  }
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value);
}

function chartSeries(report) {
  const source = Array.isArray(report?.economicChart?.series) ? report.economicChart.series : [];
  return source
    .map((item) => ({ label: String(item?.label || "Dato"), value: Math.max(0, Number(item?.value || 0)) }))
    .slice(0, 4);
}

function drawEconomicChart(line) {
  const series = line.series || [];
  if (!series.length) return "";

  const x = LEFT;
  const width = 524;
  const top = Number(line.y || 0);
  const bottom = top - 138;
  const plotBottom = bottom + 34;
  const plotHeight = 62;
  const max = Math.max(...series.map((item) => item.value), 1);
  const colors = ["0.18 0.55 1", "0.54 0.18 1", "0.94 0.56 0.18", "0.38 0.86 0.72"];
  const commands = [
    "q",
    "0.055 0.07 0.13 rg",
    `${x} ${bottom} ${width} 138 re f`,
    "0.36 0.18 0.74 RG",
    "0.8 w",
    `${x} ${bottom} ${width} 138 re S`,
    "Q",
    `BT /F1 12 Tf 0.22 0.55 1 rg ${x + 16} ${top - 22} Td (${pdfText(line.title || "ESTADO ECONOMICO")}) Tj ET`,
    `BT /F1 8 Tf 0.62 0.66 0.77 rg ${x + 16} ${top - 37} Td (Ingresos, costos, devoluciones y resultado del periodo) Tj ET`,
    "0.20 0.23 0.34 RG",
    "0.5 w",
    `${x + 44} ${plotBottom} m ${x + width - 20} ${plotBottom} l S`,
    `BT /F1 7 Tf 0.55 0.58 0.70 rg ${x + width - 86} ${plotBottom + plotHeight + 6} Td (MAX $ ${pdfText(new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(max))}) Tj ET`
  ];

  const slot = (width - 94) / series.length;
  series.forEach((item, index) => {
    const barWidth = Math.min(58, slot - 18);
    const barX = x + 58 + index * slot + (slot - barWidth) / 2;
    const height = Math.max(item.value > 0 ? 3 : 0, (item.value / max) * plotHeight);
    commands.push(`${colors[index % colors.length]} rg`);
    commands.push(`${barX.toFixed(1)} ${plotBottom} ${barWidth.toFixed(1)} ${height.toFixed(1)} re f`);
    commands.push(`BT /F1 8 Tf 0.93 0.94 0.99 rg ${barX.toFixed(1)} ${(plotBottom + height + 7).toFixed(1)} Td ($ ${pdfText(new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(item.value))}) Tj ET`);
    commands.push(`BT /F1 8 Tf 0.70 0.72 0.82 rg ${barX.toFixed(1)} ${bottom + 14} Td (${pdfText(item.label)}) Tj ET`);
  });
  return commands.join("\n");
}

function comparisonValue(value, format) {
  const numberValue = Number(value || 0);
  if (format === "currency") return `$ ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(numberValue)}`;
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(numberValue);
}

function drawComparisonChart(line) {
  const series = Array.isArray(line.series) ? line.series.slice(0, 4) : [];
  if (!series.length) return "";
  const x = LEFT;
  const width = 524;
  const top = Number(line.y || 0);
  const bottom = top - 150;
  const baseline = bottom + 54;
  const plotHeight = 54;
  const max = Math.max(...series.flatMap((item) => [Math.abs(Number(item.current || 0)), Math.abs(Number(item.previous || 0))]), 1);
  const slot = (width - 88) / series.length;
  const commands = [
    "q", "0.055 0.07 0.13 rg", `${x} ${bottom} ${width} 150 re f`, "0.15 0.36 0.72 RG", "0.8 w", `${x} ${bottom} ${width} 150 re S`, "Q",
    `BT /F1 12 Tf 0.22 0.55 1 rg ${x + 16} ${top - 22} Td (${pdfText(line.title || "COMPARACION")}) Tj ET`,
    `BT /F1 8 Tf 0.18 0.55 1 rg ${x + 338} ${top - 21} Td (Periodo actual) Tj ET`,
    `BT /F1 8 Tf 0.54 0.18 1 rg ${x + 432} ${top - 21} Td (Periodo anterior) Tj ET`,
    "0.20 0.23 0.34 RG", "0.5 w", `${x + 38} ${baseline} m ${x + width - 20} ${baseline} l S`
  ];

  series.forEach((item, index) => {
    const center = x + 52 + index * slot + slot / 2;
    const values = [Number(item.current || 0), Number(item.previous || 0)];
    const colors = ["0.18 0.55 1", "0.54 0.18 1"];
    const offsets = [-15, 15];
    values.forEach((value, valueIndex) => {
      const height = Math.max(value ? 3 : 0, (Math.abs(value) / max) * plotHeight);
      const y = value >= 0 ? baseline : baseline - height;
      commands.push(`${colors[valueIndex]} rg`);
      commands.push(`${(center + offsets[valueIndex] - 10).toFixed(1)} ${y.toFixed(1)} 20 ${height.toFixed(1)} re f`);
      const labelY = value >= 0 ? y + height + 5 : y - 9;
      commands.push(`BT /F1 6 Tf 0.88 0.90 0.98 rg ${(center + offsets[valueIndex] - 16).toFixed(1)} ${labelY.toFixed(1)} Td (${pdfText(comparisonValue(value, line.format))}) Tj ET`);
    });
    commands.push(`BT /F1 7 Tf 0.68 0.71 0.82 rg ${(center - 24).toFixed(1)} ${bottom + 17} Td (${pdfText(item.label)}) Tj ET`);
  });
  return commands.join("\n");
}

function buildPage(lines, pageNumber) {
  const commands = [
    "q",
    "0.02 0.027 0.055 rg",
    `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} re f`,
    "0.54 0.18 1 rg",
    `0 766 ${PAGE_WIDTH} 3 re f`,
    "Q",
  ];

  for (const line of lines) {
    if (line.type === "economic-chart") {
      commands.push(drawEconomicChart(line));
      continue;
    }
    if (line.type === "comparison-chart") {
      commands.push(drawComparisonChart(line));
      continue;
    }
    const color = line.color || "0.90 0.91 0.97";
    commands.push(`BT /F1 ${line.size || 10} Tf ${color} rg ${line.x || LEFT} ${line.y} Td (${pdfText(line.text)}) Tj ET`);
  }

  commands.push(`BT /F1 8 Tf 0.55 0.58 0.70 rg ${LEFT} 28 Td (EVOLUM OS - Reporte ejecutivo confidencial) Tj ET`);
  commands.push(`BT /F1 8 Tf 0.55 0.58 0.70 rg 548 28 Td (${pageNumber}) Tj ET`);
  return commands.join("\n");
}

/**
 * Genera un PDF ligero sin servicios externos. Los datos vienen del mismo
 * resumen ejecutivo que ve el tenant, por lo que no expone otra fuente.
 */
export function buildExecutiveReportPdf(report) {
  const pages = [];
  let lines = [];
  let y = 734;

  const add = (text, options = {}) => {
    const height = options.height || (options.size || 10) + 8;
    if (y - height < BOTTOM) {
      pages.push(buildPage(lines, pages.length + 1));
      lines = [];
      y = 734;
    }
    lines.push({ text, y, ...options });
    y -= height;
  };

  add("EVOLUM OS", { size: 24, color: "0.54 0.18 1", height: 34 });
  add("REPORTE EJECUTIVO GENERAL", { size: 13, color: "0.22 0.55 1", height: 24 });
  add(report?.tenant?.name || "Cuenta", { size: 17, color: "0.96 0.96 1", height: 26 });
  add(`${report?.tenant?.industryLabel || "Operacion"} | Generado ${new Date(report?.generatedAt || Date.now()).toLocaleString("es-CL")}`, { size: 9, color: "0.64 0.66 0.77", height: 28 });

  add("RESUMEN EJECUTIVO", { size: 12, color: "0.54 0.18 1", height: 23 });
  for (const item of report?.summary || []) {
    add(`${item.label}: ${formatValue(item)}  |  ${item.detail || ""}`, { size: 10, color: "0.91 0.92 0.98" });
  }

  const status = report?.executiveStatus || {};
  add("LECTURA EJECUTIVA DEL PERIODO", { size: 12, color: "0.54 0.18 1", height: 23 });
  add(`Base de clientes: ${new Intl.NumberFormat("es-CL").format(Number(status.totalCustomers || 0))}  |  Clientes nuevos: ${new Intl.NumberFormat("es-CL").format(Number(status.currentCustomers || 0))}  |  Variacion: ${Number(status.customerVariation || 0) >= 0 ? "+" : ""}${new Intl.NumberFormat("es-CL").format(Number(status.customerVariation || 0))}`, { size: 9, color: "0.91 0.92 0.98" });
  add(`Conversion comercial: ${new Intl.NumberFormat("es-CL").format(Number(status.conversionRate || 0))}%  |  Cierres perdidos: ${new Intl.NumberFormat("es-CL").format(Number(status.currentLost || 0))}  |  Cobranza pendiente: $ ${new Intl.NumberFormat("es-CL").format(Number(status.pendingCollection || 0))}`, { size: 9, color: "0.91 0.92 0.98" });
  add(`Intervenciones humanas requeridas: ${new Intl.NumberFormat("es-CL").format(Number(status.handoffs || 0))}`, { size: 9, color: "0.91 0.92 0.98", height: 21 });

  const economicSeries = chartSeries(report);
  if (economicSeries.length) {
    add("", { type: "economic-chart", title: report?.economicChart?.title, series: economicSeries, height: 166 });
  }

  const economicComparisons = report?.comparisons?.economics;
  if (Array.isArray(economicComparisons) && economicComparisons.length) {
    add("", { type: "comparison-chart", title: "COMPARACION FINANCIERA: ACTUAL VS. ANTERIOR", format: "currency", series: economicComparisons, height: 178 });
  }

  const operationalComparisons = report?.comparisons?.operation;
  if (Array.isArray(operationalComparisons) && operationalComparisons.length) {
    add("", { type: "comparison-chart", title: "CRECIMIENTO OPERATIVO: ACTUAL VS. ANTERIOR", format: "number", series: operationalComparisons, height: 178 });
  }

  for (const section of report?.sections || []) {
    // El detalle complementa el resumen y los gráficos. Se mantiene compacto
    // para que un informe ejecutivo no genere una página final casi vacía.
    add(section.title, { size: 12, color: "0.22 0.55 1", height: 20 });
    if (section.description) add(section.description, { size: 8, color: "0.64 0.66 0.77", height: 14 });
    for (const metric of section.metrics || []) {
      add(`${metric.label}: ${formatValue(metric)}  |  ${metric.detail || ""}`, { size: 9, height: 15 });
    }
    y -= 3;
  }

  if (lines.length) pages.push(buildPage(lines, pages.length + 1));

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  for (let index = 0; index < pages.length; index += 1) {
    const content = pages[index];
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  }

  let output = "%PDF-1.4\n%EVOLUM\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "utf8");
}
