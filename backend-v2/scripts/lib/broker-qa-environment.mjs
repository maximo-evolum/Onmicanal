/** Archivo: Protege la base aislada usada por las verificaciones de Broker OS. */
import { fileURLToPath } from 'node:url';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Construye un entorno mínimo para QA de Broker OS.
 * Rechaza por diseño cualquier URL remota, productiva o distinta de la base local dedicada.
 */
export function brokerQaEnvironment(input = process.env) {
  if (input.NODE_ENV === 'production') throw new Error('La QA de Broker OS no puede ejecutarse en producción.');
  if (input.CONFIRM_BROKER_QA !== 'YES') throw new Error('Define CONFIRM_BROKER_QA=YES para autorizar escrituras de prueba aisladas.');
  let database;
  try { database = new URL(input.QA_BROKER_DATABASE_URL); }
  catch { throw new Error('Falta QA_BROKER_DATABASE_URL de la base local aislada de Broker OS.'); }

  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !LOCAL_HOSTS.has(database.hostname)
    || database.pathname !== '/evolum_broker_test'
    || decodeURIComponent(database.username) !== 'evolum_test'
    || database.port !== '55434'
    || database.hash) {
    throw new Error('Solo se permite evolum_test en evolum_broker_test, localhost:55434. Nunca uses una URL productiva.');
  }
  for (const [key, value] of database.searchParams) {
    if (key !== 'schema' || value !== 'public') throw new Error('QA_BROKER_DATABASE_URL no admite opciones adicionales ni otro esquema.');
  }

  // No hereda secretos de proveedores, URLs productivas ni interruptores de automatización.
  const env = Object.fromEntries(Object.entries(input).filter(([key]) =>
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir|home|userprofile|localappdata|appdata|programfiles|programfiles\(x86\)|os|node_test_context)$/i.test(key)));
  return {
    ...env,
    NODE_ENV: 'test',
    DATABASE_URL: database.href,
    QA_BROKER_DATABASE_URL: database.href,
    CONFIRM_BROKER_QA: 'YES',
    DOTENV_CONFIG_PATH: fileURLToPath(new URL('./.qa-no-env', import.meta.url)),
    JWT_SECRET: 'broker_qa_only_not_for_production_minimum_32_chars',
    ENABLE_AUTOMATION: 'false',
    FINANCE_NUBOX_SYNC_ENABLED: 'false'
  };
}
