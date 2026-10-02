import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qaEnvironment } from './lib/qa-environment.mjs';

const mode = process.argv[2];
const commands = {
  migrate: ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'scripts/prisma-qa.config.ts'],
  status: ['node_modules/prisma/build/index.js', 'migrate', 'status', '--config', 'scripts/prisma-qa.config.ts'],
  schema: ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code', '--config', 'scripts/prisma-qa.config.ts'],
  database: ['--test', 'integration/finance-database.integration.mjs'],
  permissions: ['--test', 'integration/finance-permissions.integration.mjs'],
  all: ['--test', 'integration/finance-database.integration.mjs', 'integration/finance-permissions.integration.mjs', 'integration/finance-redis.integration.mjs']
};
try {
  if (!commands[mode]) throw new Error('Usa migrate, status, schema, database, permissions o all. No hay reset ni db push automático.');
  const env = qaEnvironment(process.env, { requireRedis: mode === 'all' });
  console.log(`Finance QA: ${mode}; solo base local evolum_finance_test; sin credenciales externas.`);
  const result = spawnSync(process.execPath, commands[mode], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env,
    stdio: 'inherit', windowsHide: true, timeout: 180000
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
