import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AdminTenant,
  Booking,
  Campaign,
  Conversation,
  CrmOperationalDashboard,
  Message,
  PaymentMetrics,
  TenantModulesResponse
} from "../types";

export const API_BASE_URL = "https://onmicanal-backend-v2.up.railway.app/api";
const TOKEN_KEY = "evolum_mobile_token";
const SESSION_KEY = "evolum_mobile_session";

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
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(SESSION_KEY)]);
}

async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const url = `${API_BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {})
      }
    });
  } catch {
    throw new Error(`No se pudo conectar con ${API_BASE_URL}. Revisa internet, VPN/DNS privado o vuelve a escanear el QR de Expo.`);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data?.error || `Error ${response.status}`;
    throw new Error(`${message} (${response.status} en ${path})`);
  }

  return response.json();
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
  const data = await request<any>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  await saveMobileSession(data, data.token);
  return data;
}

export async function getMe() {
  return request<any>("/auth/me");
}

export async function getMyModules(): Promise<TenantModulesResponse> {
  return request<TenantModulesResponse>("/modules/me");
}

export async function getCrmOperationalDashboard(): Promise<CrmOperationalDashboard> {
  return request<CrmOperationalDashboard>("/crm/operational");
}

export async function getConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/conversations");
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

export async function sendManualMessage(conversationId: string, content: string): Promise<Message> {
  return request<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

export async function takeConversation(conversationId: string, agentId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/take`, {
    method: "POST",
    body: JSON.stringify({ agentId })
  });
}

export async function releaseConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/release`, { method: "POST" });
}

export async function resolveConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/resolve`, { method: "POST" });
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
  });
}

export async function getCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>("/campaigns");
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

export async function getAdminTenants(): Promise<AdminTenant[]> {
  return request<AdminTenant[]>("/admin/tenants");
}

export async function updateAdminTenantModules(tenantId: string, modules: string[]) {
  return request<{ tenant: AdminTenant; modules: string[] }>(`/admin/tenants/${tenantId}/modules`, {
    method: "PATCH",
    body: JSON.stringify({ modules })
  });
}
