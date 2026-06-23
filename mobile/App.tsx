import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import {
  clearMobileSession,
  getAdminTenants,
  getBookings,
  getConversations,
  getCrmOperationalDashboard,
  getMe,
  getMessages,
  getMobileSession,
  getMyModules,
  loginWithEmail,
  releaseConversation,
  resolveConversation,
  sendManualMessage,
  takeConversation,
  updateAdminTenantModules
} from "./src/api/client";
import { getIndustryProfile, IndustryProfile } from "./src/config/industryProfiles";
import { colors, shadow } from "./src/theme";
import { AdminTenant, AgentSession, Booking, Conversation, CrmOperationalDashboard, Message, TenantSession } from "./src/types";

type ScreenKey = "dashboard" | "inbox" | "agenda" | "pipeline" | "campaigns" | "admin";

type SessionState = {
  user: AgentSession;
  tenant?: TenantSession;
};

const navItems: Array<{ key: ScreenKey; label: string; short: string; module?: string }> = [
  { key: "dashboard", label: "Dashboard", short: "DA", module: "analytics" },
  { key: "inbox", label: "Inbox", short: "IO", module: "inbox" },
  { key: "agenda", label: "Agenda", short: "AG", module: "bookings" },
  { key: "pipeline", label: "Pipeline", short: "PI", module: "sales" },
  { key: "campaigns", label: "Campanas", short: "CA", module: "marketing" },
  { key: "admin", label: "Admin", short: "SA" }
];

function money(value?: number | null) {
  return `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;
}

function timeLabel(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dateLabel(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function initials(value?: string | null) {
  const text = String(value || "EV").trim();
  return text.slice(0, 2).toUpperCase();
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<CrmOperationalDashboard | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [chatFilter, setChatFilter] = useState<"all" | "whatsapp" | "instagram">("all");
  const [reply, setReply] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [adminTenants, setAdminTenants] = useState<AdminTenant[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const profile = useMemo(() => getIndustryProfile(session?.tenant?.industry), [session?.tenant?.industry]);
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || conversations[0] || null,
    [conversations, selectedConversationId]
  );

  const visibleNav = useMemo(() => {
    const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
    return navItems.filter((item) => {
      if (item.key === "admin") return isSuperAdmin;
      if (!item.module) return true;
      if (!modules.length) return true;
      return modules.includes(item.module) || modules.includes(item.key);
    });
  }, [modules, session?.user?.role]);

  const filteredConversations = useMemo(() => {
    if (chatFilter === "all") return conversations;
    return conversations.filter((item) => item.contact.channel === chatFilter);
  }, [chatFilter, conversations]);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedConversation?.id) return;
    loadMessages(selectedConversation.id);
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (screen === "inbox") loadConversations(false);
      if (screen === "dashboard") loadDashboard(false);
    }, 15000);
    return () => clearInterval(id);
  }, [screen, session]);

  async function bootstrap() {
    try {
      const cached = await getMobileSession<any>();
      if (cached?.user) {
        setSession({ user: cached.user, tenant: cached.tenant });
        await loadAll();
      }
      const me = await getMe().catch(() => null);
      if (me?.user) {
        setSession({ user: me.user, tenant: me.tenant });
      }
    } finally {
      setBooting(false);
    }
  }

  async function loadAll() {
    await Promise.allSettled([loadModules(), loadDashboard(false), loadConversations(false), loadBookings(false)]);
  }

  async function loadModules() {
    const data = await getMyModules().catch(() => null);
    if (data?.modules) setModules(data.modules);
  }

  async function loadDashboard(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getCrmOperationalDashboard().catch(() => null);
    if (data) setDashboard(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadConversations(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getConversations().catch(() => []);
    setConversations(data);
    if (!selectedConversationId && data[0]) setSelectedConversationId(data[0].id);
    if (showLoading) setRefreshing(false);
  }

  async function loadMessages(conversationId: string) {
    const data = await getMessages(conversationId).catch(() => []);
    setMessages(data);
  }

  async function loadBookings(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getBookings().catch(() => []);
    setBookings(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadAdminTenants() {
    const data = await getAdminTenants().catch(() => []);
    setAdminTenants(data);
  }

  async function handleLogin() {
    try {
      setAuthLoading(true);
      const data = await loginWithEmail(email.trim(), password);
      setSession({ user: data.user, tenant: data.tenant });
      await loadAll();
    } catch (error) {
      Alert.alert("No se pudo iniciar sesion", error instanceof Error ? error.message : "Intenta nuevamente");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await clearMobileSession();
    setSession(null);
    setDashboard(null);
    setConversations([]);
    setMessages([]);
    setBookings([]);
  }

  async function refreshCurrent() {
    if (screen === "dashboard") return loadDashboard();
    if (screen === "inbox") return loadConversations();
    if (screen === "agenda") return loadBookings();
    if (screen === "admin") return loadAdminTenants();
  }

  async function sendReply() {
    if (!selectedConversation?.id || !reply.trim()) return;
    const content = reply.trim();
    setReply("");
    try {
      await sendManualMessage(selectedConversation.id, content);
      await loadMessages(selectedConversation.id);
      await loadConversations(false);
    } catch (error) {
      Alert.alert("No se pudo enviar", error instanceof Error ? error.message : "Revisa la conexion");
      setReply(content);
    }
  }

  async function handleConversationAction(action: "take" | "release" | "resolve") {
    if (!selectedConversation?.id || !session?.user?.id) return;
    try {
      if (action === "take") await takeConversation(selectedConversation.id, session.user.id);
      if (action === "release") await releaseConversation(selectedConversation.id);
      if (action === "resolve") await resolveConversation(selectedConversation.id);
      await loadConversations(false);
    } catch (error) {
      Alert.alert("Accion no completada", error instanceof Error ? error.message : "Intenta nuevamente");
    }
  }

  async function toggleTenantModule(tenant: AdminTenant, moduleName: string) {
    const enabledModules = (tenant.tenantModules || []).filter((item) => item.enabled).map((item) => item.module);
    const next = enabledModules.includes(moduleName)
      ? enabledModules.filter((item) => item !== moduleName)
      : [...enabledModules, moduleName];
    try {
      await updateAdminTenantModules(tenant.id, next);
      await loadAdminTenants();
    } catch (error) {
      Alert.alert("No se pudo actualizar", error instanceof Error ? error.message : "Intenta nuevamente");
    }
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.centerScreen}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.purple2} />
        <Text style={styles.muted}>Cargando EVOLUM...</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.loginScreen}>
        <StatusBar style="light" />
        <View style={styles.loginCard}>
          <View style={styles.logoLarge}><Text style={styles.logoText}>EV</Text></View>
          <Text style={styles.loginTitle}>EVOLUM</Text>
          <Text style={styles.loginSubtitle}>App movil para operacion, inbox y super admin.</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.muted} secureTextEntry />
          <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={authLoading}>
            <Text style={styles.primaryButtonText}>{authLoading ? "Entrando..." : "Entrar"}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appShell}>
      <StatusBar style="light" />
      <SideNav items={visibleNav} active={screen} onChange={(next) => {
        setScreen(next);
        if (next === "admin") loadAdminTenants();
      }} />
      <View style={styles.contentShell}>
        <TopHeader session={session} profile={profile} onLogout={handleLogout} />
        {screen === "dashboard" && (
          <DashboardScreen dashboard={dashboard} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} />
        )}
        {screen === "inbox" && (
          <InboxScreen
            conversations={filteredConversations}
            allConversations={conversations}
            selectedConversation={selectedConversation}
            messages={messages}
            filter={chatFilter}
            setFilter={setChatFilter}
            drawerOpen={chatDrawerOpen}
            setDrawerOpen={setChatDrawerOpen}
            reply={reply}
            setReply={setReply}
            onSend={sendReply}
            onSelect={(conversation) => {
              setSelectedConversationId(conversation.id);
              setChatDrawerOpen(false);
            }}
            onAction={handleConversationAction}
            refreshing={refreshing}
            onRefresh={refreshCurrent}
          />
        )}
        {screen === "agenda" && <AgendaScreen bookings={bookings} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} />}
        {screen === "pipeline" && <PipelineScreen dashboard={dashboard} profile={profile} conversations={conversations} refreshing={refreshing} onRefresh={refreshCurrent} />}
        {screen === "campaigns" && <CampaignsScreen profile={profile} conversations={conversations} />}
        {screen === "admin" && <AdminScreen tenants={adminTenants} onToggleModule={toggleTenantModule} onRefresh={loadAdminTenants} />}
      </View>
    </SafeAreaView>
  );
}

function SideNav({ items, active, onChange }: { items: typeof navItems; active: ScreenKey; onChange: (key: ScreenKey) => void }) {
  return (
    <View style={styles.sideNav}>
      <View style={styles.sideLogo}><Text style={styles.sideLogoText}>EV</Text></View>
      <View style={styles.sideItems}>
        {items.map((item) => (
          <Pressable key={item.key} style={[styles.sideItem, active === item.key && styles.sideItemActive]} onPress={() => onChange(item.key)}>
            <Text style={[styles.sideItemText, active === item.key && styles.sideItemTextActive]}>{item.short}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.sideItem}><Text style={styles.sideItemText}>MA</Text></View>
    </View>
  );
}

function TopHeader({ session, profile, onLogout }: { session: SessionState; profile: IndustryProfile; onLogout: () => void }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerEyebrow}>EVOLUM / {profile.label}</Text>
        <Text style={styles.headerTitle}>{session.tenant?.name || session.user.name}</Text>
      </View>
      <TouchableOpacity style={styles.accountPill} onPress={onLogout}>
        <Text style={styles.accountPillText}>{session.user.role === "SUPER_ADMIN" ? "Super Admin" : session.user.name}</Text>
      </TouchableOpacity>
    </View>
  );
}

function DashboardScreen({ dashboard, profile, refreshing, onRefresh }: { dashboard: CrmOperationalDashboard | null; profile: IndustryProfile; refreshing: boolean; onRefresh: () => void }) {
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Dashboard</Text>
      <Text style={styles.screenTitle}>{profile.dashboardTitle}</Text>
      <Text style={styles.screenSubtitle}>{profile.primaryEntity}, ventas, reservas y actividad en tiempo real.</Text>
      <View style={styles.kpiGrid}>
        <Kpi label="Leads" value={dashboard?.kpis.leads ?? 0} detail={`${dashboard?.kpis.hotLeads ?? 0} calientes`} />
        <Kpi label="Chats" value={dashboard?.kpis.conversations ?? 0} detail="activos" />
        <Kpi label={profile.bookingLabel} value={dashboard?.kpis.bookingsConfirmed ?? 0} detail={`${dashboard?.kpis.bookingsPending ?? 0} pendientes`} />
        <Kpi label="Revenue" value={money(dashboard?.revenue.paid)} detail={`${money(dashboard?.revenue.pending)} pendiente`} />
      </View>
      <Panel title="Actividad reciente">
        {(dashboard?.activity || []).slice(0, 5).map((item) => (
          <ListRow key={item.id} left={initials(item.type)} title={item.title} subtitle={item.description} right={dateLabel(item.createdAt)} />
        ))}
        {!dashboard?.activity?.length && <Text style={styles.muted}>Sin actividad registrada.</Text>}
      </Panel>
    </ScrollView>
  );
}

function InboxScreen(props: {
  conversations: Conversation[];
  allConversations: Conversation[];
  selectedConversation: Conversation | null;
  messages: Message[];
  filter: "all" | "whatsapp" | "instagram";
  setFilter: (filter: "all" | "whatsapp" | "instagram") => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  reply: string;
  setReply: (text: string) => void;
  onSend: () => void;
  onSelect: (conversation: Conversation) => void;
  onAction: (action: "take" | "release" | "resolve") => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const active = props.selectedConversation;
  return (
    <View style={styles.inboxRoot}>
      <View style={styles.chatHeader}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(active?.contact.name || active?.contact.externalId)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatName}>{active?.contact.name || active?.contact.externalId || "Inbox"}</Text>
          <Text style={styles.chatSub}>{active ? `${active.contact.channel} / ${active.status} / ${active.mode}` : "Selecciona una conversacion"}</Text>
        </View>
        <TouchableOpacity style={styles.chatsButton} onPress={() => props.setDrawerOpen(true)}>
          <Text style={styles.chatsButtonText}>CHATS</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={props.messages}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={colors.purple2} />}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.direction === "OUTBOUND" && styles.bubbleOut]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
            <Text style={styles.bubbleMeta}>{timeLabel(item.createdAt)} / {item.status}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.mutedCenter}>No hay mensajes para mostrar.</Text>}
      />

      <View style={styles.actionRow}>
        <MiniButton label="Tomar" onPress={() => props.onAction("take")} />
        <MiniButton label="Bot" onPress={() => props.onAction("release")} />
        <MiniButton label="Resolver" onPress={() => props.onAction("resolve")} />
      </View>

      <View style={styles.composer}>
        <TextInput style={styles.composerInput} value={props.reply} onChangeText={props.setReply} placeholder="Responder mensaje..." placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.sendButton} onPress={props.onSend}><Text style={styles.sendButtonText}>{">"}</Text></TouchableOpacity>
      </View>

      {props.drawerOpen && (
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerScrim} onPress={() => props.setDrawerOpen(false)} />
          <View style={styles.chatDrawer}>
            <View style={styles.drawerHeader}>
              <View>
                <Text style={styles.drawerTitle}>Chats</Text>
                <Text style={styles.muted}>{props.conversations.length} visibles / {props.allConversations.length} totales</Text>
              </View>
              <TouchableOpacity style={styles.iconButton} onPress={() => props.setDrawerOpen(false)}><Text style={styles.iconButtonText}>x</Text></TouchableOpacity>
            </View>
            <View style={styles.filterRow}>
              {(["all", "whatsapp", "instagram"] as const).map((filter) => (
                <TouchableOpacity key={filter} style={[styles.filterPill, props.filter === filter && styles.filterPillActive]} onPress={() => props.setFilter(filter)}>
                  <Text style={[styles.filterText, props.filter === filter && styles.filterTextActive]}>{filter === "all" ? "Todos" : filter}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FlatList
              data={props.conversations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.drawerChat, item.id === active?.id && styles.drawerChatActive]} onPress={() => props.onSelect(item)}>
                  <View style={styles.avatarSmall}><Text style={styles.avatarText}>{item.contact.channel === "whatsapp" ? "WA" : "IG"}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.drawerChatTitle}>{item.contact.name || item.contact.externalId}</Text>
                    <Text style={styles.drawerChatSub} numberOfLines={1}>{item.lastMessage?.content || item.aiSummary || "Sin resumen"}</Text>
                  </View>
                  <Text style={styles.drawerChatTime}>{timeLabel(item.lastMessageAt)}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function AgendaScreen({ bookings, profile, refreshing, onRefresh }: { bookings: Booking[]; profile: IndustryProfile; refreshing: boolean; onRefresh: () => void }) {
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Agenda</Text>
      <Text style={styles.screenTitle}>Agenda {profile.label}</Text>
      <Text style={styles.screenSubtitle}>{profile.bookingLabel}s creadas por IA o manualmente.</Text>
      <Panel title={`Proximas ${profile.bookingLabel.toLowerCase()}s`}>
        {bookings.slice(0, 12).map((booking) => (
          <ListRow key={booking.id} left="AG" title={booking.name || profile.bookingLabel} subtitle={`${dateLabel(booking.date)} / ${booking.location || "Sin ubicacion"} / ${booking.guests} personas`} right={booking.status} />
        ))}
        {!bookings.length && <Text style={styles.muted}>Sin reservas por ahora.</Text>}
      </Panel>
    </ScrollView>
  );
}

function PipelineScreen({ dashboard, profile, conversations, refreshing, onRefresh }: { dashboard: CrmOperationalDashboard | null; profile: IndustryProfile; conversations: Conversation[]; refreshing: boolean; onRefresh: () => void }) {
  return (
    <ScrollView horizontal={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>CRM</Text>
      <Text style={styles.screenTitle}>Pipeline</Text>
      <Text style={styles.screenSubtitle}>{profile.primaryEntity}s y oportunidades por etapa.</Text>
      <View style={styles.stageList}>
        {profile.pipelineStages.map((stage, index) => {
          const count = dashboard?.pipeline?.[index]?.count ?? (index === 0 ? conversations.length : 0);
          return (
            <View key={stage} style={styles.stageCard}>
              <View style={styles.stageHeader}><Text style={styles.stageTitle}>{stage}</Text><Text style={styles.stageCount}>{count}</Text></View>
              {conversations.slice(index, index + 1).map((item) => (
                <View key={item.id} style={styles.opportunityCard}>
                  <Text style={styles.cardTitle}>{item.contact.name || item.contact.externalId}</Text>
                  <Text style={styles.muted}>{item.aiSummary || item.lastMessage?.content || "Oportunidad comercial"}</Text>
                  <Text style={styles.scoreText}>{item.aiCloseScore || 0}% cierre</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function CampaignsScreen({ profile, conversations }: { profile: IndustryProfile; conversations: Conversation[] }) {
  const whatsappCount = conversations.filter((item) => item.contact.channel === "whatsapp").length;
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Marketing IA</Text>
      <Text style={styles.screenTitle}>Campanas</Text>
      <Text style={styles.screenSubtitle}>Contenido y destinatarios conectados al inbox.</Text>
      <Panel title={`Campana rapida ${profile.label}`}>
        <Text style={styles.muted}>La app queda lista para usar el mismo generador de campanas de la web. Los destinatarios WhatsApp disponibles se importan desde conversaciones del tenant.</Text>
        <View style={styles.campaignStat}>
          <Text style={styles.kpiValue}>{whatsappCount}</Text>
          <Text style={styles.muted}>numeros WhatsApp detectados</Text>
        </View>
        <TouchableOpacity style={styles.primaryButton}><Text style={styles.primaryButtonText}>Crear campana movil</Text></TouchableOpacity>
      </Panel>
    </ScrollView>
  );
}

function AdminScreen({ tenants, onToggleModule, onRefresh }: { tenants: AdminTenant[]; onToggleModule: (tenant: AdminTenant, moduleName: string) => void; onRefresh: () => void }) {
  useEffect(() => {
    onRefresh();
  }, []);

  const moduleNames = ["inbox", "analytics", "bookings", "sales", "marketing", "payments", "bot_lab"];

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Super Admin</Text>
      <Text style={styles.screenTitle}>Catalogo y cuentas</Text>
      <Text style={styles.screenSubtitle}>Controla modulos por plan, cuenta y rubro.</Text>
      {tenants.map((tenant) => {
        const enabled = (tenant.tenantModules || []).filter((item) => item.enabled).map((item) => item.module);
        return (
          <Panel key={tenant.id} title={tenant.name}>
            <Text style={styles.muted}>{tenant.industry || "Sin rubro"} / {tenant.plan || "STARTER"}</Text>
            <View style={styles.moduleGrid}>
              {moduleNames.map((moduleName) => (
                <TouchableOpacity key={moduleName} style={[styles.moduleToggle, enabled.includes(moduleName) && styles.moduleToggleOn]} onPress={() => onToggleModule(tenant, moduleName)}>
                  <Text style={[styles.moduleToggleText, enabled.includes(moduleName) && styles.moduleToggleTextOn]}>{moduleName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Panel>
        );
      })}
      {!tenants.length && <Text style={styles.mutedCenter}>Sin cuentas cargadas.</Text>}
    </ScrollView>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.greenText}>{detail}</Text>
    </View>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function ListRow({ left, title, subtitle, right }: { left: string; title: string; subtitle: string; right?: string }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.avatarSmall}><Text style={styles.avatarText}>{left}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle}>{title}</Text>
        <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text>
      </View>
      {right ? <Text style={styles.rowRight}>{right}</Text> : null}
    </View>
  );
}

function MiniButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.miniButton} onPress={onPress}>
      <Text style={styles.miniButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12
  },
  loginScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    padding: 22
  },
  loginCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    backgroundColor: colors.panel,
    padding: 24,
    gap: 14,
    ...shadow
  },
  logoLarge: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center"
  },
  logoText: { color: colors.text, fontWeight: "900" },
  loginTitle: { color: colors.text, fontSize: 34, fontWeight: "900" },
  loginSubtitle: { color: colors.muted, lineHeight: 20 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.panel2,
    color: colors.text,
    paddingHorizontal: 14
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: { color: colors.text, fontWeight: "900" },
  appShell: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  sideNav: {
    width: 66,
    margin: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: "#07101f",
    padding: 8,
    alignItems: "center",
    justifyContent: "space-between"
  },
  sideLogo: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center"
  },
  sideLogoText: { color: colors.text, fontWeight: "900" },
  sideItems: { gap: 8, alignItems: "center" },
  sideItem: {
    width: 42,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.18)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)"
  },
  sideItemActive: { backgroundColor: colors.purple, borderColor: colors.borderStrong },
  sideItemText: { color: colors.muted, fontWeight: "900", fontSize: 11 },
  sideItemTextActive: { color: colors.text },
  contentShell: { flex: 1, paddingRight: 10, paddingTop: 10 },
  header: {
    minHeight: 78,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.panel,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  headerEyebrow: { color: colors.purple2, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  accountPill: { backgroundColor: colors.purple, borderRadius: 999, paddingHorizontal: 14, minHeight: 42, justifyContent: "center" },
  accountPillText: { color: colors.text, fontWeight: "900" },
  screenContent: { paddingVertical: 14, paddingBottom: 32, gap: 14 },
  eyebrow: { color: colors.purple2, fontSize: 12, fontWeight: "900", letterSpacing: 1.8, textTransform: "uppercase" },
  screenTitle: { color: colors.text, fontSize: 30, fontWeight: "900" },
  screenSubtitle: { color: colors.muted, lineHeight: 20 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpiCard: {
    width: "47.8%",
    minHeight: 118,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.panel,
    padding: 14
  },
  kpiValue: { color: colors.text, fontSize: 28, fontWeight: "900", marginVertical: 6 },
  greenText: { color: colors.green, fontSize: 12 },
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.panel,
    padding: 14,
    gap: 12
  },
  panelTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 12 },
  mutedCenter: { color: colors.muted, textAlign: "center", marginTop: 20 },
  listRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.16)",
    borderRadius: 15,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.035)"
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarSmall: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(139,63,244,0.32)",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: { color: colors.text, fontWeight: "900", fontSize: 12 },
  listTitle: { color: colors.text, fontWeight: "900" },
  rowRight: { color: colors.purple2, fontWeight: "900", fontSize: 11 },
  inboxRoot: { flex: 1, paddingTop: 12 },
  chatHeader: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.panel,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  chatName: { color: colors.text, fontSize: 20, fontWeight: "900" },
  chatSub: { color: colors.muted, fontSize: 11 },
  chatsButton: { backgroundColor: colors.purple, borderRadius: 14, minHeight: 42, paddingHorizontal: 12, justifyContent: "center" },
  chatsButtonText: { color: colors.text, fontWeight: "900", fontSize: 12 },
  messageList: { flex: 1 },
  messageListContent: { paddingVertical: 14, gap: 10 },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "86%",
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    padding: 12,
    marginBottom: 8
  },
  bubbleOut: { alignSelf: "flex-end", backgroundColor: colors.purple },
  bubbleText: { color: colors.text, lineHeight: 20 },
  bubbleMeta: { color: colors.muted, fontSize: 10, marginTop: 6 },
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  miniButton: {
    flex: 1,
    minHeight: 39,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(139,63,244,0.12)"
  },
  miniButtonText: { color: colors.text, fontWeight: "800" },
  composer: {
    flexDirection: "row",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingBottom: 8
  },
  composerInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.panel,
    color: colors.text,
    paddingHorizontal: 12
  },
  sendButton: { width: 50, borderRadius: 16, backgroundColor: colors.purple, alignItems: "center", justifyContent: "center" },
  sendButtonText: { color: colors.text, fontWeight: "900", fontSize: 20 },
  drawerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    flexDirection: "row"
  },
  drawerScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.28)" },
  chatDrawer: {
    width: "78%",
    backgroundColor: "#080814",
    borderLeftWidth: 1,
    borderLeftColor: colors.borderStrong,
    padding: 14,
    gap: 12
  },
  drawerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  drawerTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  iconButton: { width: 36, height: 36, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: colors.text, fontWeight: "900" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterPill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 11, minHeight: 34, justifyContent: "center" },
  filterPillActive: { backgroundColor: colors.purple, borderColor: colors.borderStrong },
  filterText: { color: colors.muted, fontWeight: "800", textTransform: "capitalize" },
  filterTextActive: { color: colors.text },
  drawerChat: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.18)",
    borderRadius: 16,
    padding: 10,
    marginBottom: 9,
    backgroundColor: "rgba(255,255,255,0.035)"
  },
  drawerChatActive: { borderColor: colors.borderStrong, backgroundColor: "rgba(139,63,244,0.18)" },
  drawerChatTitle: { color: colors.text, fontWeight: "900" },
  drawerChatSub: { color: colors.muted, fontSize: 11 },
  drawerChatTime: { color: colors.muted, fontSize: 10 },
  stageList: { gap: 12 },
  stageCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.panel,
    padding: 14,
    minHeight: 130
  },
  stageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stageTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  stageCount: { color: colors.text, backgroundColor: colors.purple, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  opportunityCard: {
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
    borderRadius: 14,
    backgroundColor: colors.panel3,
    padding: 12
  },
  cardTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },
  scoreText: { color: colors.orange, marginTop: 8, fontWeight: "900" },
  campaignStat: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, backgroundColor: colors.panel2 },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  moduleToggle: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  moduleToggleOn: { backgroundColor: colors.purple, borderColor: colors.borderStrong },
  moduleToggleText: { color: colors.muted, fontWeight: "800" },
  moduleToggleTextOn: { color: colors.text }
});
