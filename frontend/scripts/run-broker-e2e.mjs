/**
 * Ejecuta los recorridos E2E de Broker OS sobre una instancia local temporal.
 * La evidencia se conserva exclusivamente fuera del repositorio.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = resolve(process.env.QA_OUTPUT || 'E:/Entregables_EVOLUM_OS/QA_Broker_OS/latest');
const permittedEvidenceRoot = resolve('E:/Entregables_EVOLUM_OS');
const host = process.env.BROKER_E2E_HOST || 'localhost';
const port = Number(process.env.BROKER_E2E_PORT || 3101);
const baseUrl = `http://${host}:${port}`;

if (!evidenceRoot.startsWith(`${permittedEvidenceRoot}${sep}`)) {
  throw new Error(`QA_OUTPUT debe estar dentro de ${permittedEvidenceRoot}.`);
}

mkdirSync(evidenceRoot, { recursive: true });

function execute(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} terminó con código ${code ?? 'sin código'}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

async function isReady() {
  try {
    const response = await fetch(`${baseUrl}/realty?view=operations`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    if (server.exitCode !== null) throw new Error('Next finalizó antes de que la web estuviera disponible.');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`La web no respondió en ${baseUrl} dentro de 45 segundos.`);
}

let server = null;
try {
  if (await isReady()) {
    console.log(`QA Broker OS usará la web ya disponible en ${baseUrl}.`);
  } else {
    console.log(`Iniciando web temporal para QA Broker OS en ${baseUrl}...`);
    server = spawn(process.execPath, [
      join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev', '-H', host, '-p', String(port)
    ], {
      cwd: frontendRoot,
      env: { ...process.env },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    await waitForServer(server);
  }

  const testEnvironment = {
    ...process.env,
    QA_OUTPUT: evidenceRoot,
    BROKER_WEB_URL: baseUrl,
    PLAYWRIGHT_TIMEOUT_MS: process.env.PLAYWRIGHT_TIMEOUT_MS || '10000'
  };
  await execute(process.execPath, ['test/broker-prospects.browser.cjs'], { cwd: frontendRoot, env: testEnvironment });
  await execute(process.execPath, ['test/broker-web-journey.browser.cjs'], { cwd: frontendRoot, env: testEnvironment });
  await execute(process.execPath, ['test/broker-governance.browser.cjs'], { cwd: frontendRoot, env: testEnvironment });
  console.log(`QA Broker OS finalizada. Evidencia disponible en ${evidenceRoot}`);
} finally {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
}
