import { AgentSession, Booking, BookingSlot, Campaign, Conversation, Lead, LeadMetrics, Message, TenantSession } from "./types";
import { API_BASE_URL, SESSION_STORAGE_KEY } from "./constants";

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
  return {
    "Content-Type": "application/json",
    ...(init?.headers || {})
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init),
    cache: "no-store",
    credentials: "include"
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
      const session = getStoredApiSession();
      message = message || "No tienes acceso o tu sesión no está enviando autorización.";
      console.warn("[API_403]", {
        path,
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

export async function loginWithEmail(email: string, password?: string): Promise<{ user: AgentSession; tenant?: TenantSession }> {
  return request<{ user: AgentSession; tenant?: TenantSession }>("/auth/login", {
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
}): Promise<{ user: AgentSession; tenant: TenantSession }> {
  return request<{ user: AgentSession; tenant: TenantSession }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getMe(): Promise<{ user: AgentSession; tenant: TenantSession }> {
  return request<{ user: AgentSession; tenant: TenantSession }>("/auth/me");
}

export async function updateMyProfile(input: {
  name: string;
  jobTitle?: string;
  avatarUrl?: string;
}): Promise<{ user: AgentSession; tenant: TenantSession }> {
  return request<{ user: AgentSession; tenant: TenantSession }>("/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export type ArchitectureSummary = {
  tenantId: string;
  generatedAt: string;
  principles: {
    metadataDriven: boolean;
    immutableCore: boolean;
    tenantScoped: boolean;
    audited: boolean;
  };
  layers: {
    experience: {
      tenant: {
        id: string;
        name: string;
        industry: string;
        plan: string;
      };
      modules: Array<{ module: string; enabled: boolean; source?: string }>;
      roles: string[];
    };
    businessCapabilities: Array<{ key: string; label: string; enabled: boolean; status: string }>;
    core: Array<{ key: string; label: string; status: string }>;
  };
  integrations: Array<{
    channel: string;
    label: string;
    enabled: boolean;
    connected: boolean;
    status: string;
    module: string;
  }>;
  continuity: {
    backup: Record<string, unknown>;
    replica: Record<string, unknown>;
    offline: {
      enabled: boolean;
      pending: number;
      failed: number;
      completed: number;
    };
  };
  counts: Record<string, number>;
};

export async function getArchitectureSummary(): Promise<ArchitectureSummary> {
  return request<ArchitectureSummary>("/architecture/summary");
}

export async function configureArchitectureIntegration(
  channel: string,
  input: {
    enabled?: boolean;
    connected?: boolean;
    credentials?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
) {
  return request(`/architecture/integrations/${encodeURIComponent(channel)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function getBackupArchitectureConfig() {
  return request("/architecture/backups/config");
}

export async function updateBackupArchitectureConfig(input: {
  provider?: string;
  region?: string;
  schedule?: string;
  retentionDays?: number;
  encryption?: string;
  replica?: Record<string, unknown>;
}) {
  return request("/architecture/backups/config", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function createBackupSnapshot(input?: { reason?: string }) {
  return request("/architecture/backups/snapshots", {
    method: "POST",
    body: JSON.stringify(input || {})
  });
}

export async function syncOfflineMutations(input: {
  clientId?: string;
  deviceId?: string;
  mutations: Array<{ entity: string; operation: string; payload?: Record<string, unknown>; createdAt?: string }>;
}) {
  return request("/architecture/offline/sync", {
    method: "POST",
    body: JSON.stringify(input)
  });
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

export async function getBookings(): Promise<Booking[]> {
  return request<Booking[]>("/bookings");
}

export async function getBookingSlots(date: string): Promise<{ date: string; slots: BookingSlot[] }> {
  return request<{ date: string; slots: BookingSlot[] }>(`/bookings/slots?date=${encodeURIComponent(date)}`);
}

export async function createBookingApi(input: {
  conversationId?: string | null;
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
    body: JSON.stringify(input)
  });
}

export async function updateBookingApi(id: string, input: Partial<Pick<Booking, "status" | "name" | "phone" | "email" | "date" | "guests" | "location" | "total" | "notes">>): Promise<Booking> {
  return request<Booking>(`/bookings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function markBookingPaymentReady(id: string): Promise<{ booking: Booking; message: string }> {
  return request<{ booking: Booking; message: string }>(`/bookings/${id}/payment-ready`, {
    method: "POST"
  });
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
  revenue: { total: number; month: number; week: number; estimated?: number };
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
  payments?: { count: number; total: number; paid: number; paidTotal: number; pending: number; pendingTotal: number; conversionRate: number };
  leads: { total: number; hot: number; closeRate: number; readyToClose?: number; quoteSent?: number };
  ai: { hot: number; warm: number; low: number; handoffRequired: number; averageCloseScore: number; readyToClose?: number; quoteSent?: number; outcomes?: number };
};

export async function getSalesDashboard(): Promise<SalesDashboard> {
  return request<SalesDashboard>("/dashboard/sales");
}

export type CrmOperationalDashboard = {
  kpis: {
    leads: number;
    hotLeads: number;
    conversations: number;
    readyToClose: number;
    paymentPending: number;
    bookingsPending: number;
    bookingsConfirmed: number;
    paidCount: number;
    averageCloseScore: number;
    conversionRate: number;
  };
  revenue: {
    paid: number;
    paidToday: number;
    paidMonth: number;
    pending: number;
    estimated: number;
    bookings: number;
    pipeline: number;
  };
  pipeline: Array<{ stage: string; count: number; value: number }>;
  priorities: Array<{
    conversationId: string;
    leadId?: string | null;
    customer: string;
    channel: string;
    stage: string;
    score: number;
    amount: number;
    risk: string;
    nextAction: string;
    lastMessageAt?: string | null;
    paymentStatus?: string | null;
    bookingStatus?: string | null;
  }>;
  activity: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    createdAt: string;
    conversationId?: string | null;
    amount?: number;
  }>;
  upcomingBookings: Array<{ id: string; date: string; guests: number; location?: string | null; total: number; status: string; name?: string | null }>;
  alerts: Array<{ type: string; title: string; count: number; message: string }>;
  forecasts: { expectedRevenue: number; recoveryOpportunities: number; humanActionsRequired: number };
};

export async function getCrmOperationalDashboard(): Promise<CrmOperationalDashboard> {
  return request<CrmOperationalDashboard>("/crm/operational");
}

export type Payment = {
  id: string;
  tenantId: string;
  conversationId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  provider: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PARTIAL" | "PAID" | "FAILED" | "CANCELED" | "REFUNDED" | string;
  description?: string | null;
  paymentUrl?: string | null;
  externalId?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  conversation?: Conversation | null;
  lead?: Lead | null;
  booking?: {
    id: string;
    date: string;
    guests: number;
    location?: string | null;
    total: number;
    status: string;
  } | null;
};

export type PaymentMetrics = {
  count: number;
  total: number;
  paid: number;
  paidTotal: number;
  pending: number;
  pendingTotal: number;
  conversionRate: number;
};

export async function getPayments(status = "all"): Promise<Payment[]> {
  return request<Payment[]>(`/payments?status=${encodeURIComponent(status)}`);
}

export async function getPaymentMetrics(): Promise<PaymentMetrics> {
  return request<PaymentMetrics>("/payments/metrics");
}

export async function createPayment(input: {
  conversationId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  amount: number;
  currency?: string;
  provider?: string;
  description?: string;
  expiresAt?: string | null;
}): Promise<Payment> {
  return request<Payment>("/payments", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function confirmPayment(paymentId: string): Promise<Payment> {
  return request<Payment>(`/payments/${paymentId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ status: "PAID" })
  });
}

export async function cancelPayment(paymentId: string): Promise<Payment> {
  return request<Payment>(`/payments/${paymentId}/cancel`, {
    method: "POST"
  });
}

export async function getSalesQueue(): Promise<Conversation[]> {
  return request<Conversation[]>("/sales/queue");
}

export type AiOpsSummary = {
  metrics: {
    total: number;
    critical: number;
    opportunities: number;
    averageScore: number;
    recovery: number;
  };
  priorities: Array<{ conversation: Conversation; profile: Record<string, any> }>;
  strategies: Array<{ conversation: Conversation; profile: Record<string, any> }>;
  learning: Array<{ conversation: Conversation; profile: Record<string, any> }>;
  alerts: Array<{ conversationId: string; title: string; message: string; score: number }>;
};

export async function getAiOpsSummary(): Promise<AiOpsSummary> {
  return request<AiOpsSummary>("/ai-ops/summary");
}

export async function previewAutonomousFollowUps(): Promise<{ count: number; actions: unknown[] }> {
  return request<{ count: number; actions: unknown[] }>("/saas/followups/preview");
}

export type TenantModulesResponse = {
  tenantId: string;
  plan: string;
  modules: string[];
  subscription?: unknown;
};

export type IndustryTemplate = {
  code: string;
  name: string;
  summary: string;
  custom?: boolean;
  modules: Array<{ key: string; label: string; description: string; minPlan: string }>;
  entities: Array<{ key: string; label: string; purpose?: string; fields?: string[] }>;
  workflows: string[];
};

export type IndustryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle?: string | null;
};

export type IndustryRecord = {
  id: string;
  tenantId: string;
  recordType: string;
  title: string;
  status: string;
  assignedToId?: string | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  assignedTo?: IndustryUser | null;
};

export async function getMyModules(): Promise<TenantModulesResponse> {
  return request<TenantModulesResponse>("/modules/me");
}

export async function getModuleCatalog(): Promise<{ modules: Record<string, string>; plans: Record<string, unknown> }> {
  return request<{ modules: Record<string, string>; plans: Record<string, unknown> }>("/modules/catalog");
}

export async function getIndustryTemplates(): Promise<{ templates: IndustryTemplate[] }> {
  return request<{ templates: IndustryTemplate[] }>("/admin/industries");
}

export async function createIndustryTemplate(input: {
  code?: string;
  name: string;
  summary?: string;
  modules: Array<{ key: string; label?: string; description?: string; minPlan?: string }>;
  entities?: Array<{ key: string; label: string; purpose?: string; fields?: string[] }>;
  workflows?: string[];
}): Promise<{ template: IndustryTemplate; templates: IndustryTemplate[] }> {
  return request<{ template: IndustryTemplate; templates: IndustryTemplate[] }>("/admin/industries", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getIndustryUsers(): Promise<IndustryUser[]> {
  return request<IndustryUser[]>("/industry-records/users");
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
  });
}

export async function createIndustryBrokerUser(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<{ user: IndustryUser; profile: IndustryRecord }> {
  return request<{ user: IndustryUser; profile: IndustryRecord }>("/industry-records/brokers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteIndustryBrokerUser(userId: string): Promise<{ ok: true; unassignedProperties: number }> {
  return request<{ ok: true; unassignedProperties: number }>(`/industry-records/brokers/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

export async function updateIndustryRecord(
  id: string,
  input: Partial<Pick<IndustryRecord, "title" | "status" | "assignedToId">> & { data?: Record<string, unknown> | null }
): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/industry-records/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function updateIndustryRecordMetadata(
  id: string,
  metadata: Record<string, unknown>
): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/industry-records/${id}/metadata`, {
    method: "PATCH",
    body: JSON.stringify({ metadata })
  });
}

export async function getBalancedIndustryAssignments(input: {
  recordType: string;
  assigneeRole?: string;
}): Promise<{ recordType: string; assigneeRole: string; assignments: Array<{ item: IndustryRecord; assignee: IndustryUser; order: number; mode: string }> }> {
  return request<{ recordType: string; assigneeRole: string; assignments: Array<{ item: IndustryRecord; assignee: IndustryUser; order: number; mode: string }> }>(`/industry-records/assignments/balance`, {
    method: "POST",
    body: JSON.stringify(input)
  });
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
  channel: "whatsapp" | "instagram" | "facebook" | string;
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
  subscriptions?: Array<{ id: string; planCode: string; status: string; startedAt: string; endsAt?: string | null; metadata?: Record<string, unknown> | null; plan?: { name?: string; priceMonthly?: number; currency?: string } | null }>;
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

export async function updateAdminTenantBilling(
  tenantId: string,
  input: {
    planCode?: string;
    planName?: string;
    monthlyPrice?: number;
    currency?: string;
    description?: string;
    messagesMonthly?: number | null;
    users?: number | null;
  }
): Promise<{ tenant: AdminTenant }> {
  return request<{ tenant: AdminTenant }>(`/admin/tenants/${tenantId}/billing`, {
    method: "PATCH",
    body: JSON.stringify(input)
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
  facebookPageId?: string;
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
  channel: "whatsapp" | "instagram" | "facebook",
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

export async function applyAdminTenantIndustryTemplate(
  tenantId: string,
  input: { industry: string; plan?: string }
): Promise<{ tenant: AdminTenant; template: IndustryTemplate; modules: string[] }> {
  return request<{ tenant: AdminTenant; template: IndustryTemplate; modules: string[] }>(`/admin/tenants/${tenantId}/industry-template`, {
    method: "PATCH",
    body: JSON.stringify(input)
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
  subscription?: { id: string; planCode: string; status: string; metadata?: Record<string, unknown> | null } | null;
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

export type IndustryReportMetric = {
  label: string;
  value: number;
  detail?: string;
};

export type IndustryReport = {
  generatedAt: string;
  tenant: { name: string; industry: string; industryLabel: string };
  summary: IndustryReportMetric[];
  sections: Array<{
    id: string;
    title: string;
    description: string;
    metrics: IndustryReportMetric[];
  }>;
};

export async function getIndustryReports(): Promise<IndustryReport> {
  return request<IndustryReport>("/reports/overview");
}

export async function downloadExecutiveReport(): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/reports/executive.pdf`, {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) {
    let message = "No se pudo generar el reporte ejecutivo";
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {}
    throw new Error(message);
  }
  return response.blob();
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

export async function getTeamManagement(): Promise<{ users: Array<{ id: string; name: string; email: string; role: string; jobTitle?: string | null; isActive: boolean; createdAt: string }> }> {
  return request<{ users: Array<{ id: string; name: string; email: string; role: string; jobTitle?: string | null; isActive: boolean; createdAt: string }> }>("/saas/team");
}

export async function getAuditLogs(): Promise<{ logs: Array<{ id: string; action: string; entity?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }> }> {
  return request<{ logs: Array<{ id: string; action: string; entity?: string | null; createdAt: string; metadata?: Record<string, unknown> | null }> }>("/saas/audit");
}


export async function createTeamUser(input: { name: string; email: string; role?: string; operationalRole?: string; jobTitle?: string; password?: string }) {
  return request<{ user: { id: string; name: string; email: string; role: string; jobTitle?: string | null; isActive: boolean; createdAt: string } }>("/saas/team", {
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
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  for (const [key, value] of Object.entries(input)) {
    if (key !== "files" && value) form.append(key, String(value));
  }

  const response = await fetch(`${API_BASE_URL}/onboarding/extract`, {
    method: "POST",
    body: form,
    cache: "no-store",
    credentials: "include"
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
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  for (const [key, value] of Object.entries(input)) {
    if (key !== "files" && key !== "tenantId" && value) form.append(key, String(value));
  }

  const response = await fetch(`${API_BASE_URL}/admin/tenants/${input.tenantId}/onboarding/extract`, {
    method: "POST",
    body: form,
    cache: "no-store",
    credentials: "include"
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

export type MetadataCatalog = {
  tenantId: string;
  industry: string;
  activeModules: string[];
  modules: Record<string, string>;
  plans: Record<string, unknown>;
  entities: Array<{
    recordType?: string;
    label?: string;
    fields: Array<{ name: string; type: string; required: boolean; options?: unknown[] }>;
  }>;
  industries: unknown[];
};

export type TenantDocument = {
  id: string;
  tenantId: string;
  recordType: "document";
  title: string;
  status: string;
  data?: {
    category?: string;
    description?: string | null;
    originalName?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    url?: string;
    source?: string;
    uploadedByUserId?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDefinition = {
  id: string;
  tenantId: string;
  recordType: "workflow_definition";
  title: string;
  status: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationStatus = {
  id: string;
  channel: string;
  label?: string | null;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  externalAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
  hasAccessToken: boolean;
  hasVerifyToken: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TenantAuditLog = {
  id: string;
  tenantId: string;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; name: string; email: string; role: string } | null;
};

export type GlobalSearchResult = {
  type: "contact" | "message" | "lead" | "booking" | "payment" | "campaign" | "industry_record";
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  metadata?: Record<string, unknown>;
};

export type TenantNotification = {
  id: string;
  title: string;
  status: "UNREAD" | "READ" | string;
  assignedToId?: string | null;
  body?: string;
  severity?: "info" | "success" | "warning" | "critical" | string;
  targetUrl?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BackupSummary = {
  tenantId: string;
  counts: Record<string, number>;
  generatedAt: string;
};

export async function getMetadataCatalog(industry?: string): Promise<MetadataCatalog> {
  const suffix = industry ? `?industry=${encodeURIComponent(industry)}` : "";
  return request<MetadataCatalog>(`/metadata/catalog${suffix}`);
}

export async function validateMetadata(input: { industry?: string; recordType: string; data: Record<string, unknown> }) {
  return request<{ ok: boolean; recordType: string; missing: string[]; data: Record<string, unknown> }>("/metadata/validate", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function normalizeMetadataApi(metadata: Record<string, unknown>) {
  return request<{ metadata: Record<string, unknown>; maxDepth: number }>("/metadata/normalize", {
    method: "POST",
    body: JSON.stringify({ metadata })
  });
}

export async function getTenantDocuments(status?: string): Promise<{ documents: TenantDocument[] }> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ documents: TenantDocument[] }>(`/documents${suffix}`);
}

export async function uploadTenantDocuments(input: {
  files: File[];
  title?: string;
  category?: string;
  description?: string;
}): Promise<{ documents: TenantDocument[] }> {
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  if (input.title) form.append("title", input.title);
  if (input.category) form.append("category", input.category);
  if (input.description) form.append("description", input.description);

  const response = await fetch(`${API_BASE_URL}/documents`, {
    method: "POST",
    body: form,
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "No se pudieron subir documentos");
  }

  return response.json();
}

export async function getWorkflows(status?: string): Promise<{ workflows: WorkflowDefinition[] }> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ workflows: WorkflowDefinition[] }>(`/workflows${suffix}`);
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  trigger?: string;
  entityType?: string;
  steps?: unknown[];
  conditions?: unknown[];
  actions?: unknown[];
  status?: string;
}): Promise<{ workflow: WorkflowDefinition }> {
  return request<{ workflow: WorkflowDefinition }>("/workflows", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateWorkflow(id: string, input: Partial<WorkflowDefinition["data"]> & { name?: string; title?: string; status?: string }) {
  return request<{ workflow: WorkflowDefinition }>(`/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function runWorkflow(id: string, input: { input?: Record<string, unknown>; target?: Record<string, unknown> }) {
  return request<{ run: { id: string; status: string; data?: Record<string, unknown> | null } }>(`/workflows/${id}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getIntegrationsStatus(): Promise<{ integrations: IntegrationStatus[]; summary: { active: number; configured: number; channels: string[] } }> {
  return request<{ integrations: IntegrationStatus[]; summary: { active: number; configured: number; channels: string[] } }>("/integrations/status");
}

export async function configureIntegration(channel: string, input: Partial<IntegrationStatus> & {
  accessToken?: string;
  verifyToken?: string;
}): Promise<{ integration: IntegrationStatus }> {
  return request<{ integration: IntegrationStatus }>(`/integrations/${encodeURIComponent(channel)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export type ConnectionStatus = "CONNECTED" | "PENDING" | "DISCONNECTED" | "ERROR";

export type ConnectionPublicConfig = {
  id: string;
  channel: string;
  label?: string | null;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  externalAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
  hasAccessToken: boolean;
  hasVerifyToken: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionProvider = {
  key: string;
  label: string;
  group: string;
  groupKey: string;
  icon: string;
  type: "oauth" | "credentials" | "manual" | "local" | string;
  oauthProvider?: string | null;
  module: string;
  description: string;
  requiredEnv: string[];
  oauthRequiredEnv?: string[];
  requiredFields: string[];
  scopes: string[];
  missing: string[];
  status: ConnectionStatus;
  config: ConnectionPublicConfig | null;
};

export type ConnectionGroup = {
  id: string;
  label: string;
  description: string;
  providers: ConnectionProvider[];
};

export type ConnectionCenterResponse = {
  tenantId: string;
  generatedAt: string;
  summary: {
    total: number;
    connected: number;
    pending: number;
    errors: number;
    disconnected: number;
  };
  callbacks: {
    oauthGoogle: string;
    oauthMicrosoft: string;
    oauthMeta?: string;
    oauthMercadoPago?: string;
    metaWebhook: string;
    [key: string]: string | undefined;
  };
  groups: ConnectionGroup[];
};

export async function getConnectionCenter(): Promise<ConnectionCenterResponse> {
  return request<ConnectionCenterResponse>("/connections");
}

export async function saveConnectionProvider(
  key: string,
  input: {
    label?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    externalAccountId?: string;
    accessToken?: string;
    verifyToken?: string;
    metadata?: Record<string, unknown>;
    isActive?: boolean;
  }
): Promise<{ provider: ConnectionProvider }> {
  return request<{ provider: ConnectionProvider }>(`/connections/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function testConnectionProvider(key: string): Promise<{ ok: boolean; missing: string[]; provider: ConnectionProvider }> {
  return request<{ ok: boolean; missing: string[]; provider: ConnectionProvider }>(`/connections/${encodeURIComponent(key)}/test`, {
    method: "POST"
  });
}

export async function disconnectConnectionProvider(key: string): Promise<{ ok: boolean; provider: ConnectionProvider }> {
  return request<{ ok: boolean; provider: ConnectionProvider }>(`/connections/${encodeURIComponent(key)}/disconnect`, {
    method: "POST"
  });
}

export async function getConnectionOAuthUrl(key: string): Promise<{ url: string; provider: string; oauthProvider: string }> {
  return request<{ url: string; provider: string; oauthProvider: string }>(`/connections/${encodeURIComponent(key)}/oauth-url`, {
    method: "POST"
  });
}

export async function getTenantAuditTrail(input: { tenantId?: string; action?: string; entity?: string; entityId?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ logs: TenantAuditLog[] }>(`/audit/logs${suffix}`);
}

export async function globalSearch(q: string, limit?: number): Promise<{ query: string; results: GlobalSearchResult[] }> {
  const params = new URLSearchParams();
  params.set("q", q);
  if (limit) params.set("limit", String(limit));
  return request<{ query: string; results: GlobalSearchResult[] }>(`/search?${params.toString()}`);
}

export async function getNotifications(input: { status?: string; limit?: number } = {}): Promise<{ notifications: TenantNotification[] }> {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.limit) params.set("limit", String(input.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<{ notifications: TenantNotification[] }>(`/notifications${suffix}`);
}

export async function createNotification(input: {
  title: string;
  body?: string;
  severity?: string;
  targetUrl?: string;
  assignedToId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ notification: TenantNotification }> {
  return request<{ notification: TenantNotification }>("/notifications", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function markNotificationRead(id: string): Promise<{ notification: TenantNotification }> {
  return request<{ notification: TenantNotification }>(`/notifications/${id}/read`, {
    method: "PATCH"
  });
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request<{ updated: number }>("/notifications/read-all", {
    method: "PATCH"
  });
}

export async function getBackupSummary(): Promise<BackupSummary> {
  return request<BackupSummary>("/backups/summary");
}

export async function exportTenantBackup(): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/backups/export`, {
    headers: buildHeaders(),
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "No se pudo exportar el respaldo");
  }

  return response.blob();
}

export type MetadataSchema = {
  id: string;
  recordType: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED" | string;
  label: string;
  fields: Record<string, { type?: string; required?: boolean; options?: unknown[]; sensitivity?: string; purpose?: string; retentionDays?: number; accessRoles?: string[] }>;
  policies?: { enforcement?: "COMPATIBLE" | "STRICT"; allowUnknown?: boolean; [key: string]: unknown } | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getMetadataSchemas(recordType?: string): Promise<{ schemas: MetadataSchema[] }> {
  const suffix = recordType ? `?recordType=${encodeURIComponent(recordType)}` : "";
  return request<{ schemas: MetadataSchema[] }>(`/metadata/schemas${suffix}`);
}

export async function createMetadataSchema(input: {
  recordType: string;
  label: string;
  fields: MetadataSchema["fields"];
  policies?: MetadataSchema["policies"];
}): Promise<{ schema: MetadataSchema }> {
  return request<{ schema: MetadataSchema }>("/metadata/schemas", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function publishMetadataSchema(id: string): Promise<{ schema: MetadataSchema }> {
  return request<{ schema: MetadataSchema }>(`/metadata/schemas/${encodeURIComponent(id)}/publish`, { method: "POST" });
}

export async function migrateMetadataSchema(id: string, input: { core?: boolean; apply?: boolean } = {}) {
  return request<{ dryRun: boolean; recordType: string; targetVersion: number; records?: Array<{ id: string; before: Record<string, unknown>; after: Record<string, unknown> }>; migrated?: number }>(`/metadata/schemas/${encodeURIComponent(id)}/${input.core ? "migrate-core" : "migrate"}`, {
    method: "POST",
    body: JSON.stringify({ apply: input.apply === true })
  });
}
