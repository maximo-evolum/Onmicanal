import { createClient } from "redis";

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
