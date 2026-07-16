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
  if (/(cobrado|pendiente|cancelado|forecast|pagado|ingreso)/.test(label)) {
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
    `BT /F1 12 Tf 0.22 0.55 1 rg ${x + 16} ${top - 22} Td (RESUMEN ECONOMICO) Tj ET`,
    `BT /F1 8 Tf 0.62 0.66 0.77 rg ${x + 16} ${top - 37} Td (Cobranza, pipeline y proyeccion en CLP) Tj ET`,
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

  const economicSeries = chartSeries(report);
  if (economicSeries.length) {
    add("", { type: "economic-chart", series: economicSeries, height: 166 });
  }

  for (const section of report?.sections || []) {
    add(section.title, { size: 13, color: "0.22 0.55 1", height: 23 });
    if (section.description) add(section.description, { size: 9, color: "0.64 0.66 0.77", height: 18 });
    for (const metric of section.metrics || []) {
      add(`${metric.label}: ${formatValue(metric)}  |  ${metric.detail || ""}`, { size: 10 });
    }
    y -= 7;
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
