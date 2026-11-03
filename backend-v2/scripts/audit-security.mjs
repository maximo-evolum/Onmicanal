/** Archivo: Audita dependencias y bloquea riesgos no aprobados en la cadena de ExcelJS. */
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const audit = spawnSync(npm, ["audit", "--json"], {
  encoding: "utf8",
  // Windows requiere cmd.exe para ejecutar un archivo .cmd; el comando y sus
  // argumentos son constantes, por lo que no se interpolan entradas externas.
  shell: process.platform === "win32"
});
if (audit.error) throw audit.error;

let report;
try {
  report = JSON.parse(audit.stdout || "{}");
} catch {
  console.error("La auditoría de npm no devolvió un JSON válido.");
  process.exit(1);
}

const fingerprint = (name, finding) => {
  const via = (finding.via || []).map((entry) => {
    if (typeof entry === "string") return entry;
    return `${entry.name || "desconocido"}:${entry.source || "sin-id"}`;
  }).sort().join(",");
  return `${name}|${finding.severity}|${via}`;
};

// ExcelJS 4.4.0 es necesario para la importación/exportación actual de cartolas.
// npm sólo propone bajarlo a 4.1.1, no actualizarlo. La excepción
// está cerrada por nombre, severidad y advisory: cualquier hallazgo adicional falla.
const allowedKnownModerates = new Set([
  "archiver|moderate|archiver-utils,readdir-glob,zip-stream",
  "archiver-utils|moderate|glob",
  "exceljs|moderate|archiver",
  "glob|moderate|minimatch",
  "minimatch|moderate|minimatch:1244012",
  "readdir-glob|moderate|minimatch",
  "rimraf|moderate|glob",
  "zip-stream|moderate|archiver-utils"
]);

const vulnerabilities = report.vulnerabilities || {};
const unexpected = Object.entries(vulnerabilities).filter(([name, finding]) => !allowedKnownModerates.has(fingerprint(name, finding)));
const highOrCritical = Object.entries(vulnerabilities).filter(([, finding]) => ["high", "critical"].includes(finding.severity));

if (highOrCritical.length || unexpected.length) {
  console.error("La auditoría detectó vulnerabilidades no aprobadas:");
  for (const [name, finding] of [...highOrCritical, ...unexpected]) {
    console.error(`- ${name}: ${finding.severity}`);
  }
  process.exit(1);
}

const count = Object.keys(vulnerabilities).length;
if (count) {
  console.warn(`Auditoría aprobada con ${count} vulnerabilidades moderadas conocidas de ExcelJS; no existe actualización segura disponible en npm.`);
}
