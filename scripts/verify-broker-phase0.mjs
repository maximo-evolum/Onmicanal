/** Archivo: Ejecuta la línea base de calidad de Broker OS sin escribir en producción. */
import { spawnSync } from 'node:child_process';

// npm_execpath existe cuando este script se invoca desde npm y evita el EINVAL de npm.cmd en Windows.
const npmCli = process.env.npm_execpath;
const npm = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const withQaDatabase = process.argv.includes('--qa-database');

function run(args) {
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  console.log(`\n> npm ${args.join(' ')}`);
  const result = spawnSync(npm, commandArgs, { stdio: 'inherit', windowsHide: true, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Falló: npm ${args.join(' ')}`);
}

try {
  if (withQaDatabase) run(['--prefix', 'backend-v2', 'run', 'qa:broker:all']);
  else console.log('La base aislada se omite. Para migrar, seedear y verificar Broker OS localmente usa: npm run broker:verify -- --qa-database');
  run(['--prefix', 'backend-v2', 'run', 'test:broker']);
  run(['--prefix', 'frontend', 'run', 'test:broker']);
  run(['--prefix', 'frontend', 'run', 'build']);
  run(['--prefix', 'frontend', 'run', 'test:broker:e2e']);
  console.log('\nLínea base de Broker OS aprobada. La evidencia E2E queda fuera del repositorio.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
