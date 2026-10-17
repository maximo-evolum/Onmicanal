/** Archivo: Ejecuta una línea base segura, repetible e idempotente para Broker OS. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brokerQaEnvironment } from './lib/broker-qa-environment.mjs';

const mode = process.argv[2];
const root = fileURLToPath(new URL('../', import.meta.url));
const prismaConfig = 'scripts/prisma-broker-qa.config.ts';
const preload = pathToFileURL(fileURLToPath(new URL('./lib/broker-qa-preload.mjs', import.meta.url))).href;

const commands = {
  generate: ['node_modules/prisma/build/index.js', 'generate', '--config', prismaConfig],
  migrate: ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', prismaConfig],
  status: ['node_modules/prisma/build/index.js', 'migrate', 'status', '--config', prismaConfig],
  seed: ['--import', preload, 'scripts/seed-realty-demo-properties.mjs'],
  verify: ['--import', preload, 'scripts/seed-realty-demo-properties.mjs', '--verify']
};

function run(label, env) {
  const args = commands[label];
  if (!args) throw new Error(`Comando QA desconocido: ${label}.`);
  console.log(`Broker QA: ${label}; solo evolum_broker_test local, sin secretos externos.`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 180_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Broker QA ${label} terminó con código ${result.status ?? 'sin código'}.`);
}

try {
  if (!['generate', 'migrate', 'status', 'seed', 'verify', 'all'].includes(mode)) {
    throw new Error('Usa generate, migrate, status, seed, verify o all. No hay reset ni db push automático.');
  }
  const env = brokerQaEnvironment();
  const sequence = mode === 'all'
    ? ['generate', 'migrate', 'status', 'seed', 'verify', 'seed', 'verify']
    : [mode];
  for (const step of sequence) run(step, env);
  if (mode === 'all') console.log('Broker QA completa: migración, verificación y doble seed idempotente aprobados.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
