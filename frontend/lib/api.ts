import { AgentSession, Campaign, Conversation, Lead, LeadMetrics, Message, TenantSession } from "./types";
import { API_BASE_URL, TOKEN_COOKIE, TOKEN_STORAGE_KEY, SESSION_STORAGE_KEY } from "./constants";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthToken() {
  if (typeof window === "undefined") return getCookie(TOKEN_COOKIE);

  return (
    getCookie(TOKEN_COOKIE) ||
    window.localStorage.getItem(TOKEN_STORAGE_KEY) ||
    window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
    window.localStorage.getItem("token") ||
    window.localStorage.getItem("auth_token") ||
    window.localStorage.getItem("jwt")
  );
}

export function getStoredApiSession() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildHeaders(init?: RequestInit) {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers || {})
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init),
    cache: "no-store"
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {}
    }

    if (response.status === 401) {
      message = message || "Tu sesión expiró. Cierra sesión e inicia nuevamente.";
    }

    if (response.status === 403) {
      const token = getAuthToken();
      const session = getStoredApiSession();
      message = message || "No tienes acceso o tu sesión no está enviando autorización.";
      console.warn("[API_403]", {
        path,
        hasToken: Boolean(token),
        tokenPreview: token ? `${token.slice(0, 12)}...` : null,
        sessionRole: session?.role,
        tenantId: session?.tenantId
      });
    }

    throw new Error(message);
  }

  return response.json();
}

export async function getWorkspaceUsers(): Promise<AgentSession[]> {
  return request<AgentSession[]>("/workspace-users");
}

export async function loginWithEmail(email: string, password?: string): Promise<{ token: string; user: AgentSession; tenant?: TenantSession }> {
  return request<{ token: string; user: AgentSession; tenant?: TenantSession }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function registerAccount(input: {
  type: "PERSONAL" | "BUSINESS";
  companyName?: string;
  name: string;
  email: string;
  password: string;
  industry?: string;
}): Promise<{ token: string; user: AgentSession; tenant: TenantSession }> {
  return request<{ token: string; user: AgentSession; tenant: TenantSession }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getMe(): Promise<{ user: AgentSession; tenant: TenantSession }> {
  return request<{ user: AgentSession; tenant: TenantSession }>("/auth/me");
}

export async function getConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/conversations");
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

export async function takeConversation(conversationId: string, agentId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/take`, {
    method: "POST",
    body: JSON.stringify({ agentId })
  });
}

export async function releaseConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/release`, {
    method: "POST"
  });
}

export async function resolveConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/resolve`, {
    method: "POST"
  });
}

export async function deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/conversations/${conversationId}`, {
    method: "DELETE"
  });
}

export async function sendManualMessage(conversationId: string, content: string): Promise<Message> {
  // Endpoint principal nuevo: queda ligado a la conversación y evita 404 por rutas legacy.
  try {
    return await request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
  } catch (error) {
    // Fallback para deployments antiguos que todavía tengan la ruta legacy.
    return request<Message>(`/messages/send`, {
      method: "POST",
      body: JSON.stringify({ conversationId, content })
    });
  }
}

export type SimulateLeadResult = { conversationId?: string; conversation?: Conversation; ok?: boolean };

export async function simulateLeadUtf8(message?: string, tenantSlug?: string): Promise<SimulateLeadResult> {
  const phone = `569${Math.floor(10000000 + Math.random() * 89999999)}`;
  return request<SimulateLeadResult>("/dev/simulate-inbound", {
    method: "POST",
    body: JSON.stringify({
      channel: "whatsapp",
      from: phone,
      message: message?.trim() || "Hola, quiero cotizar una parrillada para 30 personas en Maipú",
      tenantSlug
    })
  });
}

export type BotLabResult = {
  reply: string;
  debug: {
    channel: string;
    matchedRule: string | null;
    usedAI: boolean;
    intent: string;
    entities: {
      commune: string | null;
      budget: number | null;
      interest: string | null;
      propertyType: string | null;
      urgency: string | null;
    };
    priority: {
      score: number;
      label: "high" | "medium" | "low";
    };
    confidence: number;
    suggestedNextAction: string;
    reasonSummary: string;
  };
};

export async function testBot(message: string, channel: string, tenantSlug?: string): Promise<BotLabResult> {
  return request<BotLabResult>(`/dev/test-bot`, {
    method: "POST",
    body: JSON.stringify({ message, channel, tenantSlug })
  });
}


export async function getLead(conversationId: string): Promise<Lead> {
  return request<Lead>(`/leads/${conversationId}`);
}

export async function updateLeadApi(
  conversationId: string,
  data: Partial<Lead>
): Promise<Lead> {
  return request<Lead>(`/leads/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify(data)
  });
}


export async function getLeads(): Promise<Lead[]> {
  return request<Lead[]>("/leads");
}

export async function getLeadMetrics(): Promise<LeadMetrics> {
  return request<LeadMetrics>("/leads/metrics");
}

export async function getCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>("/campaigns");
}

export async function createCampaign(input: { name: string; segment?: string; template: string; scheduledAt?: string | null }): Promise<Campaign> {
  return request<Campaign>("/campaigns", {
    method: "POST",
    body: JSON.stringify(input)
  });
}


export type CampaignPlatform = "instagram" | "facebook" | "whatsapp";

export type CampaignVariant = {
  id?: string;
  title: string;
  caption: string;
  text?: string;
  hashtags: string;
  cta?: string;
  image?: string;
  imageUrl?: string;
  imagePrompt?: string;
  platforms?: CampaignPlatform[];
  generationStage?: "copy" | "complete";
};

export type CampaignJobStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export type CampaignJob = {
  id: string;
  kind?: string;
  status: CampaignJobStatus;
  progress?: number;
  message?: string;
  result?: CampaignProResult | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CampaignProResult = {
  status?: string;
  async?: boolean;
  jobId?: string;
  job?: CampaignJob;
  platforms?: CampaignPlatform[];
  campaign?: Campaign;
  variants: CampaignVariant[];
};


export async function generateCampaignCopy(input: {
  product: string;
  idea?: string;
  visualTitle?: string;
  caption?: string;
  cta?: string;
  platforms?: CampaignPlatform[];
  platform?: string;
  price?: string;
  target?: string;
  description?: string;
  category?: string;
  tone?: string;
  variantCount?: number;
  quickMode?: boolean;
}): Promise<CampaignProResult> {
  return request<CampaignProResult>("/campaigns/generate-copy", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function generateCampaignImages(input: {
  campaignId?: string;
  product: string;
  idea?: string;
  visualTitle?: string;
  caption?: string;
  cta?: string;
  platforms?: CampaignPlatform[];
  platform?: string;
  variants?: CampaignVariant[];
  variantCount?: number;
  quickMode?: boolean;
  previewOnly?: boolean;
}): Promise<CampaignProResult> {
  return request<CampaignProResult>("/campaigns/generate-images", {
    method: "POST",
    body: JSON.stringify(input)
  });
}


export async function getCampaignJob(jobId: string): Promise<CampaignJob> {
  return request<CampaignJob>(`/campaigns/job/${jobId}`);
}

export async function generateCampaignPro(input: {
  product: string;
  idea?: string;
  visualTitle?: string;
  caption?: string;
  cta?: string;
  platforms?: CampaignPlatform[];
  platform?: string;
  price?: string;
  target?: string;
  description?: string;
  category?: string;
  tone?: string;
  variantCount?: number;
  quickMode?: boolean;
}): Promise<CampaignProResult> {
  return request<CampaignProResult>("/campaigns/generate-pro", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function publishCampaign(input: {
  campaignId?: string;
  product?: string;
  idea?: string;
  visualTitle?: string;
  caption?: string;
  cta?: string;
  platforms: CampaignPlatform[];
  selectedVariant: CampaignVariant;
  variants?: CampaignVariant[];
  whatsappRecipients?: string[];
}): Promise<{ campaign: Campaign; results: Array<{ platform: string; status: string; note?: string; error?: string; data?: unknown }> }> {
  return request<{ campaign: Campaign; results: Array<{ platform: string; status: string; note?: string; error?: string; data?: unknown }> }>("/campaigns/publish", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type SalesDashboard = {
  revenue: { total: number; month: number; week: number };
  bookings: {
    total: number;
    confirmed: number;
    pending: number;
    upcoming: Array<{
      id: string;
      date: string;
      guests: number;
      location: string | null;
      total: number;
      status: string;
      name?: string | null;
    }>;
  };
  leads: { total: number; hot: number; closeRate: number };
  ai: { hot: number; warm: number; low: number; handoffRequired: number; averageCloseScore: number };
};

export async function getSalesDashboard(): Promise<SalesDashboard> {
  return request<SalesDashboard>("/dashboard/sales");
}

export type TenantModulesResponse = {
  tenantId: string;
  plan: string;
  modules: string[];
  subscription?: unknown;
};

export async function getMyModules(): Promise<TenantModulesResponse> {
  return request<TenantModulesResponse>("/modules/me");
}

export async function getModuleCatalog(): Promise<{ modules: Record<string, string>; plans: Record<string, unknown> }> {
  return request<{ modules: Record<string, string>; plans: Record<string, unknown> }>("/modules/catalog");
}

export type TenantAiProfile = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  industry?: string | null;
  basePersona?: string | null;
  tone?: string | null;
  objective?: string | null;
  responseStyle?: string | null;
  businessRules?: string[] | Record<string, unknown> | null;
  knowledge?: Record<string, unknown> | null;
  isActive: boolean;
};

export type TenantChannelConfig = {
  id: string;
  tenantId: string;
  channel: "whatsapp" | "instagram" | string;
  label?: string | null;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  externalAccountId?: string | null;
  accessToken?: string | null;
  verifyToken?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
};

export type TenantOnboardingImport = {
  id: string;
  tenantId: string;
  sourceType: string;
  fileNames?: unknown;
  status: string;
  createdAt: string;
  appliedAt?: string | null;
};

export type AdminTenant = {
  id: string;
  name: string;
  slug: string;
  type?: string;
  industry?: string | null;
  plan?: string | null;
  businessPrompt?: string | null;
  onboardingCompleted?: boolean;
  whatsappPhoneNumberId?: string | null;
  instagramBusinessAccountId?: string | null;
  createdAt: string;
  workspaceUsers?: Array<{ id: string; name: string; email: string; role: string; isActive: boolean }>;
  tenantModules?: Array<{ id: string; module: string; enabled: boolean; source?: string }>;
  subscriptions?: Array<{ id: string; planCode: string; status: string; startedAt: string; endsAt?: string | null }>;
  aiProfiles?: TenantAiProfile[];
  channelConfigs?: TenantChannelConfig[];
  onboardingImports?: TenantOnboardingImport[];
};

export async function getAdminTenants(): Promise<AdminTenant[]> {
  return request<AdminTenant[]>("/admin/tenants");
}

export async function updateTenantPlan(tenantId: string, plan: string): Promise<{ tenant: AdminTenant; modules: string[] }> {
  return request<{ tenant: AdminTenant; modules: string[] }>(`/admin/tenants/${tenantId}/plan`, {
    method: "PATCH",
    body: JSON.stringify({ plan })
  });
}

export type CreateAdminTenantInput = {
  name: string;
  slug?: string;
  type?: string;
  industry?: string;
  plan: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword?: string;
  whatsappPhoneNumberId?: string;
  instagramBusinessAccountId?: string;
  metaAccessToken?: string;
  metaAppSecret?: string;
  verifyToken?: string;
  whatsappBusinessAccountId?: string;
  whatsappDisplayNumber?: string;
  instagramPageId?: string;
};

export type UpdateAdminTenantInput = Partial<Pick<AdminTenant, "name" | "slug" | "type" | "industry" | "onboardingCompleted">> & {
  businessPrompt?: string | null;
  whatsappPhoneNumberId?: string | null;
  instagramBusinessAccountId?: string | null;
};

export async function createAdminTenant(input: CreateAdminTenantInput): Promise<AdminTenant> {
  return request<AdminTenant>("/admin/tenants", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateAdminTenant(tenantId: string, input: UpdateAdminTenantInput): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/tenants/${tenantId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateAdminTenantChannelConfig(
  tenantId: string,
  channel: "whatsapp" | "instagram",
  input: {
    label?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    externalAccountId?: string;
    displayNumber?: string;
    accessToken?: string;
    verifyToken?: string;
    metadata?: Record<string, unknown> | null;
    isActive?: boolean;
  }
): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/tenants/${tenantId}/channel-configs/${channel}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function updateAdminTenantAiProfile(
  tenantId: string,
  input: {
    code?: string;
    name?: string;
    industry?: string;
    basePersona?: string;
    tone?: string;
    objective?: string;
    responseStyle?: string;
    businessRules?: string[];
    knowledge?: Record<string, unknown> | null;
    isActive?: boolean;
  }
): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/tenants/${tenantId}/ai-profile`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function updateAdminTenantModules(tenantId: string, modules: string[]): Promise<{ tenant: AdminTenant; modules: string[] }> {
  return request<{ tenant: AdminTenant; modules: string[] }>(`/admin/tenants/${tenantId}/modules`, {
    method: "PATCH",
    body: JSON.stringify({ modules })
  });
}

export async function createAdminTenantUser(
  tenantId: string,
  input: { name: string; email: string; role: string; password?: string; isActive?: boolean }
): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/tenants/${tenantId}/users`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateAdminUser(
  userId: string,
  input: { name?: string; role?: string; password?: string; isActive?: boolean }
): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}


export type SaasOverview = {
  tenant: TenantSession & { onboardingCompleted?: boolean; aiSettings?: Record<string, unknown> | null };
  plan: { code: string; name: string; description?: string; priceMonthly: number; currency: string; limits?: Record<string, unknown>; modules?: string[] };
  modules: string[];
  usage: {
    messages: number;
    aiReplies: number;
    toolCalls: number;
    cost: number;
    usagePercent: number;
    limits: { messagesMonthly?: number | null; users?: number | null; planName?: string };
  };
  onboarding: { completed: number; total: number; completedPercent: number; steps: Record<string, boolean> };
  analytics: Record<string, number>;
  recommendations: string[];
  aiSettings: AISettings;
};

export type AISettings = {
  tone: string;
  personality: string;
  objective: string;
  responseStyle: string;
  forbidden: string;
  businessRules: string[];
};

export type SaasAnalytics = {
  usage: SaasOverview["usage"];
  kpis: Record<string, number>;
  recommendations: string[];
  recentConversations: Conversation[];
  outcomes: Array<{ id: string; outcome: string; reason?: string | null; closeScore?: number | null; createdAt: string }>;
};

export async function getSaasOverview(): Promise<SaasOverview> {
  return request<SaasOverview>("/saas/overview");
}

export async function getSaasAnalytics(): Promise<SaasAnalytics> {
  return request<SaasAnalytics>("/saas/analytics");
}

export async function getAIConfig(): Promise<{ settings: AISettings }> {
  return request<{ settings: AISettings }>("/saas/ai-config");
}

export async function updateAIConfig(input: Partial<AISettings>): Promise<{ settings: AISettings }> {
  return request<{ settings: AISettings }>("/saas/ai-config", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getOnboardingStatus(): Promise<{ completed: number; total: number; completedPercent: number; steps: Record<string, boolean> }> {
  return request<{ completed: number; total: number; completedPercent: number; steps: Record<string, boolean> }>("/saas/onboarding");
}

export async function updateOnboardingStatus(input: Record<string, boolean>): Promise<unknown> {
  return request<unknown>("/saas/onboarding", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getTeamManagement(): Promise<{ users: Array<{ id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }> }> {
  return request<{ users: Array<{ id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }> }>("/saas/team");
}

export async function getAuditLogs(): Promise<{ logs: Array<{ id: string; action: string; entity?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }> }> {
  return request<{ logs: Array<{ id: string; action: string; entity?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }> }>("/saas/audit");
}


export async function createTeamUser(input: { name: string; email: string; role?: string; password?: string }) {
  return request<{ user: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string } }>("/saas/team", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteTeamUser(userId: string) {
  return request<{ ok: boolean; deletedUserId: string }>(`/saas/team/${userId}`, {
    method: "DELETE"
  });
}

export async function deleteTenant(id: string) {
  return request(`/admin/tenants/${id}`, {
    method: "DELETE"
  });
}


export async function deleteAdminTenant(tenantId: string): Promise<{ ok: boolean; deletedTenantId: string }> {
  return request<{ ok: boolean; deletedTenantId: string }>(`/admin/tenants/${tenantId}`, {
    method: "DELETE"
  });
}

export async function deleteAdminUser(userId: string): Promise<AdminTenant> {
  return request<AdminTenant>(`/admin/users/${userId}`, {
    method: "DELETE"
  });
}


export type OnboardingExtraction = {
  business?: { name?: string | null; industry?: string | null; tone?: string | null; objective?: string | null; description?: string | null };
  products?: Array<{ name: string; description?: string | null; price?: number; stock?: number; category?: string | null; location?: string | null; attributes?: Record<string, unknown> }>;
  faqs?: Array<{ question: string; answer: string }>;
  policies?: string[];
  suggestedTone?: string;
  summary?: string;
  warnings?: string[];
  usedAI?: boolean;
  fileResults?: Array<{ name: string; size: number; textChars: number }>;
};

export async function getOnboardingKnowledge(): Promise<any> {
  return request<any>("/onboarding/knowledge");
}

export async function saveOnboardingProfile(input: Record<string, string>): Promise<any> {
  return request<any>("/onboarding/profile", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadOnboardingFiles(input: { files: File[]; businessName?: string; industry?: string; description?: string; tone?: string; objective?: string; restrictions?: string }): Promise<{ importId: string; extraction: OnboardingExtraction }> {
  const token = getAuthToken();
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  for (const [key, value] of Object.entries(input)) {
    if (key !== "files" && value) form.append(key, String(value));
  }

  const response = await fetch(`${API_BASE_URL}/onboarding/extract`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    cache: "no-store"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "No se pudo extraer información");
  }
  return response.json();
}

export async function applyOnboardingExtraction(input: { importId?: string; extraction?: OnboardingExtraction; replaceProducts?: boolean; replaceFaqs?: boolean }): Promise<any> {
  return request<any>("/onboarding/apply", {
    method: "POST",
    body: JSON.stringify(input)
  });
}


export async function uploadAdminTenantOnboardingFiles(input: {
  tenantId: string;
  files: File[];
  businessName?: string;
  industry?: string;
  description?: string;
  tone?: string;
  objective?: string;
  restrictions?: string;
}): Promise<{ importId: string; extraction: OnboardingExtraction }> {
  const token = getAuthToken();
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  for (const [key, value] of Object.entries(input)) {
    if (key !== "files" && key !== "tenantId" && value) form.append(key, String(value));
  }

  const response = await fetch(`${API_BASE_URL}/admin/tenants/${input.tenantId}/onboarding/extract`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    cache: "no-store"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "No se pudo extraer información para el cliente");
  }
  return response.json();
}

export async function applyAdminTenantOnboardingExtraction(input: {
  tenantId: string;
  importId?: string;
  extraction?: OnboardingExtraction;
  replaceProducts?: boolean;
  replaceFaqs?: boolean;
}): Promise<{ tenant?: AdminTenant; createdProducts?: number; createdFaqs?: number; policiesCount?: number }> {
  return request<{ tenant?: AdminTenant; createdProducts?: number; createdFaqs?: number; policiesCount?: number }>(`/admin/tenants/${input.tenantId}/onboarding/apply`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
