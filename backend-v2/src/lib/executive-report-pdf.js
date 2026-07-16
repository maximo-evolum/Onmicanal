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
