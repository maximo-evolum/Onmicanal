import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

// Prisma 6's generated client reads .env independently of dotenv/config and
// DOTENV_CONFIG_PATH. This test-only boundary blocks that implicit read too.
// It does not mock database, HTTP, application logic, or financial data.
export function blockDotEnvReads() {
  const isEnv = value => {
    const filename = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
    return typeof filename === 'string' && /^\.env(?:\.|$)/i.test(path.basename(filename));
  };
  const denied = () => Object.assign(new Error('QA no permite leer archivos .env.'), { code: 'ENOENT', errno: -2 });
  const readSync = fs.readFileSync;
  const read = fs.readFile;
  const exists = fs.existsSync;
  const readPromise = fs.promises.readFile;
  fs.existsSync = (file, ...args) => !isEnv(file) && exists(file, ...args);
  fs.readFileSync = (file, ...args) => { if (isEnv(file)) throw denied(); return readSync(file, ...args); };
  fs.readFile = (file, ...args) => {
    if (!isEnv(file)) return read(file, ...args);
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw denied();
    queueMicrotask(() => callback(denied()));
  };
  fs.promises.readFile = async (file, ...args) => { if (isEnv(file)) throw denied(); return readPromise(file, ...args); };
  syncBuiltinESMExports();
}
