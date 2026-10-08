import { qaEnvironment } from '../../scripts/lib/qa-environment.mjs';
import { blockDotEnvReads } from '../../scripts/lib/qa-runtime.mjs';
const env = qaEnvironment(process.env, { requireRedis: false });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
blockDotEnvReads();
const { prisma } = await import('../../src/lib/db.js');
const { analyzeBankImportJob } = await import('../../src/services/finance-import-jobs.service.js');
const [tenantId, id] = process.argv.slice(2);
try {
  const result = await analyzeBankImportJob(prisma, { tenantId, id, background: true, analyze: async () => {
    process.send({ type: 'claimed' });
    await new Promise(resolve => process.once('message', resolve));
    return { account: {}, sourceRows: [], marker: 'obsolete-child' };
  } });
  process.send({ type: 'result', revision: result.revision });
} catch (error) {
  process.send({ type: 'error', status: error.status || 500 });
} finally {
  await prisma.$disconnect();
  process.disconnect();
}
