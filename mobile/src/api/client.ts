import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  AdminTenant,
  Booking,
  Campaign,
  Conversation,
  CrmOperationalDashboard,
  IndustryRecord,
  IndustryUser,
  Message,
  PaymentMetrics,
  RealtyIntelligence,
  TenantModulesResponse
} from "../types";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000/api";
const TOKEN_KEY = "evolum_mobile_token";
const SESSION_KEY = "evolum_mobile_session";
const CACHE_PREFIX = "evolum_mobile_cache_v1:";
const OFFLINE_QUEUE_KEY = "evolum_mobile_offline_queue_v1";
const REQUEST_TIMEOUT_MS = 15000;

type RequestOptions = {
  queueWhenOffline?: boolean;
  timeoutMs?: number;
};

type QueuedRequest = {
  id: string;
  path: string;
  method: string;
  body?: string;
  createdAt: string;
};

export type OfflineSyncResult = {
  synced: number;
  pending: number;
};

export type MobileNativeRelease = {
  platform: "android" | "ios";
  latestVersion: string;
  minimumVersion: string | null;
  downloadUrl: string;
  releaseNotes: string | null;
  publishedAt: string;
};

async function readCachedResponse<T>(path: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${path}`).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    await AsyncStorage.removeItem(`${CACHE_PREFIX}${path}`).catch(() => undefined);
    return null;
  }
}

async function cacheResponse(path: string, data: unknown) {
  await AsyncStorage.setItem(`${CACHE_PREFIX}${path}`, JSON.stringify(data)).catch(() => undefined);
}

async function getOfflineQueue(): Promise<QueuedRequest[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedRequest[] : [];
  } catch {
    return [];
  }
}

async function saveOfflineQueue(queue: QueuedRequest[]) {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

async function queueOfflineRequest(path: string, method: string, body?: BodyInit | null) {
  const queue = await getOfflineQueue();
  const item: QueuedRequest = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    method,
    body: typeof body === "string" ? body : undefined,
    createdAt: new Date().toISOString(),
  };
  await saveOfflineQueue([...queue, item]);
  return item;
}

export async function getOfflineQueueCount() {
  return (await getOfflineQueue()).length;
}

export async function syncOfflineQueue(): Promise<OfflineSyncResult> {
  const token = await getToken();
  const queue = await getOfflineQueue();
  if (!token || !queue.length) return { synced: 0, pending: queue.length };

  const remaining: QueuedRequest[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      const response = await fetch(`${API_BASE_URL}${item.path}`, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: item.body,
      });

      if (response.ok) {
        synced += 1;
      } else {
        // Un error de validación o permisos necesita revisión, pero no borra la acción del usuario.
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  await saveOfflineQueue(remaining);
  return { synced, pending: remaining.length };
}

async function clearOfflineData() {
  const keys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
  const offlineKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) || key === OFFLINE_QUEUE_KEY);
  if (offlineKeys.length) await AsyncStorage.multiRemove(offlineKeys).catch(() => undefined);
}

export async function saveMobileSession(data: unknown, token?: string) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(data));
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function getMobileSession<T = any>() {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearMobileSession() {
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(SESSION_KEY), clearOfflineData()]);
}

async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Consulta pública para saber si existe una actualización que cambie la parte
 * nativa. Es diferente de EAS Update, que actualiza JavaScript sin APK nueva.
 */
export async function getLatestMobileNativeRelease(platform: "android" | "ios") {
  const url = `${API_BASE_URL}/mobile/releases/latest?platform=${encodeURIComponent(platform)}`;
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 7_000);
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new Error(`No se pudo consultar la actualización (${response.status})`);
  return response.json() as Promise<MobileNativeRelease>;
}

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const url = `${API_BASE_URL}${path}`;
  const method = (init?.method || "GET").toUpperCase();
  const isRead = method === "GET";
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {})
      }
    }, options.timeoutMs);
  } catch {
    if (isRead) {
      const cached = await readCachedResponse<T>(path);
      if (cached !== null) return cached;
    }
    if (options.queueWhenOffline && !isRead) {
      const queued = await queueOfflineRequest(path, method, init?.body);
      return { id: queued.id, status: "PENDING_SYNC", offline: true } as T;
    }
    throw new Error(`No se pudo conectar con ${API_BASE_URL}. Revisa internet e intentalo nuevamente.`);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data?.error || `Error ${response.status}`;
    throw new Error(`${message} (${response.status} en ${path})`);
  }

  const data = await response.json();
  if (isRead) await cacheResponse(path, data);
  return data;
}

export async function checkApiHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Health ${response.status}`);
    return response.json();
  } catch {
    throw new Error(`Sin conexion desde el telefono hacia ${API_BASE_URL}`);
  }
}

export async function loginWithEmail(email: string, password?: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await request<any>("/auth/login", {
        method: "POST",
        headers: { "X-Auth-Client": "mobile" },
        body: JSON.stringify({ email, password })
      }, { timeoutMs: 25000 });
      await saveMobileSession(data, data.token);
      return data;
    } catch (error) {
      lastError = error;
      const isConnectionError = error instanceof Error && error.message.includes("No se pudo conectar");
      if (!isConnectionError || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No se pudo iniciar sesion.");
}

export async function getMe() {
  const data = await request<any>("/auth/me");
  await saveMobileSession(data);
  return data;
}

export async function getMyModules(): Promise<TenantModulesResponse> {
  return request<TenantModulesResponse>("/modules/me");
}

export async function registerMobilePushDevice(input: { expoPushToken: string; platform: string; preferences?: Record<string, boolean> }) {
  return request<{ id: string; registered: boolean }>("/mobile/push-devices/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function unregisterMobilePushDevice(expoPushToken: string) {
  return request<{ unregistered: boolean }>("/mobile/push-devices/unregister", {
    method: "POST",
    body: JSON.stringify({ expoPushToken })
  });
}

export async function getCrmOperationalDashboard(): Promise<CrmOperationalDashboard> {
  return request<CrmOperationalDashboard>("/crm/operational");
}

export async function getRealtyIntelligence(): Promise<RealtyIntelligence> {
  return request<RealtyIntelligence>("/realty/intelligence");
}

export async function getConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/conversations");
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

export async function sendManualMessage(conversationId: string, content: string): Promise<Message> {
  const body = JSON.stringify({
    conversationId,
    content,
    text: content,
    message: content
  });

  try {
    return await request<Message>("/messages/send", {
      method: "POST",
      body
    }, { queueWhenOffline: true });
  } catch (primaryError) {
    try {
      return await request<Message>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body
      }, { queueWhenOffline: true });
    } catch {
      throw primaryError;
    }
  }
}

export async function sendReengagementTemplate(conversationId: string): Promise<Message> {
  return request<Message>("/messages/reengage", {
    method: "POST",
    body: JSON.stringify({ conversationId })
  }, { queueWhenOffline: true });
}

export async function createCampaignDraft(payload: {
  name: string;
  segment?: string;
  product?: string;
  visualTitle?: string;
  idea?: string;
  caption?: string;
  cta?: string;
  platforms: string[];
  selectedVariant?: any;
  variants?: any[];
}): Promise<Campaign> {
  return request<Campaign>("/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { queueWhenOffline: true });
}

export async function takeConversation(conversationId: string, agentId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/take`, {
    method: "POST",
    body: JSON.stringify({ agentId })
  }, { queueWhenOffline: true });
}

export async function releaseConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/release`, { method: "POST" }, { queueWhenOffline: true });
}

export async function resolveConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/resolve`, { method: "POST" }, { queueWhenOffline: true });
}

export async function getBookings(): Promise<Booking[]> {
  return request<Booking[]>("/bookings");
}

export async function createBooking(payload: {
  conversationId?: string;
  name?: string;
  phone?: string;
  email?: string;
  date: string;
  guests: number;
  location?: string;
  total?: number;
  notes?: string;
}): Promise<Booking> {
  return request<Booking>("/bookings", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { queueWhenOffline: true });
}

export async function getCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>("/campaigns");
}

export async function getIndustryRecords(type?: string): Promise<IndustryRecord[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<IndustryRecord[]>(`/industry-records${query}`);
}

export async function createIndustryRecord(input: {
  recordType: string;
  title: string;
  status?: string;
  assignedToId?: string | null;
  data?: Record<string, unknown>;
}): Promise<IndustryRecord> {
  return request<IndustryRecord>("/industry-records", {
    method: "POST",
    body: JSON.stringify(input)
  }, { queueWhenOffline: true });
}

export async function updateIndustryRecord(id: string, input: {
  title?: string;
  status?: string;
  assignedToId?: string | null;
  data?: Record<string, unknown> | null;
}): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/industry-records/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  }, { queueWhenOffline: true });
}

export async function getIndustryUsers(): Promise<IndustryUser[]> {
  return request<IndustryUser[]>("/industry-records/users");
}

export async function getBalancedIndustryAssignments(input: {
  recordType: string;
  assigneeRole?: string;
}): Promise<{
  recordType: string;
  assigneeRole: string;
  assignments: Array<{ item: IndustryRecord; assignee: IndustryUser; order: number; mode: string }>;
}> {
  return request<{
    recordType: string;
    assigneeRole: string;
    assignments: Array<{ item: IndustryRecord; assignee: IndustryUser; order: number; mode: string }>;
  }>("/industry-records/assignments/balance", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function generateCampaignCopy(payload: {
  product: string;
  visualTitle: string;
  idea: string;
  caption?: string;
  cta?: string;
  platforms: string[];
}) {
  return request<any>("/campaigns/generate-copy", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function generateCampaignImages(payload: {
  campaignId?: string;
  product: string;
  visualTitle: string;
  idea: string;
  caption?: string;
  cta?: string;
  platforms: string[];
  variantCount?: number;
  quickMode?: boolean;
  imageSize?: string;
  variants?: any[];
}) {
  return request<any>("/campaigns/generate-images", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getCampaignJob(jobId: string) {
  return request<any>(`/campaigns/job/${jobId}`);
}

export async function publishCampaign(payload: {
  campaignId?: string;
  product: string;
  visualTitle: string;
  idea: string;
  caption: string;
  cta: string;
  platforms: string[];
  selectedVariant?: any;
  variants?: any[];
  whatsappRecipients?: string[];
}) {
  return request<any>("/campaigns/publish", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getPaymentsMetrics(): Promise<PaymentMetrics> {
  return request<PaymentMetrics>("/payments/metrics");
}

export async function downloadExecutiveReportPdf(destinationUri: string) {
  const token = await getToken();
  const result = await FileSystem.downloadAsync(`${API_BASE_URL}/reports/executive.pdf`, destinationUri, {
    headers: {
      Accept: "application/pdf",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`No se pudo descargar el reporte (${result.status})`);
  }

  return result.uri;
}

export async function getAdminTenants(): Promise<AdminTenant[]> {
  return request<AdminTenant[]>("/admin/tenants");
}

export async function updateAdminTenantModules(tenantId: string, modules: string[]) {
  return request<{ tenant: AdminTenant; modules: string[] }>(`/admin/tenants/${tenantId}/modules`, {
    method: "PATCH",
    body: JSON.stringify({ modules })
  }, { queueWhenOffline: true });
}
