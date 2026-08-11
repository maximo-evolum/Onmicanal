import { API_BASE_URL } from "./constants";

const STORAGE_KEY = "evolum_web_offline_queue_v1";

type QueuedMutation = {
  id: string;
  path: string;
  method: string;
  body?: string;
  createdAt: string;
};

export class OfflineQueuedError extends Error {
  constructor() {
    super("Sin conexión: esta acción quedó guardada y se subirá cuando presiones Sincronizar.");
    this.name = "OfflineQueuedError";
  }
}

function browserReady() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readQueue(): QueuedMutation[] {
  if (!browserReady()) return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const queue = value ? JSON.parse(value) : [];
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]) {
  if (!browserReady()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    window.dispatchEvent(new Event("evolum-offline-queue-change"));
  } catch {
    // La cola puede no estar disponible en navegadores muy restringidos.
  }
}

export function canQueueOfflineMutation(path: string, init?: RequestInit) {
  const method = String(init?.method || "GET").toUpperCase();
  const body = init?.body;
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method)
    && !path.startsWith("/auth/")
    && (body === undefined || typeof body === "string");
}

export function queueOfflineMutation(path: string, init?: RequestInit) {
  if (!browserReady() || !canQueueOfflineMutation(path, init)) return false;
  const queue = readQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    path,
    method: String(init?.method || "POST").toUpperCase(),
    body: typeof init?.body === "string" ? init.body : undefined,
    createdAt: new Date().toISOString(),
  });
  writeQueue(queue);
  return true;
}

export function getOfflineQueueCount() {
  return readQueue().length;
}

export async function syncOfflineQueue() {
  const queue = readQueue();
  if (!queue.length) return { synced: 0, pending: 0 };
  const pending: QueuedMutation[] = [];
  let synced = 0;
  for (const item of queue) {
    try {
      const response = await fetch(`${API_BASE_URL}${item.path}`, {
        method: item.method,
        headers: item.body ? { "Content-Type": "application/json" } : undefined,
        body: item.body,
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) pending.push(item);
      else synced += 1;
    } catch {
      pending.push(item);
    }
  }
  writeQueue(pending);
  return { synced, pending: pending.length };
}
