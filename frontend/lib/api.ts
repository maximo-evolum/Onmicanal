import { AgentSession, Booking, BookingSlot, Campaign, Conversation, Lead, LeadMetrics, Message, TenantSession } from "./types";
import { API_BASE_URL, SESSION_STORAGE_KEY } from "./constants";
import { canQueueOfflineMutation, OfflineQueuedError, queueOfflineMutation } from "./offline-queue";

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
  const headers = new Headers(init?.headers || {});
  // El navegador añade el boundary correcto para cargas multipart. Forzarlo a
  // application/json rompe la lectura de Excel/CSV en el backend.
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Evita que una solicitud deje una pantalla esperando indefinidamente
  // cuando hay una red inestable o un deploy activo.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    if (typeof window !== "undefined" && !navigator.onLine && queueOfflineMutation(path, init)) {
      throw new OfflineQueuedError();
    }
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: buildHeaders(init),
      cache: "no-store",
      credentials: "include",
      signal: init?.signal || controller.signal
    });
  } catch (error) {
    if (error instanceof OfflineQueuedError) throw error;
    if (typeof window !== "undefined" && !(error instanceof DOMException && error.name === "AbortError") && canQueueOfflineMutation(path, init) && queueOfflineMutation(path, init)) {
      throw new OfflineQueuedError();
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La conexión tardó demasiado. Revisa tu red e inténtalo nuevamente.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let message = "La solicitud no pudo completarse.";
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

    if (response.status === 401) {
      // Evita que la UI quede atrapada mostrando "Token invalido" despues de
      // una rotacion de JWT o un deploy. La proxima pantalla exige sesion sana.
      if (typeof window !== "undefined" && !path.startsWith("/auth/")) {
        window.sessionStorage.removeItem("evolum_access_token");
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        window.location.assign("/login?session=expired");
      }
      message = "Tu sesion expiro. Inicia sesion nuevamente.";
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

export async function loginWithEmail(email: string, password?: string): Promise<{ user: AgentSession; tenant?: TenantSession; modules?: string[]; accessToken?: string }> {
  return request<{ user: AgentSession; tenant?: TenantSession; modules?: string[]; accessToken?: string }>("/auth/login", {
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

export type AuthMeResponse = {
  user: AgentSession;
  tenant: TenantSession;
  // El backend entrega la misma lista autoritativa que /modules/me. Se usa
  // como respaldo para que una respuesta parcial no esconda módulos válidos.
  modules?: string[];
};

export async function getMe(): Promise<AuthMeResponse> {
  return request<AuthMeResponse>("/auth/me");
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
  role?: string | null;
  industry?: string | null;
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

export type RealtyIntelligence = {
  generatedAt: string;
  inventory: {
    total: number;
    portfolioValue: number;
    averagePrice: number;
    averageCompleteness: number;
    assigned: number;
    unassigned: number;
    missingMedia: number;
    stale: number;
    byOperation: Array<{ label: string; count: number }>;
    byStage: Array<{ label: string; count: number }>;
    topCommunes: Array<{ label: string; count: number }>;
  };
  visits: { total: number; pending: number };
  owners: number;
  brokers: Array<{ brokerId: string; name: string; role: string; properties: number; portfolioValue: number; activeVisits: number }>;
  marketing: { campaigns: number; published: number; audiences: Array<{ key: string; label: string; count: number; recommendedChannel: string }> };
  priorities: Array<{ priority: string; code: string; message: string }>;
  actionQueue: Array<{ type: string; recordId: string; title: string; message: string }>;
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

export type FinanceOverview = {
  generatedAt: string;
  invoices: { total: number; issued: number; paid: number; pending: number; overdue: number; pendingAmount: number; overdueAmount: number };
  collection: { rate: number; dsoDays: number; expectedNext30Days: number };
  reconciliation: { totalMovements: number; matchedMovements: number; pendingMovements: number; rate: number };
  exceptions: { open: number; critical: number };
  collections: { open: number; promises: number };
  aging: Array<{ label: string; amount: number; invoices: number }>;
  recent: { invoices: IndustryRecord[]; exceptions: IndustryRecord[]; collectionCases: IndustryRecord[] };
  integrationReadiness: Array<{ key: string; label: string; status: "ready" | "requires_configuration" | "manual"; note: string }>;
};

export type FinanceReconciliationSuggestion = {
  movement: IndustryRecord;
  invoice: IndustryRecord;
  confidence: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  amountDifference: number;
};

export function getFinanceOverview(): Promise<FinanceOverview> {
  return request<FinanceOverview>("/finance/overview");
}

export function getFinanceReconciliationSuggestions(): Promise<{ suggestions: FinanceReconciliationSuggestion[] }> {
  return request<{ suggestions: FinanceReconciliationSuggestion[] }>("/finance/reconciliation-suggestions");
}

export function approveFinanceReconciliation(movementId: string, invoiceId: string): Promise<{ reconciliation: IndustryRecord; movement: IndustryRecord; invoice: IndustryRecord }> {
  return request(`/finance/reconciliations/${encodeURIComponent(movementId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ invoiceId })
  });
}

export function generateFinanceCollectionCases(): Promise<{ created: number; cases: IndustryRecord[] }> {
  return request("/finance/collection-cases/generate", { method: "POST" });
}

export type FinanceCustomer = { key: string; name: string; rut: string | null; invoices: number; openInvoices: number; totalAmount: number; outstandingAmount: number; overdueAmount: number; lastActivityAt: string };
export type FinanceDocument = {
  id: string;
  recordType: "finance_invoice" | "finance_payable" | string;
  side: "CUSTOMER" | "SUPPLIER";
  documentNumber: string;
  partyName: string;
  partyRut: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  amount: number;
  balance: number;
  paidAmount: number;
  nuboxDocument?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FinanceNuboxDocumentResource = {
  sale?: Record<string, unknown>;
  details?: unknown;
  references?: unknown;
};
export type FinanceCollectionPortfolioRow = {
  key: string;
  name: string;
  rut: string | null;
  documents: number;
  openDocuments: number;
  overdueDocuments: number;
  dueSoonAmount: number;
  overdueAmount: number;
  totalDebt: number;
  oldestInvoiceDate: string | null;
  averagePaymentDays: number | null;
  reminders: number;
  lastReminderAt: string | null;
  latestCaseId: string | null;
  reminderStatus: string;
};
export type FinanceIntegration = { key: string; label: string; status: "connected" | "not_connected" | "manual_ready"; detail: string };
export type FinancePlan = { plan: string; usage: { processedDocuments: number; limit: number | null; percentage: number | null } };
export type FinancePayableSummary = {
  summary: { total: number; paid: number; overdue: number; registeredAmount: number; pendingAmount: number; overdueAmount: number };
  payables: IndustryRecord[];
};
export type FinanceMigrationPreview = {
  maxRows: number;
  sourceFile?: string;
  summary: {
    totalRows: number;
    reviewRows: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    openReceivables: number;
    openPayables: number;
  };
  rows: Array<Record<string, unknown>>;
  sourceRows?: Array<Record<string, unknown>>;
};
export type ChileanBank = { key: string; name: string; cmfCode: string };
export type FinanceBankStatementAccount = { bank: string; bankKey: string; cmfCode: string; accountAlias: string; accountType: string; accountLast4: string | null };
export type FinanceBankStatementPreview = {
  sourceFile: string;
  maxRows: number;
  account: FinanceBankStatementAccount;
  summary: { totalRows: number; reviewRows: number; credits: number; debits: number; net: number };
  rows: Array<Record<string, unknown>>;
  sourceRows: Array<Record<string, unknown>>;
};
export type FinanceSyncHistoryEntry = {
  id: string;
  action: "NUBOX_SALES_SYNCED" | "NUBOX_SALES_SYNC_FAILED" | "FINANCE_POST_INGESTION_ANALYZED" | string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

export function getFinanceCustomers(): Promise<{ customers: FinanceCustomer[] }> {
  return request("/finance/customers");
}

export function getFinanceDocuments(type: "all" | "customers" | "suppliers" = "all"): Promise<{ documents: FinanceDocument[] }> {
  return request(`/finance/documents?type=${encodeURIComponent(type)}`);
}

export function getFinanceNuboxDocument(id: string): Promise<{ sale: Record<string, unknown> }> {
  return request(`/finance/documents/${encodeURIComponent(id)}/nubox`);
}

export function getFinanceNuboxDocumentDetails(id: string): Promise<{ details: unknown }> {
  return request(`/finance/documents/${encodeURIComponent(id)}/nubox/details`);
}

export function getFinanceNuboxDocumentReferences(id: string): Promise<{ references: unknown }> {
  return request(`/finance/documents/${encodeURIComponent(id)}/nubox/references`);
}

export async function downloadFinanceNuboxDocument(id: string, format: "pdf" | "xml"): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/finance/documents/${encodeURIComponent(id)}/nubox/${format}`, {
    headers: buildHeaders(),
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) {
    let message = `No se pudo descargar el ${format.toUpperCase()} desde Nubox.`;
    try { message = (await response.json())?.error || message; } catch {}
    throw new Error(message);
  }
  return response.blob();
}

export function requestFinanceNuboxIssuance(input: { documents: Array<Record<string, unknown>>; confirmation: "EMITIR" }): Promise<{ ok: true; issued: unknown; message: string }> {
  return request("/finance/nubox/sales/issuance", { method: "POST", body: JSON.stringify(input) });
}

export function getFinanceCollectionPortfolio(): Promise<{ portfolio: FinanceCollectionPortfolioRow[] }> {
  return request("/finance/collections/portfolio");
}

export function registerFinanceInvoiceReceipt(id: string, input: { amount: number; paymentDate?: string; reference?: string }): Promise<{ receipt: IndustryRecord; invoice: IndustryRecord; remainingBalance: number }> {
  return request(`/finance/invoices/${encodeURIComponent(id)}/receipts`, { method: "POST", body: JSON.stringify(input) });
}

export function prepareFinanceCollectionReminders(partyKey: string): Promise<{ prepared: IndustryRecord[]; count: number }> {
  return request(`/finance/collections/portfolio/${encodeURIComponent(partyKey)}/reminders`, { method: "POST" });
}

export function getFinanceIntegrations(): Promise<{ integrations: FinanceIntegration[] }> {
  return request("/finance/integrations");
}

export function getFinancePlan(): Promise<FinancePlan> {
  return request("/finance/plan");
}

export function getFinancePayables(): Promise<FinancePayableSummary> {
  return request<FinancePayableSummary>("/finance/payables/summary");
}

export function registerFinancePayablePayment(id: string, input: { amount: number; paymentDate?: string; reference?: string }): Promise<{ payment: IndustryRecord; payable: IndustryRecord; remainingBalance: number }> {
  return request(`/finance/payables/${encodeURIComponent(id)}/payments`, { method: "POST", body: JSON.stringify(input) });
}

export function previewFinanceMigration(rows: Array<Record<string, unknown>>): Promise<FinanceMigrationPreview> {
  return request<FinanceMigrationPreview>("/finance/migrations/preview", { method: "POST", body: JSON.stringify({ rows }) });
}

export function previewFinanceMigrationFile(file: File): Promise<FinanceMigrationPreview> {
  const data = new FormData();
  data.append("file", file);
  return request<FinanceMigrationPreview>("/finance/migrations/preview-file", { method: "POST", body: data });
}

export function importFinanceMigration(input: { sourceFile: string; rows: Array<Record<string, unknown>> }): Promise<{ imported: number; requiresReview: number; summary: FinanceMigrationPreview["summary"] }> {
  return request("/finance/migrations/import", { method: "POST", body: JSON.stringify(input) });
}

export function getFinanceBankCatalog(): Promise<{ banks: ChileanBank[]; supportedFormats: string[]; maxRows: number; note: string }> {
  return request("/finance/banks/catalog");
}

export function previewFinanceBankStatementFile(file: File, account: { bankKey: string; accountAlias?: string; accountType?: string; accountLast4?: string }): Promise<FinanceBankStatementPreview> {
  const data = new FormData();
  data.append("file", file);
  data.append("bankKey", account.bankKey);
  data.append("accountAlias", account.accountAlias || "");
  data.append("accountType", account.accountType || "Cuenta corriente");
  data.append("accountLast4", account.accountLast4 || "");
  return request<FinanceBankStatementPreview>("/finance/bank-statements/preview-file", { method: "POST", body: data });
}

export function importFinanceBankStatement(input: { sourceFile: string; rows: Array<Record<string, unknown>>; bankKey: string; accountAlias?: string; accountType?: string; accountLast4?: string }): Promise<{ imported: number; duplicateRows: number; requiresReview: number; summary: FinanceBankStatementPreview["summary"] }> {
  return request("/finance/bank-statements/import", { method: "POST", body: JSON.stringify(input) });
}

export function getFinanceSyncHistory(limit = 12): Promise<{ generatedAt: string; entries: FinanceSyncHistoryEntry[] }> {
  return request(`/finance/sync-history?limit=${encodeURIComponent(String(limit))}`);
}

export function syncFinanceNubox(period?: string): Promise<{ ok?: boolean; pending?: boolean; message?: string; created?: number; updated?: number; received?: number }> {
  return request("/finance/sync/nubox", {
    method: "POST",
    body: JSON.stringify(period ? { period } : {})
  });
}

export function rejectFinanceReconciliation(movementId: string, detail?: string): Promise<{ updatedMovement: IndustryRecord; exception: IndustryRecord }> {
  return request(`/finance/reconciliations/${encodeURIComponent(movementId)}/reject`, { method: "POST", body: JSON.stringify({ detail }) });
}

export type FinanceAgentPolicy = {
  minimumConfidenceForSuggestion: number;
  autoCreateExceptions: boolean;
  collectionsRequireApproval: boolean;
  updateErpRequiresApproval: boolean;
  enabledChannels: string[];
};

export type FinanceAgentWorkspace = {
  generatedAt: string;
  policy: FinanceAgentPolicy;
  agents: Array<{
    code: string;
    name: string;
    purpose: string;
    humanControl: string;
    status: string;
    metrics: Array<{ label: string; value: string | number }>;
    nextAction: string;
  }>;
  priority: Array<{ agent: string; action: string }>;
  matchingPolicy: { high: string; medium: string; low: string };
  safeguards: string[];
};

export function getFinanceAgentWorkspace(): Promise<FinanceAgentWorkspace> {
  return request<FinanceAgentWorkspace>("/finance/agents");
}

export function updateFinanceAgentPolicy(patch: Partial<FinanceAgentPolicy>): Promise<{ policy: FinanceAgentPolicy }> {
  return request("/finance/agents/policy", { method: "PATCH", body: JSON.stringify(patch) });
}

export function analyzeFinanceAgents(): Promise<{ workspace: FinanceAgentWorkspace; exceptionsPrepared: number; exceptionsSkipped: string | null }> {
  return request("/finance/agents/analyze", { method: "POST" });
}

export async function getRealtyIntelligence(): Promise<RealtyIntelligence> {
  return request<RealtyIntelligence>("/realty/intelligence");
}

export async function getRealtyLeadMatches(leadId: string): Promise<{ lead: { id: string; name?: string | null; status: string; budget?: number | null; closeProbability?: number | null }; matches: Array<{ score: number; reasons: string[]; property: { id: string; title: string; status: string; price: number; commune: string; operation: string; assignedToId?: string | null } }> }> {
  return request(`/realty/leads/${encodeURIComponent(leadId)}/matches`);
}

export type RealtyBuyerMatch = {
  score: number;
  reasons: string[];
  buyer: { id: string; name: string; phone?: string | null; budget?: number | null; commune?: string | null; propertyType?: string | null; interest?: string | null; closeProbability?: number | null; conversationId: string };
};

export async function getRealtyPropertyMatches(propertyId: string): Promise<{ property: { id: string; title: string; price: number; commune: string }; matches: RealtyBuyerMatch[] }> {
  return request(`/realty/properties/${encodeURIComponent(propertyId)}/buyers`);
}

export async function createRealtyBuyer(input: { name: string; phone?: string; email?: string; budget?: number; commune?: string; propertyType?: string; interest?: string }): Promise<{ buyer: Lead }> {
  return request<{ buyer: Lead }>("/realty/buyers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type BrokerOperationType = "SALE" | "RENTAL" | "ADMINISTRATION";

export type BrokerOperation = IndustryRecord & {
  data: Record<string, unknown> & {
    operationType: BrokerOperationType;
    propertyId?: string | null;
    buyerId?: string | null;
    stage: string;
    timeline: Array<{ at: string; type: string; stage?: string; from?: string; note: string }>;
  };
};

export type BrokerSaleCase = {
  id: string;
  updatedAt?: string;
  operationId: string;
  propertyId: string;
  buyerId?: string | null;
  buyerName?: string | null;
  status: string;
  currentStage: string;
  buyerQualificationStatus: string;
  preapprovalBank?: string | null;
  preapprovalAmount?: number | null;
  preapprovalExpiresAt?: string | null;
  offerAmount?: number | null;
  currency: string;
  offerStatus: string;
  offerReceivedAt?: string | null;
  offerRespondedAt?: string | null;
  offerConditions?: string | null;
  promiseStatus: string;
  promiseSignedAt?: string | null;
  promiseAmount?: number | null;
  promisePenaltyPct?: number | null;
  titleStudyStatus: string;
  titleStudyNotes?: string | null;
  titleStudyReviewedAt?: string | null;
  bankAppraisalStatus: string;
  financingStatus: string;
  deedStatus: string;
  deedScheduledAt?: string | null;
  deedSignedAt?: string | null;
  cbrStatus: string;
  cbrEntryNumber?: string | null;
  cbrRegisteredAt?: string | null;
  handoverStatus: string;
  handoverAt?: string | null;
  handoverRecipient?: string | null;
  checkpoints?: Record<string, { confirmedAt?: string; confirmedBy?: string; note?: string }>;
};

export type BrokerSaleWorkspace = {
  operation: BrokerOperation;
  property: IndustryRecord;
  saleCase: BrokerSaleCase;
  capture: BrokerCapture | null;
  nextStage: string | null;
  readiness: { ready: boolean; missing: string[]; requirements: Array<{ key: string; label: string; ready: boolean }> };
  options: {
    qualificationStatuses: string[];
    offerStatuses: string[];
    promiseStatuses: string[];
    titleStudyStatuses: string[];
    financingStatuses: string[];
    bankAppraisalStatuses: string[];
    deedStatuses: string[];
    cbrStatuses: string[];
    handoverStatuses: string[];
  };
};

export type BrokerRentalCase = {
  id: string;
  updatedAt?: string;
  operationId: string;
  propertyId: string;
  leaseTenantId?: string | null;
  tenantName?: string | null;
  status: string;
  currentStage: string;
  applicantTaxStatus: string;
  applicantCommercialStatus: string;
  declaredIncome?: number | null;
  guarantorName?: string | null;
  guarantorEvaluationStatus: string;
  applicationReceivedAt?: string | null;
  applicationReviewedAt?: string | null;
  reservationStatus: string;
  reservationAmount?: number | null;
  reservationExpiresAt?: string | null;
  contractStatus: string;
  monthlyRent?: number | null;
  currency: string;
  contractStartAt?: string | null;
  contractEndAt?: string | null;
  paymentDay?: number | null;
  depositAmount?: number | null;
  contractSignedAt?: string | null;
  initialPaymentStatus: string;
  initialPaymentAmount?: number | null;
  initialPaymentReceivedAt?: string | null;
  handoverStatus: string;
  handoverAt?: string | null;
  handoverRecipient?: string | null;
  checkpoints?: Record<string, { confirmedAt?: string; confirmedBy?: string; note?: string }>;
};

export type BrokerRentalWorkspace = {
  operation: BrokerOperation;
  property: IndustryRecord;
  rentalCase: BrokerRentalCase;
  capture: BrokerCapture | null;
  nextStage: string | null;
  readiness: { ready: boolean; missing: string[]; requirements: Array<{ key: string; label: string; ready: boolean }> };
  options: { applicantStatuses: string[]; guarantorStatuses: string[]; reservationStatuses: string[]; contractStatuses: string[]; initialPaymentStatuses: string[]; handoverStatuses: string[]; };
};

export type BrokerMaintenanceQuote = {
  id: string;
  reference: string;
  scope?: string | null;
  amount: number;
  currency: string;
  validUntil?: string | null;
  status: string;
  providerId?: string | null;
  provider?: { id: string; name: string } | null;
};

export type BrokerMaintenanceWorkspace = {
  record: IndustryRecord;
  maintenance: {
    id: string; updatedAt?: string; category: string; specificType?: string | null; description: string; priority: string; workflowStage: string;
    diagnosis?: string | null; approvalStatus: string; approvedAt?: string | null; scheduledAt?: string | null; providerId?: string | null;
    estimatedCost?: number | null; actualCost?: number | null; completionEvidence?: string | null; resolvedAt?: string | null; acceptedAt?: string | null;
    checkpoints?: Record<string, { confirmedAt?: string; confirmedBy?: string; note?: string }>;
  };
  quotes: BrokerMaintenanceQuote[];
  providers: Array<{ id: string; name: string; specialties?: unknown; averageRating?: number | null }>;
  nextStage: string | null;
  readiness: { ready: boolean; missing: string[]; requirements: Array<{ key: string; label: string; ready: boolean }> };
  options: { stages: string[]; priorities: string[]; approvalStatuses: string[]; quoteStatuses: string[]; projectStatuses: string[]; };
};

export type BrokerProjectWorkspace = {
  record: IndustryRecord;
  project: {
    id: string; updatedAt?: string; name: string; projectType: string; status: string; budget?: number | null; approvedBudget?: number | null; currency: string;
    startAt?: string | null; targetAt?: string | null; completedAt?: string | null; scope?: string | null; acceptanceNotes?: string | null;
    checkpoints?: Record<string, { confirmedAt?: string; confirmedBy?: string; note?: string }>;
  };
  milestones: IndustryRecord[];
  nextStage: string | null;
  readiness: { ready: boolean; missing: string[]; requirements: Array<{ key: string; label: string; ready: boolean }> };
  options: { stages: string[]; priorities: string[]; approvalStatuses: string[]; quoteStatuses: string[]; projectStatuses: string[]; };
};

export type BrokerPostSaleEntity = {
  id: string;
  status: string;
  workflowStage: string;
  checkpoints?: Record<string, { confirmedAt?: string; confirmedBy?: string; note?: string }>;
  [key: string]: unknown;
};

export type BrokerPostSaleWorkspace = {
  record: IndustryRecord;
  kind: "inspection" | "handover" | "case" | "warranty";
  entity: BrokerPostSaleEntity;
  relatedRecords: IndustryRecord[];
  nextStage: string | null;
  readiness: { ready: boolean; missing: string[]; requirements: Array<{ key: string; label: string; ready: boolean }> };
  checkpoints: string[];
  options: { inspectionStages: string[]; handoverStages: string[]; caseStages: string[]; warrantyStages: string[]; priorities: string[]; inspectionTypes: string[]; handoverDirections: string[]; warrantyCoverageTypes: string[]; };
};

export type BrokerOverview = {
  kpis: {
    properties: number;
    activeOperations: number;
    scheduledVisits: number;
    openAlerts: number;
    activeRentals: number;
    openMaintenance: number;
    openPostSale: number;
    activeFinancing: number;
  };
  properties: IndustryRecord[];
  operations: BrokerOperation[];
  agents: BrokerAgent[];
  recommendations: BrokerRecommendation[];
  reporting: BrokerReporting;
  aiTraining: {
    scenarios: BrokerAiScenario[];
    evaluations: BrokerAiEvaluation[];
    automationRules: BrokerAutomationRule[];
  };
};

export type BrokerRecordArea = "commercial" | "rentals" | "maintenance" | "projects" | "post_sale" | "documents" | "financing";

export type BrokerRecordDefinition = {
  label: string;
  area: BrokerRecordArea;
  required: string[];
  statuses: string[];
};

export type BrokerAgent = {
  key: string;
  name: string;
  status: "AVAILABLE" | "PLANNED";
  module: string;
  description: string;
};

export type BrokerAiScenario = {
  key: string;
  agentKey: string;
  area: BrokerRecordArea;
  title: string;
  trigger: string;
  expectedRecommendation: string;
  requiresHumanApproval: boolean;
};

export type BrokerAiEvaluation = IndustryRecord & {
  scenarioKey: string;
  agentKey: string;
  decision: "PENDING_REVIEW" | "CONFIRMED" | "ADJUSTMENT_NEEDED" | "DISCARDED";
  outcome: string;
  note: string;
  reviewedAt: string;
  reviewedBy: string;
};

export type BrokerAutomationRule = {
  key: string;
  title: string;
  trigger: string;
  action: string;
  approval: string;
};

export type BrokerReporting = {
  portfolioValue: number;
  projectedCommission: number;
  propertyCompleteness: number;
  portfolioHealth: number;
  propertiesReady: number;
  byOperationType: Array<{ type: BrokerOperationType; count: number }>;
  aiEvaluations: { total: number; confirmed: number; needsAdjustment: number; pending: number };
};

export type BrokerRecommendation = {
  id: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  area: BrokerRecordArea;
  title: string;
  detail: string;
  propertyId?: string;
  operationId?: string;
  requiresApproval: boolean;
};

export type BrokerPropertyExpedient = {
  property: Pick<IndustryRecord, "id" | "title">;
  records: IndustryRecord[];
  grouped: Partial<Record<BrokerRecordArea, IndustryRecord[]>>;
  completion: { missing: string[]; complete: boolean };
  health: { score: number; status: string; completed: string[]; missing: string[] };
  timeline: Array<{ at: string; title: string; type: string; note: string; recordType: string; status: string }>;
  journey?: { property: { title: string; comuna: string; precio: unknown; estado: string }; people: { propietarios: string[]; interesados: string[] }; control: Record<string, number> };
};

export type BrokerCatalog = {
  areas: Record<BrokerRecordArea, string[]>;
  recordDefinitions: Record<string, BrokerRecordDefinition>;
  agents: BrokerAgent[];
  aiScenarios: BrokerAiScenario[];
  automationRules: BrokerAutomationRule[];
  roleTemplates: Array<{ key: string; label: string; scope: string; permissions: string[] }>;
  sopLibrary: Array<{ key: string; title: string; area: BrokerRecordArea; steps: string[] }>;
  financingStages: string[];
  operationStages: Record<BrokerOperationType, string[]>;
  operationChecklists: Record<BrokerOperationType, Record<string, string[]>>;
};

export type BrokerAccessProfile = {
  businessRole: string;
  profileLabel: string;
  accessScope: "ASSIGNED" | "TEAM" | "BRANCH" | "COMPANY" | "HOLDING";
  requestedScope: string;
  teamKey: string | null;
  branchKey: string | null;
  technicalRole: string;
  scopeDescription: string;
  holding: { id: string; code: string; name: string; tenantCount: number } | null;
  policy: { label: string; defaultScope: string; actions: Record<string, string[]> };
};

export function getBrokerAccess(): Promise<BrokerAccessProfile> {
  return request<BrokerAccessProfile>("/broker/access/me");
}

export type BrokerAccessTeamMember = { id: string; name: string; email: string; role: string; jobTitle: string | null; isActive: boolean; profile: { businessRole: string; accessScope: string; teamKey: string | null; branchKey: string | null } };

export function getBrokerAccessTeam(): Promise<{ users: BrokerAccessTeamMember[] }> {
  return request<{ users: BrokerAccessTeamMember[] }>("/broker/access/team");
}

export function updateBrokerAccessProfile(userId: string, input: { businessRole: string; accessScope: string; teamKey?: string; branchKey?: string }): Promise<{ profile: BrokerAccessTeamMember["profile"] }> {
  return request(`/broker/access/users/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify(input) });
}

export type BrokerHoldingConfig = {
  holding: null | {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    tenants: { id: string; slug: string; name: string; industry: string | null }[];
    accesses: { userId: string; name: string; email: string }[];
  };
  availableTenants: { id: string; slug: string; name: string; industry: string | null }[];
  canConfigure: boolean;
};

export function getBrokerHoldingConfig(): Promise<BrokerHoldingConfig> {
  return request<BrokerHoldingConfig>("/broker/access/holding");
}

export function saveBrokerHoldingConfig(input: { code: string; name: string; tenantSlugs: string[]; userIds: string[] }): Promise<{ holding: { id: string; code: string; name: string } }> {
  return request("/broker/access/holding", { method: "PUT", body: JSON.stringify(input) });
}

export function getBrokerOverview(): Promise<BrokerOverview> {
  return request<BrokerOverview>("/broker/overview");
}

export function getBrokerCatalog(): Promise<BrokerCatalog> {
  return request<BrokerCatalog>("/broker/catalog");
}

export type BrokerCapture = {
  id?: string;
  captureOrigin?: string | null;
  intendedService: "VENTA" | "ARRIENDO" | "ADMINISTRACION" | string;
  status: string;
  captureBrokerId?: string | null;
  firstContactAt?: string | null;
  siteVisitAt?: string | null;
  ownerExpectedPrice?: number | null;
  suggestedPrice?: number | null;
  preliminaryAppraisal?: number | null;
  currency?: string;
  marketAnalysisAt?: string | null;
  comparableSummary?: string | null;
  priceGapPct?: number | null;
  ownerAcceptedEvaluationAt?: string | null;
  preliminaryTitleStatus?: string;
  titleReviewNotes?: string | null;
  regularizationStatus?: string;
  irregularConstructionNote?: string | null;
  ownershipStatus?: string;
  propertyConditionAtHandover?: string | null;
  kitchenType?: string | null;
  heatingSystem?: string | null;
  gasSystem?: string | null;
  buildingFloors?: number | null;
  unitsPerFloor?: number | null;
  elevators?: number | null;
  commonExpenses?: number | null;
  commonAreas?: string[];
  photoUrls?: string[];
  videoUrls?: string[];
  floorPlanUrl?: string | null;
  documentChecklist?: unknown[];
  publicationReadiness?: string;
  rejectionReason?: string | null;
  readiness?: { score: number; missing: string[]; completed: number; total: number; checks: Array<{ key: string; label: string; ready: boolean }> };
};

export type BrokerCapturePayload = {
  property: IndustryRecord;
  capture: BrokerCapture | null;
  readiness: NonNullable<BrokerCapture["readiness"]>;
  options: { statuses: string[]; services: string[]; titleStatuses: string[]; regularizationStatuses: string[]; ownershipStatuses: string[]; readinessStatuses: string[] };
};

export function getBrokerPropertyCapture(propertyId: string): Promise<BrokerCapturePayload> {
  return request<BrokerCapturePayload>(`/broker/properties/${encodeURIComponent(propertyId)}/capture`);
}

export function createBrokerPropertyCapture(input: Record<string, unknown>): Promise<BrokerCapturePayload> {
  return request<BrokerCapturePayload>("/broker/captures", { method: "POST", body: JSON.stringify(input) });
}

export function saveBrokerPropertyCapture(propertyId: string, input: Record<string, unknown>): Promise<BrokerCapturePayload> {
  return request<BrokerCapturePayload>(`/broker/properties/${encodeURIComponent(propertyId)}/capture`, { method: "PUT", body: JSON.stringify(input) });
}

export type BrokerCommissionPreview = {
  ok: boolean;
  error?: string;
  baseAmount?: number;
  commissionRatePct?: number;
  totalCommission?: number;
  brokerSplitPct?: number;
  companySplitPct?: number;
  brokerAmount?: number;
  companyAmount?: number;
};

export type BrokerOperatingPolicy = {
  sales: { sellerCommissionPct: number; buyerCommissionPct: number; brokerSplitPct: number; companySplitPct: number };
  rentalPlacement: { landlordMonths: number; tenantMonths: number; withholdingRatePct: number | null };
  administration: { tiers: Array<{ fromProperties: number; ratePct: number | null; enabled: boolean }>; ownerPaymentDay: number };
  slas: { firstLeadContactMinutes: number; propertyPublicationHours: number; legalReviewHours: number; criticalIncidentHours: number };
  financing: { interestRatePct: number | null; riskThreshold: number | null; requiresHumanApproval: boolean; automaticDisbursement: false };
};

export type BrokerOperatingConfiguration = { policy: BrokerOperatingPolicy; configured: boolean; updatedAt: string | null };
export type BrokerLegalReadiness = {
  providers: Array<{ key: string; label: string; category: string; status: "PENDING_PROVIDER" | "HUMAN_REVIEW" | string; description: string }>;
  consents: IndustryRecord[];
  summary: Record<"PENDING" | "GRANTED" | "REVOKED" | "EXPIRED", number>;
};

export function getBrokerOperatingConfiguration(): Promise<BrokerOperatingConfiguration> {
  return request<BrokerOperatingConfiguration>("/broker/configuration");
}

export function saveBrokerOperatingConfiguration(policy: BrokerOperatingPolicy): Promise<BrokerOperatingConfiguration> {
  return request<BrokerOperatingConfiguration>("/broker/configuration", { method: "PUT", body: JSON.stringify({ policy }) });
}

export function getBrokerLegalReadiness(): Promise<BrokerLegalReadiness> {
  return request<BrokerLegalReadiness>("/broker/legal-readiness");
}

export function previewBrokerCommission(input: { baseAmount: number; commissionRatePct: number; brokerSplitPct?: number; companySplitPct?: number }): Promise<BrokerCommissionPreview> {
  return request<BrokerCommissionPreview>("/broker/commission-preview", { method: "POST", body: JSON.stringify(input) });
}

export type BrokerAdministrationPreview = {
  ok: boolean;
  monthlyRent: number;
  paidAmount: number;
  totalExpenses: number;
  managementRatePct: number;
  managementFee: number;
  ownerTransferAmount: number;
  requiresHumanApproval: true;
  automaticTransfer: false;
};

export function previewBrokerAdministration(input: { monthlyRent: number; paidAmount?: number; commonExpenses?: number; utilities?: number; maintenanceCost?: number; managementRatePct?: number }): Promise<BrokerAdministrationPreview> {
  return request<BrokerAdministrationPreview>("/broker/administration-preview", { method: "POST", body: JSON.stringify(input) });
}

export type BrokerMonthlyAdministrationRow = {
  propertyId: string;
  propertyTitle: string;
  profileId: string;
  ownerName: string;
  tenantName: string;
  monthlyRent: number;
  paidAmount: number;
  commonExpenses: number;
  utilities: number;
  maintenanceCost: number;
  managementRatePct: number;
  ownerPaymentDay: number;
  contractStatus: string;
  paymentCount: number;
  utilityCount: number;
  maintenanceCount: number;
  preview: BrokerAdministrationPreview;
  liquidation: { id: string; title: string; status: "DRAFT" | "PENDING_APPROVAL" | "ISSUED" | "PAID"; data: Record<string, unknown>; updatedAt: string } | null;
  readyToPrepare: boolean;
};

export type BrokerMonthlyAdministration = {
  period: string;
  rows: BrokerMonthlyAdministrationRow[];
  summary: { managedProperties: number; readyToPrepare: number; pendingApproval: number; issued: number; paid: number; expectedRent: number; paidRent: number; proposedOwnerAmount: number };
};

export function getBrokerMonthlyAdministration(period: string): Promise<BrokerMonthlyAdministration> {
  return request<BrokerMonthlyAdministration>(`/broker/administration/monthly?period=${encodeURIComponent(period)}`);
}

export function prepareBrokerMonthlyLiquidation(input: { propertyId: string; period: string; monthlyRent?: number; paidAmount?: number; commonExpenses?: number; utilities?: number; maintenanceCost?: number; managementRatePct?: number }): Promise<IndustryRecord> {
  return request<IndustryRecord>("/broker/administration/monthly/liquidations", { method: "POST", body: JSON.stringify(input) });
}

export function updateBrokerMonthlyLiquidationStatus(id: string, input: { status: "PENDING_APPROVAL" | "ISSUED" | "PAID"; note?: string }): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/broker/administration/monthly/liquidations/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify(input) });
}

export function runBrokerAutomationScan(): Promise<{ recommendations: BrokerRecommendation[]; created: IndustryRecord[]; message: string }> {
  return request("/broker/automation-scan", { method: "POST" });
}

export function getBrokerFinancing(): Promise<IndustryRecord[]> {
  return request<IndustryRecord[]>("/broker/financing");
}

export function advanceBrokerFinancing(id: string, stage: string, note?: string): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/broker/financing/${encodeURIComponent(id)}/stage`, { method: "PATCH", body: JSON.stringify({ stage, note }) });
}

export function getBrokerAiEvaluations(): Promise<{ scenarios: BrokerAiScenario[]; evaluations: BrokerAiEvaluation[]; automationRules: BrokerAutomationRule[] }> {
  return request("/broker/ai-evaluations");
}

export function saveBrokerAiEvaluation(input: {
  scenarioKey: string;
  decision: BrokerAiEvaluation["decision"];
  outcome?: string;
  note?: string;
}): Promise<BrokerAiEvaluation> {
  return request("/broker/ai-evaluations", { method: "POST", body: JSON.stringify(input) });
}

export function getBrokerPropertyExpedient(propertyId: string): Promise<BrokerPropertyExpedient> {
  return request<BrokerPropertyExpedient>(`/broker/properties/${encodeURIComponent(propertyId)}/expedient`);
}

export function getBrokerOperations(type?: BrokerOperationType): Promise<BrokerOperation[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<BrokerOperation[]>(`/broker/operations${query}`);
}

export function createBrokerOperation(input: {
  title: string;
  operationType: BrokerOperationType;
  propertyId?: string;
  buyerId?: string;
  assignedToId?: string;
  stage?: string;
  data?: Record<string, unknown>;
}): Promise<BrokerOperation> {
  return request<BrokerOperation>("/broker/operations", { method: "POST", body: JSON.stringify(input) });
}

export function advanceBrokerOperation(id: string, input: { stage: string; note?: string }): Promise<BrokerOperation> {
  return request<BrokerOperation>(`/broker/operations/${encodeURIComponent(id)}/stage`, { method: "PATCH", body: JSON.stringify(input) });
}

export function getBrokerSaleWorkspace(operationId: string): Promise<BrokerSaleWorkspace> {
  return request<BrokerSaleWorkspace>(`/broker/sales/${encodeURIComponent(operationId)}`);
}

export function saveBrokerSaleWorkspace(operationId: string, input: Partial<BrokerSaleCase>): Promise<BrokerSaleWorkspace> {
  return request<BrokerSaleWorkspace>(`/broker/sales/${encodeURIComponent(operationId)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function confirmBrokerSaleCheckpoint(operationId: string, input: { checkpoint: "oferta" | "promesa" | "titulos" | "escritura" | "inscripcion" | "entrega"; note?: string }): Promise<BrokerSaleWorkspace> {
  return request<BrokerSaleWorkspace>(`/broker/sales/${encodeURIComponent(operationId)}/confirmations`, { method: "POST", body: JSON.stringify(input) });
}

export function getBrokerRentalWorkspace(operationId: string): Promise<BrokerRentalWorkspace> {
  return request<BrokerRentalWorkspace>(`/broker/rentals/${encodeURIComponent(operationId)}`);
}

export function saveBrokerRentalWorkspace(operationId: string, input: Partial<BrokerRentalCase>): Promise<BrokerRentalWorkspace> {
  return request<BrokerRentalWorkspace>(`/broker/rentals/${encodeURIComponent(operationId)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function confirmBrokerRentalCheckpoint(operationId: string, input: { checkpoint: "evaluacion" | "reserva" | "contrato" | "pago_inicial" | "entrega"; note?: string }): Promise<BrokerRentalWorkspace> {
  return request<BrokerRentalWorkspace>(`/broker/rentals/${encodeURIComponent(operationId)}/confirmations`, { method: "POST", body: JSON.stringify(input) });
}

export function getBrokerMaintenanceWorkspace(recordId: string): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/workspace`);
}
export function saveBrokerMaintenanceWorkspace(recordId: string, input: Partial<BrokerMaintenanceWorkspace["maintenance"]> & { providerName?: string }): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/workspace`, { method: "PUT", body: JSON.stringify(input) });
}
export function addBrokerMaintenanceQuote(recordId: string, input: { providerId?: string; providerName?: string; reference: string; scope?: string; amount: number; validUntil?: string | null; status?: string }): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/quotes`, { method: "POST", body: JSON.stringify(input) });
}
export function selectBrokerMaintenanceQuote(recordId: string, quoteId: string): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/quotes/${encodeURIComponent(quoteId)}/select`, { method: "POST" });
}
export function confirmBrokerMaintenanceCheckpoint(recordId: string, input: { checkpoint: "diagnostico" | "aprobacion" | "recepcion"; note?: string }): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/confirmations`, { method: "POST", body: JSON.stringify(input) });
}
export function advanceBrokerMaintenance(recordId: string, stage: string): Promise<BrokerMaintenanceWorkspace> {
  return request<BrokerMaintenanceWorkspace>(`/broker/maintenance/${encodeURIComponent(recordId)}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
}
export function getBrokerProjectWorkspace(recordId: string): Promise<BrokerProjectWorkspace> {
  return request<BrokerProjectWorkspace>(`/broker/projects/${encodeURIComponent(recordId)}/workspace`);
}
export function saveBrokerProjectWorkspace(recordId: string, input: Partial<BrokerProjectWorkspace["project"]>): Promise<BrokerProjectWorkspace> {
  return request<BrokerProjectWorkspace>(`/broker/projects/${encodeURIComponent(recordId)}/workspace`, { method: "PUT", body: JSON.stringify(input) });
}
export function confirmBrokerProjectCheckpoint(recordId: string, input: { checkpoint: "aprobacion" | "ejecucion" | "recepcion"; note?: string }): Promise<BrokerProjectWorkspace> {
  return request<BrokerProjectWorkspace>(`/broker/projects/${encodeURIComponent(recordId)}/confirmations`, { method: "POST", body: JSON.stringify(input) });
}
export function advanceBrokerProject(recordId: string, stage: string): Promise<BrokerProjectWorkspace> {
  return request<BrokerProjectWorkspace>(`/broker/projects/${encodeURIComponent(recordId)}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
}
export function getBrokerPostSaleWorkspace(recordId: string): Promise<BrokerPostSaleWorkspace> {
  return request<BrokerPostSaleWorkspace>(`/broker/post-sale/${encodeURIComponent(recordId)}/workspace`);
}
export function saveBrokerPostSaleWorkspace(recordId: string, input: Record<string, unknown>): Promise<BrokerPostSaleWorkspace> {
  return request<BrokerPostSaleWorkspace>(`/broker/post-sale/${encodeURIComponent(recordId)}/workspace`, { method: "PUT", body: JSON.stringify(input) });
}
export function confirmBrokerPostSaleCheckpoint(recordId: string, input: { checkpoint: string; note?: string }): Promise<BrokerPostSaleWorkspace> {
  return request<BrokerPostSaleWorkspace>(`/broker/post-sale/${encodeURIComponent(recordId)}/confirmations`, { method: "POST", body: JSON.stringify(input) });
}
export function advanceBrokerPostSale(recordId: string, stage: string): Promise<BrokerPostSaleWorkspace> {
  return request<BrokerPostSaleWorkspace>(`/broker/post-sale/${encodeURIComponent(recordId)}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
}

export function addBrokerOperationEvent(id: string, input: { note: string; type?: string }): Promise<BrokerOperation> {
  return request<BrokerOperation>(`/broker/operations/${encodeURIComponent(id)}/timeline`, { method: "POST", body: JSON.stringify(input) });
}

export function getBrokerRecords(area: BrokerRecordArea): Promise<IndustryRecord[]> {
  return request<IndustryRecord[]>(`/broker/records/${encodeURIComponent(area)}`);
}

export function createBrokerRecord(input: {
  recordType: string;
  title: string;
  status?: string;
  assignedToId?: string;
  propertyId?: string;
  data?: Record<string, unknown>;
}): Promise<IndustryRecord> {
  return request<IndustryRecord>("/broker/records", { method: "POST", body: JSON.stringify(input) });
}

export function updateBrokerRecord(id: string, input: { title?: string; status?: string; data?: Record<string, unknown> }): Promise<IndustryRecord> {
  return request<IndustryRecord>(`/broker/records/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function createRealtyPropertyCampaignDraft(propertyId: string, input: { platforms?: CampaignPlatform[]; variantCount?: number; tone?: string } = {}): Promise<CampaignProResult> {
  return request<CampaignProResult>(`/campaigns/realty/property/${encodeURIComponent(propertyId)}/draft`, {
    method: "POST",
    body: JSON.stringify(input)
  });
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
  governance?: {
    requireApprovalFor: string[];
    maxAutonomousActions: number;
    blockedTerms: string[];
    recordEvaluations: boolean;
    maxAiRepliesPerDay: number | null;
    monthlyCostLimit: number | null;
  };
};

export type AiGovernanceRecord = {
  id: string;
  title: string;
  status: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
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

export async function getAiGovernance(): Promise<{ governance: NonNullable<AISettings["governance"]>; usageLimits: { allowed: boolean; reason: string | null; usage: { dailyReplies: number; monthlyReplies: number; monthlyCost: number } }; approvals: AiGovernanceRecord[]; evaluations: AiGovernanceRecord[] }> {
  return request("/saas/ai-governance");
}

export async function createAiEvaluation(input: { scenario: string; output: string; expected?: string }) {
  return request<{ record: AiGovernanceRecord; result: { passed: boolean; matches: string[]; score: number } }>("/saas/ai-evaluations", {
    method: "POST", body: JSON.stringify(input)
  });
}

export async function approveAiAction(id: string) {
  return request<{ approval: AiGovernanceRecord; result: { ok: boolean; message?: string } }>(`/saas/ai-approvals/${id}/approve`, { method: "POST" });
}

export async function rejectAiAction(id: string, reason?: string) {
  return request<{ approval: AiGovernanceRecord }>(`/saas/ai-approvals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
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
  allEntities?: Array<{
    recordType?: string;
    label?: string;
    industry?: string;
    industryLabel?: string;
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

export type WorkflowRun = {
  id: string;
  tenantId: string;
  recordType: "workflow_run";
  title: string;
  status: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDeadLetter = {
  id: string;
  tenantId: string;
  recordType: "workflow_dead_letter";
  title: string;
  status: "OPEN" | "RESOLVED" | string;
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

export async function deleteTenantDocument(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/documents/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
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
  return request<{ run: WorkflowRun; conditions?: unknown; applied?: unknown[] }>(`/workflows/${id}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getWorkflowVersions(id: string): Promise<{ versions: WorkflowDefinition[] }> {
  return request<{ versions: WorkflowDefinition[] }>(`/workflows/${id}/versions`);
}

export async function getWorkflowRuns(id: string): Promise<{ runs: WorkflowRun[] }> {
  return request<{ runs: WorkflowRun[] }>(`/workflows/${id}/runs`);
}

export async function getWorkflowDeadLetters(status = "OPEN"): Promise<{ deadLetters: WorkflowDeadLetter[] }> {
  return request<{ deadLetters: WorkflowDeadLetter[] }>(`/workflow-dead-letters?status=${encodeURIComponent(status)}`);
}

export async function retryWorkflowDeadLetter(id: string) {
  return request<{ run: WorkflowRun; conditions?: unknown; applied?: unknown[] }>(`/workflow-dead-letters/${id}/retry`, {
    method: "POST"
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

export type ConnectionStatus = "CONNECTED" | "PENDING" | "DISCONNECTED" | "ERROR" | "COMING_SOON";

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
  availability?: "AVAILABLE" | "COMING_SOON" | string;
  requiredEnv: string[];
  oauthRequiredEnv?: string[];
  requiredFields: string[];
  scopes: string[];
  missing: string[];
  oauthReady?: boolean;
  missingOAuthEnvironment?: string[];
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
  reconciliation?: {
    scanned: number;
    active: number;
    inactive: number;
    incomplete: number;
    unrecognized: number;
    items: Array<{
      channel: string;
      provider?: string;
      label: string;
      status: "ACTIVE" | "INACTIVE" | "INCOMPLETE" | "UNRECOGNIZED";
      missing?: string[];
      reason?: string;
      updatedAt?: string;
    }>;
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

export async function reconcileMetaConnections(): Promise<{ ok: boolean; sourceChannel: string; assetsDetected: { facebook: boolean; instagram: boolean; whatsapp: boolean }; updates: Array<{ provider: string; channel: string; status: string }> }> {
  return request("/connections/meta/reconcile", { method: "POST" });
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

export async function syncNuboxSales(period?: string): Promise<{ ok: boolean; period: string; received: number; total: number; created: number; updated: number; ignored: number }> {
  return request<{ ok: boolean; period: string; received: number; total: number; created: number; updated: number; ignored: number }>("/connections/finance_nubox/sync", {
    method: "POST",
    body: JSON.stringify(period ? { period } : {})
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
