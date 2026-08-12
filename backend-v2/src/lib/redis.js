import { createClient } from "redis";
import crypto from "crypto";

let client = null;
let connecting = null;

const connectTimeoutMs = Math.max(500, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500));

export async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client?.isOpen) return client;
  if (!client) {
    // Redis es opcional: una URL rota o un DNS no disponible no debe dejar
    // bloqueado el healthcheck ni impedir un deployment sano.
    client = createClient({
      url,
      socket: {
        connectTimeout: connectTimeoutMs,
        reconnectStrategy: false
      }
    });
    client.on("error", (error) => console.warn("[REDIS_UNAVAILABLE]", error.message));
  }
  if (!connecting) connecting = client.connect().catch(() => null).finally(() => { connecting = null; });
  await connecting;
  return client.isOpen ? client : null;
}

/**
 * Ejecuta una tarea una sola vez entre las réplicas activas.
 *
 * El sistema sigue funcionando sin Redis (por ejemplo, en desarrollo), pero
 * cuando Redis está disponible evita que un botón manual y el planificador
 * sincronicen el mismo proveedor en paralelo.
 */
export async function withDistributedLock(key, { ttlMs = 120_000 } = {}, task) {
  const redis = await getRedisClient();
  if (!redis) return task({ acquired: true, coordinated: false });

  const token = crypto.randomUUID();
  const lockKey = `evolum:lock:${String(key || "operation")}`;
  const acquired = await redis.set(lockKey, token, { NX: true, PX: Math.max(1_000, Number(ttlMs) || 120_000) });
  if (!acquired) return { acquired: false, coordinated: true, skipped: "already_running" };

  try {
    return await task({ acquired: true, coordinated: true });
  } finally {
    // Solo libera el candado que pertenece a esta ejecución. Si el TTL venció
    // y otro proceso adquirió uno nuevo, no debemos borrar el suyo.
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      { keys: [lockKey], arguments: [token] }
    ).catch(() => null);
  }
}
