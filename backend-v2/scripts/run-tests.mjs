import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// Expand test paths without depending on shell globbing or Node's changing
// directory discovery rules. Fixtures are not executable tests.
const root = fileURLToPath(new URL("../", import.meta.url));
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(location) : entry.name.endsWith(".test.js") ? [location] : [];
  }));
  return files.flat().sort();
}
const files = await collect(path.join(root, "test"));
if (!files.length) throw new Error("No se encontraron pruebas del backend.");
console.log(`Backend: ${files.length} archivos de pruebas con Node ${process.version}`);
const child = spawn(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  cwd: root, stdio: "inherit", windowsHide: true
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
