import { fileURLToPath } from 'node:url';

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function qaEnvironment(input = process.env, { requireRedis = true } = {}) {
  if (input.NODE_ENV === "production") throw new Error("Las pruebas de BD no pueden ejecutarse en producción.");
  if (input.CONFIRM_FINANCE_QA !== "YES") throw new Error("Define CONFIRM_FINANCE_QA=YES para autorizar escrituras de prueba aisladas.");
  let database;
  try { database = new URL(input.QA_DATABASE_URL); } catch { throw new Error("Falta QA_DATABASE_URL de la base local de pruebas."); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !LOCAL_HOSTS.has(database.hostname)
    || database.pathname !== '/evolum_finance_test' || decodeURIComponent(database.username) !== 'evolum_test'
    || !['55432', '55433'].includes(database.port) || database.hash) {
    throw new Error("Solo se permite evolum_test en evolum_finance_test, localhost:55432 o 55433. Nunca uses la URL productiva.");
  }
  for (const [key, value] of database.searchParams) {
    if (key !== 'schema' || value !== 'public') throw new Error("QA_DATABASE_URL no admite opciones adicionales ni otro esquema.");
  }
  let redis;
  if (input.QA_REDIS_URL) {
    try { redis = new URL(input.QA_REDIS_URL); } catch { throw new Error("QA_REDIS_URL inválida."); }
    if (redis.protocol !== 'redis:' || !LOCAL_HOSTS.has(redis.hostname) || redis.port !== '56379'
      || !['', '/', '/0'].includes(redis.pathname) || redis.search || redis.hash) throw new Error("Redis QA debe ser local, puerto 56379 y base 0.");
  } else if (requireRedis) throw new Error("Falta QA_REDIS_URL. No se declara Redis aprobado sin probarlo.");
  // Do not inherit production provider credentials, job switches, proxy URLs,
  // DATABASE_URL, or REDIS_URL from the developer's terminal or .env.
  const env = Object.fromEntries(Object.entries(input).filter(([key]) =>
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir|home|userprofile|localappdata|appdata|programfiles|programfiles\(x86\)|os|node_test_context)$/i.test(key)));
  return {
    ...env, NODE_ENV: 'test', DATABASE_URL: database.href, REDIS_URL: redis?.href || '',
    QA_DATABASE_URL: database.href, QA_REDIS_URL: redis?.href || '', CONFIRM_FINANCE_QA: 'YES',
    DOTENV_CONFIG_PATH: fileURLToPath(new URL('./.qa-no-env', import.meta.url)),
    JWT_SECRET: 'finance_qa_only_not_for_production_minimum_32_chars',
    ENABLE_AUTOMATION: 'false', FINANCE_NUBOX_SYNC_ENABLED: 'false',
    REDIS_CONNECT_TIMEOUT_MS: '1000'
  };
}
