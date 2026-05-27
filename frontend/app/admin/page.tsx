"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AdminTenant,
  createAdminTenant,
  createAdminTenantUser,
  getAdminTenants,
  getModuleCatalog,
  updateAdminTenant,
  updateAdminTenantAiProfile,
  updateAdminTenantChannelConfig,
  updateAdminTenantModules,
  updateAdminUser,
  updateTenantPlan,
  uploadAdminTenantOnboardingFiles,
  applyAdminTenantOnboardingExtraction,
  deleteAdminTenant,
  deleteAdminUser,
  type OnboardingExtraction,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";
import { Topbar } from "@/components/topbar";

const PLANS = ["STARTER", "PRO", "BUSINESS", "ENTERPRISE"];
const ROLES = ["OWNER", "ADMIN", "AGENT", "SELLER", "VIEWER"];
const MODULE_LABELS: Record<string, string> = {
  inbox: "Inbox",
  sales: "Ventas",
  marketing: "Marketing",
  bookings: "Reservas",
  payments: "Pagos",
  followups: "Follow-ups",
  analytics: "Analytics",
  bot_lab: "Bot Lab",
};

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
  metaAccessToken: "",
  metaAppSecret: "",
  verifyToken: "",
  instagramBusinessAccountId: "",
  instagramPageId: "",
};

const emptyUser = {
  name: "",
  email: "",
  role: "AGENT",
  password: "",
};

const emptyWhatsAppConfig = {
  label: "WhatsApp principal",
  phoneNumberId: "",
  businessAccountId: "",
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

function asArrayRules(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => String(item));
  return [];
}

function enabledModulesOf(tenant: AdminTenant) {
  return (tenant.tenantModules || []).filter((item) => item.enabled).map((item) => item.module);
}

export default function AdminPage() {
  const [mounted, setMounted] = useState(false);
  const [agent, setAgent] = useState<ReturnType<typeof getStoredSession>>(null);

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
  const [clientForm, setClientForm] = useState(emptyClient);
  const [userForm, setUserForm] = useState(emptyUser);
  const [whatsappForm, setWhatsappForm] = useState(emptyWhatsAppConfig);
  const [instagramForm, setInstagramForm] = useState(emptyInstagramConfig);
  const [aiForm, setAiForm] = useState(emptyAiProfile);
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
      const [tenantData, catalog] = await Promise.all([
        getAdminTenants(),
        getModuleCatalog().catch(() => null),
      ]);
      setTenants(tenantData);
      if (!selectedId && tenantData[0]) setSelectedId(tenantData[0].id);
      if (catalog?.modules) setModuleCatalog(Object.values(catalog.modules));
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

    const whatsapp = selectedTenant.channelConfigs?.find((item) => item.channel === "whatsapp");
    const instagram = selectedTenant.channelConfigs?.find((item) => item.channel === "instagram");
    const profile = selectedTenant.aiProfiles?.find((item) => item.code === "default") || selectedTenant.aiProfiles?.[0];

    setWhatsappForm({
      label: whatsapp?.label || "WhatsApp principal",
      phoneNumberId: whatsapp?.phoneNumberId || selectedTenant.whatsappPhoneNumberId || "",
      businessAccountId: whatsapp?.businessAccountId || "",
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
    const business = tenants.filter((tenant) => tenant.plan === "BUSINESS" || tenant.plan === "ENTERPRISE").length;
    return { users, activeModules, business };
  }, [tenants]);

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

  async function handleSaveChannel(channel: "whatsapp" | "instagram") {
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
            accessToken: whatsappForm.accessToken,
            verifyToken: whatsappForm.verifyToken,
            isActive: whatsappForm.isActive,
          }
        : {
            label: instagramForm.label,
            externalAccountId: instagramForm.externalAccountId,
            businessAccountId: instagramForm.businessAccountId,
            accessToken: instagramForm.accessToken,
            verifyToken: instagramForm.verifyToken,
            metadata: { pageId: instagramForm.pageId },
            isActive: instagramForm.isActive,
          };
      const updated = await updateAdminTenantChannelConfig(selectedTenant.id, channel, payload);
      updateTenantLocal(updated);
      setSuccess(`Configuración ${channel === "whatsapp" ? "WhatsApp" : "Instagram"} guardada.`);
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

  async function handleModuleToggle(module: string) {
    if (!selectedTenant) return;
    try {
      setSavingId(`modules-${selectedTenant.id}`);
      setError(null);
      const current = new Set(enabledModulesOf(selectedTenant));
      if (current.has(module)) current.delete(module);
      else current.add(module);
      const result = await updateAdminTenantModules(selectedTenant.id, Array.from(current));
      if (result.tenant) updateTenantLocal(result.tenant);
      setSuccess("Módulos actualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron actualizar módulos");
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
      <div className="page page-single">
        <main className="main dashboard-page">
          <Topbar agent={null} />
          <div className="empty-state">Cargando vista de desarrollador...</div>
        </main>
      </div>
    );
  }

  if (agent?.role !== "SUPER_ADMIN") {
    return (
      <div className="page page-single">
        <main className="main dashboard-page">
          <Topbar agent={agent} />
          <div className="empty-state">No tienes permiso para ver la vista de desarrollador.</div>
        </main>
      </div>
    );
  }

  return (
    <div className="page page-single">
      <main className="main dashboard-page admin-page">
        <Topbar agent={agent} />

        <div className="admin-hero">
          <div>
            <span className="eyebrow">Control Center</span>
            <h1 className="chat-title">Vista desarrollador</h1>
            <div className="meta-line">Crea clientes, asigna planes, habilita módulos y administra usuarios desde un solo lugar.</div>
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, slug, rubro o plan..." />
        </div>

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
              </div>
              <div className="admin-form-row">
                <input value={clientForm.instagramBusinessAccountId} onChange={(e) => setClientForm({ ...clientForm, instagramBusinessAccountId: e.target.value })} placeholder="Instagram Business Account ID" />
                <input value={clientForm.instagramPageId} onChange={(e) => setClientForm({ ...clientForm, instagramPageId: e.target.value })} placeholder="Facebook Page ID / Instagram Page ID" />
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
                  <span className="badge accent">{tenant.plan || "STARTER"}</span>
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
                  <span className="badge accent">{selectedTenant.plan || "STARTER"}</span>
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
                    <select value={selectedTenant.plan || "STARTER"} onChange={(e) => handlePlanChange(selectedTenant.id, e.target.value)} disabled={savingId === selectedTenant.id}>
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

                <div className="admin-module-section">
                  <div className="admin-panel-header slim">
                    <div>
                      <strong>Meta, WhatsApp e Instagram</strong>
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
                      <div className="meta-line">Activa solo lo que este cliente paga o necesita.</div>
                      <button className="ghost-btn danger" type="button" onClick={() => handleDeleteTenant(selectedTenant.id)} disabled={savingId === `delete-tenant-${selectedTenant.id}`}>Eliminar</button>
                    </div>
                  </div>
                  <div className="module-toggle-grid">
                    {(moduleCatalog.length ? moduleCatalog : ["inbox", "sales", "marketing", "bookings", "payments", "followups", "analytics", "bot_lab"]).map((module) => {
                      const active = enabledModulesOf(selectedTenant).includes(module);
                      return (
                        <button key={module} type="button" className={`module-toggle ${active ? "active" : ""}`} onClick={() => handleModuleToggle(module)}>
                          <span>{MODULE_LABELS[module] || module}</span>
                          <small>{active ? "Activo" : "Bloqueado"}</small>
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
