export type AgentSession = {
  id: string;
  tenantId?: string;
  name: string;
  email: string;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  role?: string;
};

export type TenantSession = {
  id: string;
  name: string;
  slug: string;
  type?: string;
  industry?: string | null;
  plan?: string | null;
};

export type Conversation = {
  id: string;
  tenantId: string;
  contactId: string;
  status: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED" | string;
  mode: "BOT" | "HUMAN" | "HYBRID" | string;
  assignedToId: string | null;
  priorityLabel?: string | null;
  priorityScore?: number | null;
  aiSummary?: string | null;
  aiSuggestedReply?: string | null;
  aiCloseScore?: number | null;
  aiHandoffRequired?: boolean | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string | null;
    externalId: string;
    channel: string;
    username: string | null;
  };
  lastMessage?: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    content: string;
    status: string;
    channel: string;
    createdAt: string;
  } | null;
  messageCount?: number;
};

export type Message = {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  channel: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
};

export type Booking = {
  id: string;
  tenantId: string;
  conversationId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  date: string;
  guests: number;
  location?: string | null;
  total: number;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  template?: any;
  scheduledAt?: string | null;
  sentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
    pending: number;
    estimated: number;
    pipeline: number;
  };
  pipeline: Array<{ stage: string; count: number; value: number }>;
  activity: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    createdAt: string;
    conversationId?: string | null;
    amount?: number;
  }>;
  upcomingBookings: Booking[];
};

export type TenantModulesResponse = {
  tenantId: string;
  plan: string;
  modules: string[];
};

export type AdminTenant = {
  id: string;
  name: string;
  slug: string;
  industry?: string | null;
  plan?: string | null;
  tenantModules?: Array<{ id: string; module: string; enabled: boolean; source?: string }>;
};
