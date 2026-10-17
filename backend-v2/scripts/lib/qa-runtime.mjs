/** Archivo: Automatiza una tarea operativa, de calidad o mantenimiento relacionada con qa runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

// El cliente generado de Prisma 6 lee .env de manera independiente de dotenv/config y
// DOTENV_CONFIG_PATH. Este límite exclusivo de pruebas también bloquea esa lectura implícita.
// No simula la base de datos, HTTP, lógica de aplicación ni datos financieros.
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
