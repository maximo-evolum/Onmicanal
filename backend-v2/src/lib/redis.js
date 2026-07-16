import { createClient } from "redis";

let client = null;
let connecting = null;

export async function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client?.isOpen) return client;
  if (!client) {
    client = createClient({ url });
    client.on("error", (error) => console.warn("[REDIS_UNAVAILABLE]", error.message));
  }
  if (!connecting) connecting = client.connect().catch(() => null).finally(() => { connecting = null; });
  await connecting;
  return client.isOpen ? client : null;
}
