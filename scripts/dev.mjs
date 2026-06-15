import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';

function run(name, cwd, command, args) {
  const child = spawn(command, args, {
    cwd,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  const prefix = `[${name}] `;
  child.stdout.on('data', (data) => process.stdout.write(prefix + data.toString().replace(/\n/g, `\n${prefix}`)));
  child.stderr.on('data', (data) => process.stderr.write(prefix + data.toString().replace(/\n/g, `\n${prefix}`)));
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${prefix}proceso terminado con código ${code}`);
  });
  return child;
}

const npm = isWin ? 'npm.cmd' : 'npm';
const backend = run('backend', 'backend-v2', npm, ['run', 'dev']);
const frontend = run('frontend', 'frontend', npm, ['run', 'dev']);

function shutdown() {
  backend.kill('SIGTERM');
  frontend.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
