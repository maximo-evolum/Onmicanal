export type Conversation = {
  id: string;
  tenantId: string;
  contactId: string;
  status: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
  mode: "BOT" | "HUMAN" | "HYBRID";
  assignedToId: string | null;
  priorityLabel?: "high" | "medium" | "low" | string | null;
  priorityScore?: number | null;
  lastIntent?: string | null;
  lastConfidence?: number | null;
  decisionSummary?: string | null;
  aiSummary?: string | null;
  aiNextAction?: string | null;
  aiSuggestedReply?: string | null;
  aiLeadScore?: number | null;
  aiReason?: string | null;
  aiDecisionLabel?: string | null;
  aiDecisionReason?: string | null;
  aiNextActionCode?: string | null;
  aiCloseScore?: number | null;
  aiHandoffRequired?: boolean | null;
  aiHandoffReason?: string | null;
  aiWorkflowState?: string | null;
  aiWorkflowPlan?: string | null;
  aiStrategy?: string | null;
  aiRecommendedAction?: string | null;
  aiCustomerProfile?: Record<string, unknown> | null;
  aiReasoningSummary?: string | null;
  aiFeedbackSummary?: string | null;
  aiRecoveryPlan?: string | null;
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
  assignedTo?: {
    id: string;
    name: string;
    email: string;
  } | null;
  lead?: Lead | null;
  tenant?: TenantSession | null;
  channelConfig?: {
    id?: string;
    channel?: string;
    label?: string | null;
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    externalAccountId?: string | null;
    displayNumber?: string | null;
    isActive?: boolean;
  } | null;
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
  createdAt: string;
};

export type AgentSession = {
  id: string;
  tenantId?: string;
  name: string;
  email: string;
  role?: string;
};


export type Lead = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string | null;
  interest: string | null;
  propertyType: string | null;
  commune: string | null;
  budget: number | null;
  urgency: string | null;
  customFields?: Record<string, string | number | boolean | null> | null;
  status: string;
  notes?: string | null;
  closeProbability?: number | null;
  closeReason?: string | null;
  lastContactAt?: string | null;
  nextFollowUpAt?: string | null;
  followUpCount?: number;
  aiStrategy?: string | null;
  aiRecommendedAction?: string | null;
  aiRiskLevel?: string | null;
  aiUrgencyLevel?: string | null;
  aiReasoningSummary?: string | null;
  conversation?: Conversation;
  createdAt?: string;
  updatedAt?: string;
};

export type TenantSession = {
  id: string;
  name: string;
  slug: string;
  type?: "PERSONAL" | "BUSINESS" | string;
  industry?: string | null;
  plan?: string | null;
};

export type EnabledModule = "inbox" | "sales" | "marketing" | "bookings" | "payments" | "followups" | "analytics" | "bot_lab" | string;

export type LeadMetrics = {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  conversionRate: number;
  estimatedRevenue: number;
  averageCloseProbability: number;
  alerts: {
    hotLeads: number;
    staleLeads: number;
    urgentUnanswered: number;
  };
};

export type Campaign = {
  id: string;
  tenantId: string;
  name: string;
  segment: string;
  template: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};
