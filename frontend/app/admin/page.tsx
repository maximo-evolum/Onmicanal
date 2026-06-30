"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AdminTenant,
  createAdminTenant,
  createIndustryTemplate,
  createAdminTenantUser,
  getAdminTenants,
  getIndustryTemplates,
  getModuleCatalog,
  applyAdminTenantIndustryTemplate,
  updateAdminTenant,
  updateAdminTenantBilling,
  updateAdminTenantAiProfile,
  updateAdminTenantChannelConfig,
  updateAdminTenantModules,
  updateAdminUser,
  updateTenantPlan,
  uploadAdminTenantOnboardingFiles,
  applyAdminTenantOnboardingExtraction,
  deleteAdminTenant,
  deleteAdminUser,
  type IndustryTemplate,
  type OnboardingExtraction,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { EvolumSidebar } from "@/components/evolum-sidebar";

const PLANS = ["STARTER", "PRO", "BUSINESS", "ENTERPRISE"];
const ROLES = ["OWNER", "ADMIN", "AGENT", "SELLER", "VIEWER"];
const PLAN_RANK: Record<string, number> = { STARTER: 1, PRO: 2, BUSINESS: 3, ENTERPRISE: 4 };
const MODULE_LABELS: Record<string, string> = {
  inbox: "Inbox",
  sales: "Ventas",
  marketing: "Marketing",
  bookings: "Reservas",
  payments: "Pagos",
  followups: "Follow-ups",
  analytics: "Analytics",
  bot_lab: "Bot Lab",
  agenda: "Agenda",
  pipeline: "Pipeline",
  campaigns: "Campañas",
  dashboard: "Dashboard",
  ai_ops: "AI Ops / Cierres IA",
  onboarding: "Configuracion de Agente",
  saas: "Planes y modulos",
  users: "Usuarios y roles",
  integrations: "Integraciones",
  developer: "Desarrollador",
  properties: "Propiedades",
  property_assignments: "Asignacion de ventas",
  customers: "Clientes",
  revenue: "Ganancias",
  vehicles: "Vehiculos",
  parts_inventory: "Repuestos",
  mechanic_assignments: "Asignacion de mecanicos",
  ready_notifications: "Aviso de retiro",
};

const PROJECT_MODULE_CATALOG = [
  "inbox",
  "agenda",
  "pipeline",
  "campaigns",
  "payments",
  "onboarding",
  "saas",
  "users",
  "dashboard",
  "ai_ops",
  "integrations",
  "properties",
  "property_assignments",
  "customers",
  "revenue",
  "vehicles",
  "parts_inventory",
  "mechanic_assignments",
  "ready_notifications",
  "sales",
  "marketing",
  "bookings",
  "followups",
  "analytics",
  "bot_lab",
];

const emptyClient = {
  name: "",
  slug: "",
  industry: "",
  type: "BUSINESS",
  plan: "STARTER",
  ownerName: "",
  ownerEmail: "",
  ownerPassword: "",
  whatsappPhoneNumberId: "",
  whatsappBusinessAccountId: "",
  whatsappDisplayNumber: "",
  metaAccessToken: "",
  metaAppSecret: "",
  verifyToken: "",
  instagramBusinessAccountId: "",
  instagramPageId: "",
  facebookPageId: "",
};

const emptyUser = {
  name: "",
  email: "",
  role: "AGENT",
  password: "",
};

const emptyIndustryForm = {
  name: "",
  code: "",
  summary: "",
  workflowsText: "",
  entitiesText: "",
};

const emptyWhatsAppConfig = {
  label: "WhatsApp principal",
  phoneNumberId: "",
  businessAccountId: "",
  displayNumber: "",
  accessToken: "",
  verifyToken: "",
  isActive: true,
};

const emptyInstagramConfig = {
  label: "Instagram principal",
  externalAccountId: "",
  businessAccountId: "",
  accessToken: "",
  verifyToken: "",
  pageId: "",
  isActive: true,
};

const emptyFacebookConfig = {
  label: "Facebook principal",
  pageId: "",
  businessAccountId: "",
  accessToken: "",
  verifyToken: "",
  isActive: true,
};

const emptyBillingForm = {
  planCode: "STARTER",
  planName: "Starter",
  monthlyPrice: "0",
  currency: "CLP",
  description: "",
  messagesMonthly: "",
  users: "",
};

const emptyAiProfile = {
  name: "IA principal",
  industry: "",
  basePersona: "",
  tone: "cercano y profesional",
  objective: "resolver dudas, recomendar y avanzar hacia venta/agendamiento",
  responseStyle: "breve, natural y orientado a acción",
  businessRulesText: "",
};

const emptyImportManual = {
  businessName: "",
  industry: "",
  description: "",
  tone: "cercano y profesional",
  objective: "resolver dudas, recomendar productos/servicios y avanzar hacia venta",
  restrictions: "No inventar precios, stock ni políticas. Si falta información, pedir confirmación."
};

function normalizePlanLabel(plan?: string | null) {
  const value = String(plan || "").trim().toUpperCase();
  if (["FREE", "STARTER", "BASIC", "BASICA", "MVP", "DEMO"].includes(value)) return "STARTER";
  if (["NORMAL", "PRO"].includes(value)) return "PRO";
  if (["BUSINESS", "ADVANCED", "AVANZADA"].includes(value)) return "BUSINESS";
  if (["ENTERPRISE", "PRO_MAX", "PROFESSIONAL"].includes(value)) return "ENTERPRISE";
  return value || "STARTER";
}

function asArrayRules(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => String(item));
  return [];
}

function enabledModulesOf(tenant: AdminTenant) {
  return (tenant.tenantModules || []).filter((item) => item.enabled).map((item) => item.module);
}

function activeSubscriptionOf(tenant: AdminTenant | null) {
  return tenant?.subscriptions?.[0] || null;
}

function subscriptionMetadata(tenant: AdminTenant | null) {
  const metadata = activeSubscriptionOf(tenant)?.metadata;
  return metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
}

function numberOrEmpty(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function planAllows(moduleMinPlan: string | undefined, currentPlan: string) {
  const minRank = PLAN_RANK[normalizePlanLabel(moduleMinPlan)] || PLAN_RANK.STARTER;
  const currentRank = PLAN_RANK[normalizePlanLabel(currentPlan)] || PLAN_RANK.STARTER;
  return minRank <= currentRank;
}

function templateModulesForPlan(template: IndustryTemplate | null, plan: string) {
  return (template?.modules || []).filter((module) => planAllows(module.minPlan, plan));
}

function moduleToTemplateItem(module: string) {
  return {
    key: module,
    label: MODULE_LABELS[module] || module,
    description: "",
    minPlan: "STARTER"
  };
}


export default function AdminPage() {
  const [mounted, setMounted] = useState(false);
  const [agent, setAgent] = useState<ReturnType<typeof getStoredSession>>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    setAgent(getStoredSession());
    setMounted(true);
  }, []);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moduleCatalog, setModuleCatalog] = useState<string[]>([]);
  const [industryTemplates, setIndustryTemplates] = useState<IndustryTemplate[]>([]);
  const [pendingModules, setPendingModules] = useState<string[]>([]);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [userForm, setUserForm] = useState(emptyUser);
  const [industryForm, setIndustryForm] = useState(emptyIndustryForm);
  const [whatsappForm, setWhatsappForm] = useState(emptyWhatsAppConfig);
  const [instagramForm, setInstagramForm] = useState(emptyInstagramConfig);
  const [facebookForm, setFacebookForm] = useState(emptyFacebookConfig);
  const [aiForm, setAiForm] = useState(emptyAiProfile);
  const [billingForm, setBillingForm] = useState(emptyBillingForm);
  const [importManual, setImportManual] = useState(emptyImportManual);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importExtraction, setImportExtraction] = useState<OnboardingExtraction | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [replaceProducts, setReplaceProducts] = useState(false);
  const [replaceFaqs, setReplaceFaqs] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [tenantData, catalog, industries] = await Promise.all([
        getAdminTenants(),
        getModuleCatalog().catch(() => null),
        getIndustryTemplates().catch(() => null),
      ]);
      setTenants(tenantData);
      if (!selectedId && tenantData[0]) setSelectedId(tenantData[0].id);
      if (catalog?.modules) setModuleCatalog(Object.values(catalog.modules));
      if (industries?.templates) setIndustryTemplates(industries.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el panel admin");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedId) || tenants[0] || null,
    [selectedId, tenants],
  );

  useEffect(() => {
    if (!selectedTenant) return;

    setPendingModules(enabledModulesOf(selectedTenant));

    const whatsapp = selectedTenant.channelConfigs?.find((item) => item.channel === "whatsapp");
    const instagram = selectedTenant.channelConfigs?.find((item) => item.channel === "instagram");
    const facebook = selectedTenant.channelConfigs?.find((item) => item.channel === "facebook");
    const profile = selectedTenant.aiProfiles?.find((item) => item.code === "default") || selectedTenant.aiProfiles?.[0];
    const subscription = activeSubscriptionOf(selectedTenant);
    const metadata = subscriptionMetadata(selectedTenant);
    const limits = metadata.limits && typeof metadata.limits === "object" ? metadata.limits as Record<string, unknown> : {};

    setBillingForm({
      planCode: subscription?.planCode || selectedTenant.plan || "STARTER",
      planName: String(metadata.planName || subscription?.plan?.name || selectedTenant.plan || "Starter"),
      monthlyPrice: numberOrEmpty(metadata.monthlyPrice ?? metadata.priceMonthly ?? subscription?.plan?.priceMonthly ?? ""),
      currency: String(metadata.currency || subscription?.plan?.currency || "CLP"),
      description: String(metadata.description || ""),
      messagesMonthly: numberOrEmpty(limits.messagesMonthly),
      users: numberOrEmpty(limits.users),
    });

    const whatsappMetadata = typeof whatsapp?.metadata === "object" && whatsapp?.metadata
      ? whatsapp.metadata as Record<string, unknown>
      : {};

    setWhatsappForm({
      label: whatsapp?.label || "WhatsApp principal",
      phoneNumberId: whatsapp?.phoneNumberId || selectedTenant.whatsappPhoneNumberId || "",
      businessAccountId: whatsapp?.businessAccountId || "",
      displayNumber: String(whatsappMetadata.displayNumber || whatsappMetadata.whatsappDisplayNumber || ""),
      accessToken: whatsapp?.accessToken || "",
      verifyToken: whatsapp?.verifyToken || "",
      isActive: whatsapp?.isActive ?? true,
    });

    setInstagramForm({
      label: instagram?.label || "Instagram principal",
      externalAccountId: instagram?.externalAccountId || selectedTenant.instagramBusinessAccountId || "",
      businessAccountId: instagram?.businessAccountId || "",
      accessToken: instagram?.accessToken || "",
      verifyToken: instagram?.verifyToken || "",
      pageId: typeof instagram?.metadata === "object" && instagram?.metadata ? String((instagram.metadata as Record<string, unknown>).pageId || "") : "",
      isActive: instagram?.isActive ?? true,
    });

    const facebookMetadata = typeof facebook?.metadata === "object" && facebook?.metadata
      ? facebook.metadata as Record<string, unknown>
      : {};

    setFacebookForm({
      label: facebook?.label || "Facebook principal",
      pageId: facebook?.externalAccountId || facebook?.businessAccountId || String(facebookMetadata.pageId || ""),
      businessAccountId: facebook?.businessAccountId || "",
      accessToken: facebook?.accessToken || "",
      verifyToken: facebook?.verifyToken || "",
      isActive: facebook?.isActive ?? true,
    });

    setAiForm({
      name: profile?.name || `IA ${selectedTenant.name}`,
      industry: profile?.industry || selectedTenant.industry || "",
      basePersona: profile?.basePersona || selectedTenant.businessPrompt || "",
      tone: profile?.tone || "cercano y profesional",
      objective: profile?.objective || "resolver dudas, recomendar y avanzar hacia venta/agendamiento",
      responseStyle: profile?.responseStyle || "breve, natural y orientado a acción",
      businessRulesText: asArrayRules(profile?.businessRules).join("\n"),
    });

    setImportManual({
      businessName: selectedTenant.name || "",
      industry: selectedTenant.industry || "",
      description: selectedTenant.businessPrompt || profile?.basePersona || "",
      tone: profile?.tone || "cercano y profesional",
      objective: profile?.objective || "resolver dudas, recomendar productos/servicios y avanzar hacia venta",
      restrictions: asArrayRules(profile?.businessRules).join("\n") || emptyImportManual.restrictions,
    });
    setImportFiles([]);
    setImportExtraction(null);
    setImportId(null);
  }, [selectedTenant]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((tenant) =>
      [tenant.name, tenant.slug, tenant.industry, tenant.plan].some((value) => String(value || "").toLowerCase().includes(q)),
    );
  }, [query, tenants]);

  const totals = useMemo(() => {
    const users = tenants.reduce((acc, tenant) => acc + (tenant.workspaceUsers?.length || 0), 0);
    const activeModules = tenants.reduce((acc, tenant) => acc + enabledModulesOf(tenant).length, 0);
    const business = tenants.filter((tenant) => {
      const plan = normalizePlanLabel(tenant.plan);
      return plan === "BUSINESS" || plan === "ENTERPRISE";
    }).length;
    return { users, activeModules, business };
  }, [tenants]);

  const moduleDirty = useMemo(() => {
    if (!selectedTenant) return false;
    const saved = [...enabledModulesOf(selectedTenant)].sort().join("|");
    const pending = [...pendingModules].sort().join("|");
    return saved !== pending;
  }, [selectedTenant, pendingModules]);

  const availableModules = useMemo(() => {
    const industryModules = industryTemplates.flatMap((template) => template.modules.map((module) => module.key));
    const merged = new Set([...PROJECT_MODULE_CATALOG, ...moduleCatalog, ...industryModules]);
    return Array.from(merged);
  }, [industryTemplates, moduleCatalog]);

  const selectedIndustryTemplate = useMemo(() => {
    if (!selectedTenant) return null;
    const industry = String(selectedTenant.industry || "").toLowerCase();
    return industryTemplates.find((template) =>
      template.code.toLowerCase() === industry ||
      template.name.toLowerCase() === industry ||
      industry.includes(template.name.toLowerCase())
    ) || industryTemplates.find((template) => template.code === "GENERAL") || null;
  }, [industryTemplates, selectedTenant]);

  const selectedPlanCode = normalizePlanLabel(billingForm.planCode || selectedTenant?.plan || "STARTER");
  const selectedIndustryModules = useMemo(
    () => templateModulesForPlan(selectedIndustryTemplate, selectedPlanCode),
    [selectedIndustryTemplate, selectedPlanCode],
  );

  function updateTenantLocal(updated: AdminTenant) {
    setTenants((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedId(updated.id);
  }

  async function handleCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSavingId("new-tenant");
      setError(null);
      setSuccess(null);
      const tenant = await createAdminTenant(clientForm);
      setTenants((items) => [tenant, ...items]);
      setSelectedId(tenant.id);
      setClientForm(emptyClient);
      setSuccess("Cliente creado y módulos iniciales asignados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el cliente");
    } finally {
      setSavingId(null);
    }
  }

  async function handlePlanChange(tenantId: string, plan: string) {
    try {
      setSavingId(tenantId);
      setError(null);
      const result = await updateTenantPlan(tenantId, plan);
      if (result.tenant) updateTenantLocal(result.tenant as AdminTenant);
      await load();
      setSuccess("Plan actualizado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el plan");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveBilling() {
    if (!selectedTenant) return;
    try {
      setSavingId(`billing-${selectedTenant.id}`);
      setError(null);
      setSuccess(null);
      const result = await updateAdminTenantBilling(selectedTenant.id, {
        planCode: billingForm.planCode,
        planName: billingForm.planName,
        monthlyPrice: Number(String(billingForm.monthlyPrice || "0").replace(/[^\d.-]/g, "")) || 0,
        currency: billingForm.currency || "CLP",
        description: billingForm.description,
        messagesMonthly: billingForm.messagesMonthly === "" ? null : Number(billingForm.messagesMonthly),
        users: billingForm.users === "" ? null : Number(billingForm.users),
      });
      if (result.tenant) updateTenantLocal(result.tenant);
      setSuccess("Precio mensual y límites del cliente actualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el precio mensual");
    } finally {
      setSavingId(null);
    }
  }

  async function handleTenantField(field: keyof Pick<AdminTenant, "name" | "slug" | "industry" | "type" | "whatsappPhoneNumberId" | "instagramBusinessAccountId">, value: string) {
    if (!selectedTenant) return;
    try {
      setSavingId(`tenant-${selectedTenant.id}`);
      setError(null);
      const updated = await updateAdminTenant(selectedTenant.id, { [field]: value });
      updateTenantLocal(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el cliente");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveChannel(channel: "whatsapp" | "instagram" | "facebook") {
    if (!selectedTenant) return;
    try {
      setSavingId(`channel-${channel}`);
      setError(null);
      setSuccess(null);
      const payload = channel === "whatsapp"
        ? {
            label: whatsappForm.label,
            phoneNumberId: whatsappForm.phoneNumberId,
            businessAccountId: whatsappForm.businessAccountId,
            displayNumber: whatsappForm.displayNumber,
            accessToken: whatsappForm.accessToken,
            verifyToken: whatsappForm.verifyToken,
            isActive: whatsappForm.isActive,
          }
        : channel === "instagram"
          ? {
              label: instagramForm.label,
              externalAccountId: instagramForm.externalAccountId,
              businessAccountId: instagramForm.businessAccountId,
              accessToken: instagramForm.accessToken,
              verifyToken: instagramForm.verifyToken,
              metadata: { pageId: instagramForm.pageId },
              isActive: instagramForm.isActive,
            }
          : {
              label: facebookForm.label,
              externalAccountId: facebookForm.pageId,
              businessAccountId: facebookForm.businessAccountId,
              accessToken: facebookForm.accessToken,
              verifyToken: facebookForm.verifyToken,
              metadata: { pageId: facebookForm.pageId },
              isActive: facebookForm.isActive,
            };
      const updated = await updateAdminTenantChannelConfig(selectedTenant.id, channel, payload);
      updateTenantLocal(updated);
      setSuccess(`Configuracion ${channel === "whatsapp" ? "WhatsApp" : channel === "instagram" ? "Instagram" : "Facebook"} guardada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el canal");
    } finally {
      setSavingId(null);
    }
  }
  async function handleSaveAiProfile() {
    if (!selectedTenant) return;
    try {
      setSavingId(`ai-${selectedTenant.id}`);
      setError(null);
      setSuccess(null);
      const updated = await updateAdminTenantAiProfile(selectedTenant.id, {
        code: "default",
        name: aiForm.name,
        industry: aiForm.industry,
        basePersona: aiForm.basePersona,
        tone: aiForm.tone,
        objective: aiForm.objective,
        responseStyle: aiForm.responseStyle,
        businessRules: aiForm.businessRulesText.split("\n").map((item) => item.trim()).filter(Boolean),
        isActive: true,
      });
      updateTenantLocal(updated);
      setSuccess("Perfil IA del cliente guardado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el perfil IA");
    } finally {
      setSavingId(null);
    }
  }

  async function handleExtractAdminOnboarding() {
    if (!selectedTenant) return;
    if (!importFiles.length) {
      setError("Sube al menos un archivo CSV, Excel, PDF o TXT.");
      return;
    }
    try {
      setSavingId(`extract-${selectedTenant.id}`);
      setError(null);
      setSuccess(null);
      const result = await uploadAdminTenantOnboardingFiles({
        tenantId: selectedTenant.id,
        files: importFiles,
        ...importManual,
      });
      setImportId(result.importId);
      setImportExtraction(result.extraction);
      setSuccess("Extracción IA lista. Revisa productos, FAQs y políticas antes de aplicar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo extraer la información");
    } finally {
      setSavingId(null);
    }
  }

  async function handleApplyAdminOnboarding() {
    if (!selectedTenant || !importExtraction) return;
    try {
      setSavingId(`apply-${selectedTenant.id}`);
      setError(null);
      setSuccess(null);
      const result = await applyAdminTenantOnboardingExtraction({
        tenantId: selectedTenant.id,
        importId: importId || undefined,
        extraction: importExtraction,
        replaceProducts,
        replaceFaqs,
      });
      if (result.tenant) updateTenantLocal(result.tenant);
      setSuccess(`Onboarding aplicado: ${result.createdProducts || 0} productos, ${result.createdFaqs || 0} FAQs y ${result.policiesCount || 0} políticas.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el onboarding IA");
    } finally {
      setSavingId(null);
    }
  }

  function handleModuleToggle(module: string) {
    setPendingModules((current) => {
      const next = new Set(current);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return Array.from(next);
    });
    setSuccess(null);
    setError(null);
  }

  function addModulesToPending(modules: string[]) {
    setPendingModules((current) => Array.from(new Set([...current, ...modules])));
    setSuccess("Modulos sugeridos cargados en el selector. Presiona Guardar modulos para aplicarlos.");
    setError(null);
  }

  function replacePendingWithModules(modules: string[]) {
    setPendingModules(Array.from(new Set(modules)));
    setSuccess("Selector reemplazado con los modulos del rubro. Presiona Guardar modulos para aplicarlos.");
    setError(null);
  }

  async function handleCreateIndustryTemplate() {
    if (!industryForm.name.trim()) {
      setError("Escribe un nombre para el nuevo rubro.");
      return;
    }
    if (!pendingModules.length) {
      setError("Activa al menos un modulo antes de crear un rubro.");
      return;
    }
    try {
      setSavingId("custom-industry");
      setError(null);
      setSuccess(null);
      const workflows = industryForm.workflowsText.split("\n").map((item) => item.trim()).filter(Boolean);
      const entities = industryForm.entitiesText.split("\n").map((item) => item.trim()).filter(Boolean).map((label) => ({
        key: label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, ""),
        label
      }));
      const result = await createIndustryTemplate({
        name: industryForm.name,
        code: industryForm.code || undefined,
        summary: industryForm.summary,
        modules: pendingModules.map(moduleToTemplateItem),
        workflows,
        entities,
      });
      setIndustryTemplates(result.templates);
      setIndustryForm(emptyIndustryForm);
      setSuccess(`Rubro ${result.template.name} creado. Ya puedes aplicarlo a cualquier cuenta.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el rubro personalizado");
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveModules() {
    if (!selectedTenant) return;
    try {
      setSavingId(`modules-${selectedTenant.id}`);
      setError(null);
      setSuccess(null);
      const result = await updateAdminTenantModules(selectedTenant.id, pendingModules);
      if (result.tenant) {
        updateTenantLocal(result.tenant);
        setPendingModules(enabledModulesOf(result.tenant as AdminTenant));
      }
      setSuccess("Módulos guardados en la base de datos. Los usuarios del cliente verán el cambio al recargar o volver a iniciar sesión.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los módulos");
    } finally {
      setSavingId(null);
    }
  }

  async function handleApplyIndustryTemplate(template: IndustryTemplate) {
    if (!selectedTenant) return;
    try {
      setSavingId(`industry-${template.code}`);
      setError(null);
      setSuccess(null);
      const result = await applyAdminTenantIndustryTemplate(selectedTenant.id, {
        industry: template.code,
        plan: billingForm.planCode || selectedTenant.plan || "STARTER",
      });
      if (result.tenant) {
        updateTenantLocal(result.tenant);
        setPendingModules(enabledModulesOf(result.tenant));
      }
      setSuccess(`Plantilla ${template.name} aplicada. MÃ³dulos, entidades y flujos base quedaron listos para este cliente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar la plantilla de rubro");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    try {
      setSavingId("new-user");
      setError(null);
      const updated = await createAdminTenantUser(selectedTenant.id, userForm);
      updateTenantLocal(updated);
      setUserForm(emptyUser);
      setSuccess("Usuario agregado al cliente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el usuario");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleUser(userId: string, isActive: boolean) {
    try {
      setSavingId(userId);
      const updated = await updateAdminUser(userId, { isActive: !isActive });
      updateTenantLocal(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar usuario");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteTenant(tenantId: string) {
    const tenant = tenants.find((item) => item.id === tenantId);
    const label = tenant?.name ? `"${tenant.name}"` : "este cliente";
    if (!window.confirm(`¿Eliminar ${label}? Esta acción eliminará sus usuarios y datos asociados.`)) return;

    try {
      setSavingId(`delete-tenant-${tenantId}`);
      setError(null);
      setSuccess(null);
      await deleteAdminTenant(tenantId);
      setTenants((items) => items.filter((item) => item.id !== tenantId));
      setSelectedId((current) => {
        if (current !== tenantId) return current;
        const next = tenants.find((item) => item.id !== tenantId);
        return next?.id || null;
      });
      setSuccess("Cliente eliminado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el cliente");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteUser(userId: string) {
    const user = selectedTenant?.workspaceUsers?.find((item) => item.id === userId);
    const label = user?.email ? `"${user.email}"` : "este usuario";
    if (!window.confirm(`¿Eliminar ${label}?`)) return;

    try {
      setSavingId(`delete-user-${userId}`);
      setError(null);
      setSuccess(null);
      const updated = await deleteAdminUser(userId);
      updateTenantLocal(updated);
      setSuccess("Usuario eliminado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el usuario");
    } finally {
      setSavingId(null);
    }
  }


  if (!mounted) {
    return (
      <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Desarrollador" isDeveloper isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="main dashboard-page admin-page">
          <div className="empty-state">Cargando vista de desarrollador...</div>
        </main>
      </div>
    );
  }

  if (agent?.role !== "SUPER_ADMIN") {
    return (
      <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Desarrollador" isDeveloper={false} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="main dashboard-page admin-page">
          <div className="empty-state">No tienes permiso para ver la vista de desarrollador.</div>
        </main>
      </div>
    );
  }

  return (
    <div className={`module-with-menu-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
      <EvolumSidebar active="Desarrollador" isDeveloper isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
      <main className="main dashboard-page admin-page">

        <header className="module-app-header admin-module-header">
          <div>
            <span className="eyebrow">Control Center</span>
            <h1>Vista desarrollador</h1>
            <div className="meta-line">Crea clientes, asigna planes, habilita módulos y administra usuarios desde un solo lugar.</div>
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, slug, rubro o plan..." />
          <span className="module-account-pill">{agent?.name || "Super Admin"}</span>
        </header>

        <div className="admin-stats-grid">
          <div className="metric-card"><div className="meta-line">Clientes</div><strong>{tenants.length}</strong></div>
          <div className="metric-card"><div className="meta-line">Usuarios</div><strong>{totals.users}</strong></div>
          <div className="metric-card"><div className="meta-line">Módulos activos</div><strong>{totals.activeModules}</strong></div>
          <div className="metric-card"><div className="meta-line">Planes altos</div><strong>{totals.business}</strong></div>
        </div>

        {error ? <div className="admin-notice error">{error}</div> : null}
        {success ? <div className="admin-notice success">{success}</div> : null}

        <div className="admin-layout-grid">
          <section className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <strong>Clientes</strong>
                <div className="meta-line">Selecciona un cliente para editarlo.</div>
              </div>
            </div>

            <form className="admin-create-form" onSubmit={handleCreateTenant}>
              <strong>Crear cliente</strong>
              <input value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} placeholder="Nombre del negocio" required />
              <div className="admin-form-row">
                <input value={clientForm.slug} onChange={(e) => setClientForm({ ...clientForm, slug: e.target.value })} placeholder="slug opcional" />
                <input value={clientForm.industry} onChange={(e) => setClientForm({ ...clientForm, industry: e.target.value })} placeholder="rubro" />
              </div>
              <select value={clientForm.plan} onChange={(e) => setClientForm({ ...clientForm, plan: e.target.value })}>
                {PLANS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
              </select>
              <div className="admin-form-row">
                <input value={clientForm.ownerName} onChange={(e) => setClientForm({ ...clientForm, ownerName: e.target.value })} placeholder="Nombre owner" required />
                <input value={clientForm.ownerEmail} onChange={(e) => setClientForm({ ...clientForm, ownerEmail: e.target.value })} placeholder="Email owner" required />
              </div>
              <input value={clientForm.ownerPassword} onChange={(e) => setClientForm({ ...clientForm, ownerPassword: e.target.value })} placeholder="Contraseña inicial opcional" type="password" />
              <div className="admin-form-row">
                <input value={clientForm.whatsappPhoneNumberId} onChange={(e) => setClientForm({ ...clientForm, whatsappPhoneNumberId: e.target.value })} placeholder="WhatsApp Phone Number ID" />
                <input value={clientForm.whatsappBusinessAccountId} onChange={(e) => setClientForm({ ...clientForm, whatsappBusinessAccountId: e.target.value })} placeholder="WhatsApp Business Account ID" />
                <input value={clientForm.whatsappDisplayNumber} onChange={(e) => setClientForm({ ...clientForm, whatsappDisplayNumber: e.target.value })} placeholder="WhatsApp Display Number. Ej: 56962002398" />
              </div>
              <div className="admin-form-row">
                <input value={clientForm.instagramBusinessAccountId} onChange={(e) => setClientForm({ ...clientForm, instagramBusinessAccountId: e.target.value })} placeholder="Instagram Business Account ID" />
                <input value={clientForm.instagramPageId} onChange={(e) => setClientForm({ ...clientForm, instagramPageId: e.target.value })} placeholder="Instagram Page ID opcional" />
                <input value={clientForm.facebookPageId} onChange={(e) => setClientForm({ ...clientForm, facebookPageId: e.target.value })} placeholder="Facebook Page ID" />
              </div>
              <div className="admin-form-row">
                <input value={clientForm.metaAccessToken} onChange={(e) => setClientForm({ ...clientForm, metaAccessToken: e.target.value })} placeholder="Meta Access Token opcional" />
                <input value={clientForm.verifyToken} onChange={(e) => setClientForm({ ...clientForm, verifyToken: e.target.value })} placeholder="Verify Token opcional" />
              </div>
              <button className="primary-btn" disabled={savingId === "new-tenant"}>{savingId === "new-tenant" ? "Creando..." : "Crear cliente"}</button>
            </form>

            <div className="admin-tenant-list">
              {loading ? <div className="empty-state">Cargando clientes...</div> : null}
              {filtered.map((tenant) => (
                <button
                  key={tenant.id}
                  className={`admin-tenant-row ${selectedTenant?.id === tenant.id ? "active" : ""}`}
                  type="button"
                  onClick={() => setSelectedId(tenant.id)}
                >
                  <div>
                    <strong>{tenant.name}</strong>
                    <div className="meta-line">/{tenant.slug} · {tenant.industry || "sin rubro"}</div>
                  </div>
                  <span className="badge accent">{normalizePlanLabel(tenant.plan)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="admin-panel admin-detail-panel">
            {selectedTenant ? (
              <>
                <div className="admin-panel-header">
                  <div>
                    <strong>{selectedTenant.name}</strong>
                    <div className="meta-line">Configura plan, módulos, datos y usuarios.</div>
                  </div>
                  <span className="badge accent">{normalizePlanLabel(selectedTenant.plan)}</span>
                </div>

                <div className="admin-detail-grid">
                  <label>
                    <span className="meta-line">Nombre</span>
                    <input defaultValue={selectedTenant.name} onBlur={(e) => handleTenantField("name", e.target.value)} />
                  </label>
                  <label>
                    <span className="meta-line">Slug</span>
                    <input defaultValue={selectedTenant.slug} onBlur={(e) => handleTenantField("slug", e.target.value)} />
                  </label>
                  <label>
                    <span className="meta-line">Rubro</span>
                    <input defaultValue={selectedTenant.industry || ""} onBlur={(e) => handleTenantField("industry", e.target.value)} />
                  </label>
                  <label>
                    <span className="meta-line">Plan</span>
                    <select value={normalizePlanLabel(selectedTenant.plan)} onChange={(e) => handlePlanChange(selectedTenant.id, e.target.value)} disabled={savingId === selectedTenant.id}>
                      {PLANS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="meta-line">WhatsApp Phone Number ID</span>
                    <input defaultValue={selectedTenant.whatsappPhoneNumberId || ""} onBlur={(e) => handleTenantField("whatsappPhoneNumberId", e.target.value)} placeholder="ID del número Meta" />
                  </label>
                  <label>
                    <span className="meta-line">Instagram Business Account ID</span>
                    <input defaultValue={selectedTenant.instagramBusinessAccountId || ""} onBlur={(e) => handleTenantField("instagramBusinessAccountId", e.target.value)} placeholder="ID de Instagram Business" />
                  </label>
                </div>

                <div className="admin-industry-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Motor multirubro</strong>
                      <div className="meta-line">
                        Crea rubros con módulos propios. Al aplicar una plantilla se habilitan sus servicios según el plan actual del cliente.
                      </div>
                    </div>
                    <span className="admin-industry-pill">
                      {selectedIndustryTemplate?.custom ? "Custom" : "Base"} / {selectedIndustryTemplate?.name || selectedTenant.industry || "General"} / {selectedPlanCode}
                    </span>
                  </div>

                  <div className="industry-builder-panel">
                    <div className="industry-builder-summary">
                      <span>Plantilla activa</span>
                      <h3>{selectedIndustryTemplate?.name || "General"}</h3>
                      <p>{selectedIndustryTemplate?.summary || "Operacion comercial omnicanal."}</p>
                      <div className="industry-builder-actions">
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => addModulesToPending(selectedIndustryModules.map((module) => module.key))}
                          disabled={!selectedIndustryModules.length}
                        >
                          Sumar sugeridos
                        </button>
                        <button
                          className="ghost-btn"
                          type="button"
                          onClick={() => replacePendingWithModules(selectedIndustryModules.map((module) => module.key))}
                          disabled={!selectedIndustryModules.length}
                        >
                          Usar solo rubro
                        </button>
                      </div>
                    </div>
                    <div className="industry-plan-matrix">
                      {PLANS.map((plan) => {
                        const modulesForPlan = templateModulesForPlan(selectedIndustryTemplate, plan);
                        return (
                          <article key={plan} className={plan === selectedPlanCode ? "active" : ""}>
                            <strong>{plan}</strong>
                            <span>{modulesForPlan.length} modulos</span>
                            <small>{modulesForPlan.map((module) => module.label).slice(0, 4).join(", ") || "Sin modulos"}</small>
                          </article>
                        );
                      })}
                    </div>
                  </div>

                  <div className="industry-custom-builder">
                    <div>
                      <span className="eyebrow">Nuevo rubro</span>
                      <h3>Crear plantilla desde modulos activos</h3>
                      <p className="meta-line">Usa el selector de modulos de abajo como base. Ideal para futuros rubros como retail, legaltech, gimnasios o clinicas especializadas.</p>
                    </div>
                    <div className="industry-custom-form">
                      <input value={industryForm.name} onChange={(e) => setIndustryForm({ ...industryForm, name: e.target.value })} placeholder="Nombre del rubro" />
                      <input value={industryForm.code} onChange={(e) => setIndustryForm({ ...industryForm, code: e.target.value })} placeholder="Codigo opcional, ej: PETSHOP" />
                      <input value={industryForm.summary} onChange={(e) => setIndustryForm({ ...industryForm, summary: e.target.value })} placeholder="Resumen del rubro" />
                      <textarea value={industryForm.entitiesText} onChange={(e) => setIndustryForm({ ...industryForm, entitiesText: e.target.value })} placeholder="Entidades, una por linea" rows={3} />
                      <textarea value={industryForm.workflowsText} onChange={(e) => setIndustryForm({ ...industryForm, workflowsText: e.target.value })} placeholder="Flujos, uno por linea" rows={3} />
                      <button className="primary-btn" type="button" onClick={handleCreateIndustryTemplate} disabled={savingId === "custom-industry"}>
                        {savingId === "custom-industry" ? "Creando rubro..." : "Crear rubro"}
                      </button>
                    </div>
                  </div>

                  <div className="industry-template-grid">
                    {industryTemplates.map((template) => {
                      const active = selectedIndustryTemplate?.code === template.code;
                      const modulesForPlan = templateModulesForPlan(template, selectedPlanCode);
                      return (
                        <article key={template.code} className={`industry-template-card ${active ? "active" : ""}`}>
                          <div className="industry-card-head">
                            <div>
                              <strong>{template.name}</strong>
                              <p>{template.summary}</p>
                            </div>
                            <span>{modulesForPlan.length}</span>
                          </div>
                          <div className="industry-card-meta">
                            <small>Entidades: {template.entities.map((entity) => entity.label).join(", ")}</small>
                            <small>Flujo: {template.workflows.join(" -> ")}</small>
                          </div>
                          <div className="industry-module-chips">
                            {modulesForPlan.slice(0, 7).map((module) => (
                              <span key={module.key}>{module.label}</span>
                            ))}
                            {modulesForPlan.length > 7 ? <span>+{modulesForPlan.length - 7}</span> : null}
                          </div>
                          <button
                            className={active ? "ghost-btn" : "primary-btn"}
                            type="button"
                            onClick={() => handleApplyIndustryTemplate(template)}
                            disabled={savingId === `industry-${template.code}`}
                          >
                            {savingId === `industry-${template.code}` ? "Aplicando..." : active ? "Reaplicar plantilla" : "Aplicar rubro"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Precio mensual y límites comerciales</strong>
                      <div className="meta-line">Define manualmente el valor que verá el cliente en SaaS Center. Útil para descuentos, upgrades, downgrade o planes personalizados.</div>
                    </div>
                    <button className="primary-btn" type="button" onClick={handleSaveBilling} disabled={savingId === `billing-${selectedTenant.id}`}>
                      {savingId === `billing-${selectedTenant.id}` ? "Guardando..." : "Guardar precio"}
                    </button>
                  </div>
                  <div className="admin-detail-grid">
                    <label>
                      <span className="meta-line">Código plan</span>
                      <select value={normalizePlanLabel(billingForm.planCode)} onChange={(e) => setBillingForm({ ...billingForm, planCode: e.target.value })}>
                        {PLANS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="meta-line">Nombre visible del plan</span>
                      <input value={billingForm.planName} onChange={(e) => setBillingForm({ ...billingForm, planName: e.target.value })} placeholder="Ej: Business personalizado" />
                    </label>
                    <label>
                      <span className="meta-line">Precio mensual CLP</span>
                      <input type="number" value={billingForm.monthlyPrice} onChange={(e) => setBillingForm({ ...billingForm, monthlyPrice: e.target.value })} placeholder="99000" />
                    </label>
                    <label>
                      <span className="meta-line">Moneda</span>
                      <input value={billingForm.currency} onChange={(e) => setBillingForm({ ...billingForm, currency: e.target.value.toUpperCase() })} placeholder="CLP" />
                    </label>
                    <label>
                      <span className="meta-line">Límite mensajes mensual</span>
                      <input type="number" value={billingForm.messagesMonthly} onChange={(e) => setBillingForm({ ...billingForm, messagesMonthly: e.target.value })} placeholder="10000, vacío = ilimitado" />
                    </label>
                    <label>
                      <span className="meta-line">Límite usuarios</span>
                      <input type="number" value={billingForm.users} onChange={(e) => setBillingForm({ ...billingForm, users: e.target.value })} placeholder="15, vacío = ilimitado" />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Descripción comercial visible</span>
                      <input value={billingForm.description} onChange={(e) => setBillingForm({ ...billingForm, description: e.target.value })} placeholder="Automatización completa con marketing, pagos y analítica." />
                    </label>
                  </div>
                </div>

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Meta, WhatsApp, Instagram y Facebook</strong>
                      <div className="meta-line">Guarda los identificadores y tokens por cliente. Estos datos quedan asociados al tenant seleccionado.</div>
                    </div>
                  </div>

                  <div className="admin-detail-grid">
                    <label>
                      <span className="meta-line">WhatsApp label</span>
                      <input value={whatsappForm.label} onChange={(e) => setWhatsappForm({ ...whatsappForm, label: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">WhatsApp Phone Number ID</span>
                      <input value={whatsappForm.phoneNumberId} onChange={(e) => setWhatsappForm({ ...whatsappForm, phoneNumberId: e.target.value })} placeholder="Ej: 1234567890" />
                    </label>
                    <label>
                      <span className="meta-line">WhatsApp Business Account ID</span>
                      <input value={whatsappForm.businessAccountId} onChange={(e) => setWhatsappForm({ ...whatsappForm, businessAccountId: e.target.value })} placeholder="WABA ID" />
                    </label>
                    <label>
                      <span className="meta-line">WhatsApp Display Number</span>
                      <input value={whatsappForm.displayNumber} onChange={(e) => setWhatsappForm({ ...whatsappForm, displayNumber: e.target.value })} placeholder="Ej: 56962002398" />
                    </label>
                    <label>
                      <span className="meta-line">WhatsApp Verify Token</span>
                      <input value={whatsappForm.verifyToken} onChange={(e) => setWhatsappForm({ ...whatsappForm, verifyToken: e.target.value })} placeholder="Token de verificación webhook" />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Meta Access Token para WhatsApp</span>
                      <input value={whatsappForm.accessToken} onChange={(e) => setWhatsappForm({ ...whatsappForm, accessToken: e.target.value })} placeholder="EAAB... / token de Meta" />
                    </label>
                  </div>
                  <button className="primary-btn" type="button" onClick={() => handleSaveChannel("whatsapp")} disabled={savingId === "channel-whatsapp"}>
                    {savingId === "channel-whatsapp" ? "Guardando WhatsApp..." : "Guardar WhatsApp"}
                  </button>

                  <div className="admin-detail-grid" style={{ marginTop: 18 }}>
                    <label>
                      <span className="meta-line">Instagram label</span>
                      <input value={instagramForm.label} onChange={(e) => setInstagramForm({ ...instagramForm, label: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Instagram Business Account ID</span>
                      <input value={instagramForm.externalAccountId} onChange={(e) => setInstagramForm({ ...instagramForm, externalAccountId: e.target.value })} placeholder="IG Business ID" />
                    </label>
                    <label>
                      <span className="meta-line">Facebook Page ID</span>
                      <input value={instagramForm.pageId} onChange={(e) => setInstagramForm({ ...instagramForm, pageId: e.target.value })} placeholder="Page ID conectado a Instagram" />
                    </label>
                    <label>
                      <span className="meta-line">Instagram / Meta Business Account ID</span>
                      <input value={instagramForm.businessAccountId} onChange={(e) => setInstagramForm({ ...instagramForm, businessAccountId: e.target.value })} placeholder="Business Manager ID opcional" />
                    </label>
                    <label>
                      <span className="meta-line">Instagram Verify Token</span>
                      <input value={instagramForm.verifyToken} onChange={(e) => setInstagramForm({ ...instagramForm, verifyToken: e.target.value })} placeholder="Token de verificación webhook" />
                    </label>
                    <label>
                      <span className="meta-line">Meta Access Token para Instagram</span>
                      <input value={instagramForm.accessToken} onChange={(e) => setInstagramForm({ ...instagramForm, accessToken: e.target.value })} placeholder="Token de Meta" />
                    </label>
                  </div>
                  <button className="primary-btn" type="button" onClick={() => handleSaveChannel("instagram")} disabled={savingId === "channel-instagram"}>
                    {savingId === "channel-instagram" ? "Guardando Instagram..." : "Guardar Instagram"}
                  </button>

                  <div className="admin-detail-grid" style={{ marginTop: 18 }}>
                    <label>
                      <span className="meta-line">Facebook label</span>
                      <input value={facebookForm.label} onChange={(e) => setFacebookForm({ ...facebookForm, label: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Facebook Page ID</span>
                      <input value={facebookForm.pageId} onChange={(e) => setFacebookForm({ ...facebookForm, pageId: e.target.value })} placeholder="Page ID para publicar posts" />
                    </label>
                    <label>
                      <span className="meta-line">Facebook / Meta Business Account ID</span>
                      <input value={facebookForm.businessAccountId} onChange={(e) => setFacebookForm({ ...facebookForm, businessAccountId: e.target.value })} placeholder="Business Manager ID opcional" />
                    </label>
                    <label>
                      <span className="meta-line">Facebook Verify Token</span>
                      <input value={facebookForm.verifyToken} onChange={(e) => setFacebookForm({ ...facebookForm, verifyToken: e.target.value })} placeholder="Token de verificacion webhook" />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Meta Access Token para Facebook</span>
                      <input value={facebookForm.accessToken} onChange={(e) => setFacebookForm({ ...facebookForm, accessToken: e.target.value })} placeholder="Token de Meta con permisos de pagina" />
                    </label>
                  </div>
                  <button className="primary-btn" type="button" onClick={() => handleSaveChannel("facebook")} disabled={savingId === "channel-facebook"}>
                    {savingId === "channel-facebook" ? "Guardando Facebook..." : "Guardar Facebook"}
                  </button>
                </div>

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Perfil IA del cliente</strong>
                      <div className="meta-line">Define cómo debe hablar la IA para este negocio antes de responder por WhatsApp o Instagram.</div>
                    </div>
                  </div>
                  <div className="admin-detail-grid">
                    <label>
                      <span className="meta-line">Nombre IA</span>
                      <input value={aiForm.name} onChange={(e) => setAiForm({ ...aiForm, name: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Rubro IA</span>
                      <input value={aiForm.industry} onChange={(e) => setAiForm({ ...aiForm, industry: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Tono</span>
                      <input value={aiForm.tone} onChange={(e) => setAiForm({ ...aiForm, tone: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Objetivo</span>
                      <input value={aiForm.objective} onChange={(e) => setAiForm({ ...aiForm, objective: e.target.value })} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Persona / contexto base</span>
                      <textarea value={aiForm.basePersona} onChange={(e) => setAiForm({ ...aiForm, basePersona: e.target.value })} rows={4} />
                    </label>
                    <label>
                      <span className="meta-line">Estilo de respuesta</span>
                      <input value={aiForm.responseStyle} onChange={(e) => setAiForm({ ...aiForm, responseStyle: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Reglas / restricciones, una por línea</span>
                      <textarea value={aiForm.businessRulesText} onChange={(e) => setAiForm({ ...aiForm, businessRulesText: e.target.value })} rows={4} />
                    </label>
                  </div>
                  <button className="primary-btn" type="button" onClick={handleSaveAiProfile} disabled={savingId === `ai-${selectedTenant.id}`}>
                    {savingId === `ai-${selectedTenant.id}` ? "Guardando IA..." : "Guardar perfil IA"}
                  </button>
                </div>

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Carga IA: Excel, CSV, PDF o TXT</strong>
                      <div className="meta-line">Sube catálogo, políticas o FAQs. La IA extrae productos, precios, preguntas frecuentes, tono y políticas para este cliente.</div>
                    </div>
                  </div>

                  <div className="admin-detail-grid">
                    <label>
                      <span className="meta-line">Nombre negocio</span>
                      <input value={importManual.businessName} onChange={(e) => setImportManual({ ...importManual, businessName: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Rubro</span>
                      <input value={importManual.industry} onChange={(e) => setImportManual({ ...importManual, industry: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Tono sugerido</span>
                      <input value={importManual.tone} onChange={(e) => setImportManual({ ...importManual, tone: e.target.value })} />
                    </label>
                    <label>
                      <span className="meta-line">Objetivo comercial</span>
                      <input value={importManual.objective} onChange={(e) => setImportManual({ ...importManual, objective: e.target.value })} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Descripción del negocio</span>
                      <textarea value={importManual.description} onChange={(e) => setImportManual({ ...importManual, description: e.target.value })} rows={3} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Restricciones o reglas</span>
                      <textarea value={importManual.restrictions} onChange={(e) => setImportManual({ ...importManual, restrictions: e.target.value })} rows={3} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      <span className="meta-line">Archivos CSV, Excel, PDF o TXT</span>
                      <input type="file" multiple accept=".csv,.xls,.xlsx,.pdf,.txt" onChange={(e) => setImportFiles(Array.from(e.target.files || []))} />
                    </label>
                  </div>

                  <div className="admin-form-row">
                    <button className="primary-btn" type="button" onClick={handleExtractAdminOnboarding} disabled={savingId === `extract-${selectedTenant.id}`}>
                      {savingId === `extract-${selectedTenant.id}` ? "Analizando..." : "Extraer con IA"}
                    </button>
                    <label className="module-toggle" style={{ justifyContent: "center" }}>
                      <input type="checkbox" checked={replaceProducts} onChange={(e) => setReplaceProducts(e.target.checked)} />
                      <span>Reemplazar productos</span>
                    </label>
                    <label className="module-toggle" style={{ justifyContent: "center" }}>
                      <input type="checkbox" checked={replaceFaqs} onChange={(e) => setReplaceFaqs(e.target.checked)} />
                      <span>Reemplazar FAQs</span>
                    </label>
                  </div>

                  {importExtraction ? (
                    <div className="admin-notice success" style={{ marginTop: 12 }}>
                      <strong>Extracción lista:</strong> {importExtraction.products?.length || 0} productos, {importExtraction.faqs?.length || 0} FAQs y {importExtraction.policies?.length || 0} políticas.
                      <div style={{ marginTop: 8 }}>{importExtraction.summary || "Revisa la información extraída antes de aplicarla."}</div>
                      <button className="primary-btn" type="button" onClick={handleApplyAdminOnboarding} disabled={savingId === `apply-${selectedTenant.id}`} style={{ marginTop: 12 }}>
                        {savingId === `apply-${selectedTenant.id}` ? "Aplicando..." : "Aplicar datos a este cliente"}
                      </button>
                    </div>
                  ) : null}

                  <div className="meta-line" style={{ marginTop: 12 }}>
                    Importaciones recientes: {(selectedTenant.onboardingImports || []).length ? selectedTenant.onboardingImports?.map((item) => `${item.status} · ${new Date(item.createdAt).toLocaleString()}`).join(" | ") : "sin cargas todavía"}
                  </div>
                </div>

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Servicios / módulos habilitados</strong>
                      <div className="meta-line">
                        Activa solo lo que este cliente paga o necesita. Los cambios quedan pendientes hasta presionar "Guardar módulos".
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      {moduleDirty ? <span className="meta-line">Cambios sin guardar</span> : <span className="meta-line">Módulos sincronizados</span>}
                      <button
                        className="primary-btn"
                        type="button"
                        onClick={handleSaveModules}
                        disabled={!moduleDirty || savingId === `modules-${selectedTenant.id}`}
                      >
                        {savingId === `modules-${selectedTenant.id}` ? "Guardando..." : "Guardar módulos"}
                      </button>
                      <button className="ghost-btn danger" type="button" onClick={() => handleDeleteTenant(selectedTenant.id)} disabled={savingId === `delete-tenant-${selectedTenant.id}`}>Eliminar</button>
                    </div>
                  </div>
                  <div className="module-toggle-grid">
                    {availableModules.map((module) => {
                      const active = pendingModules.includes(module);
                      const saved = enabledModulesOf(selectedTenant).includes(module);
                      return (
                        <button key={module} type="button" className={`module-toggle ${active ? "active" : ""}`} onClick={() => handleModuleToggle(module)}>
                          <span>{MODULE_LABELS[module] || module}</span>
                          <small>{active ? "Activo" : "Bloqueado"}{active !== saved ? " · pendiente" : ""}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="admin-users-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Usuarios del cliente</strong>
                      <div className="meta-line">Agrega dueños, agentes o visores para este tenant.</div>
                    </div>
                  </div>

                  <form className="admin-create-form compact" onSubmit={handleCreateUser}>
                    <div className="admin-form-row four">
                      <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} placeholder="Nombre" required />
                      <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="Email" required />
                      <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                      <input value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder="Contraseña opcional" type="password" />
                    </div>
                    <button className="primary-btn" disabled={savingId === "new-user"}>{savingId === "new-user" ? "Agregando..." : "Agregar usuario"}</button>
                  </form>

                  <div className="admin-users-list">
                    {(selectedTenant.workspaceUsers || []).map((user) => (
                      <div key={user.id} className="admin-user-row">
                        <div>
                          <strong>{user.name}</strong>
                          <div className="meta-line">{user.email} · {user.role}</div>
                        </div>
                        <button className="ghost-btn" type="button" onClick={() => toggleUser(user.id, user.isActive)} disabled={savingId === user.id}>
                          {user.isActive ? "Desactivar" : "Activar"}
                        </button>
                        <button className="ghost-btn danger" type="button" onClick={() => handleDeleteUser(user.id)} disabled={savingId === `delete-user-${user.id}`}>Eliminar</button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">Selecciona o crea un cliente para configurarlo.</div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
