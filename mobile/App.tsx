import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Updates from "expo-updates";
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StatusBar as RNStatusBar,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import {
  API_BASE_URL,
  checkApiHealth,
  clearMobileSession,
  createBooking,
  createCampaignDraft,
  createIndustryRecord,
  generateCampaignCopy,
  generateCampaignImages,
  getAdminTenants,
  getBalancedIndustryAssignments,
  getBookings,
  getCampaignJob,
  getCampaigns,
  getConversations,
  getCrmOperationalDashboard,
  getRealtyIntelligence,
  getIndustryRecords,
  getIndustryUsers,
  getMe,
  getMessages,
  getMobileSession,
  getMyModules,
  loginWithEmail,
  publishCampaign,
  releaseConversation,
  resolveConversation,
  sendManualMessage,
  sendReengagementTemplate,
  takeConversation,
  updateAdminTenantModules,
  updateIndustryRecord,
  getOfflineQueueCount,
  syncOfflineQueue,
  registerMobilePushDevice,
  unregisterMobilePushDevice
} from "./src/api/client";
import { getIndustryProfile, IndustryProfile } from "./src/config/industryProfiles";
import { colors, shadow } from "./src/theme";
import { AdminTenant, AgentSession, Booking, Campaign, Conversation, CrmOperationalDashboard, IndustryRecord, IndustryUser, Message, RealtyIntelligence, TenantSession } from "./src/types";

const evolumLogo = require("./assets/evolum-logo.png");

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true })
});

type ScreenKey =
  | "dashboard"
  | "inbox"
  | "agenda"
  | "pipeline"
  | "realtyLoads"
  | "properties"
  | "realtyActivity"
  | "brokerPortal"
  | "brokers"
  | "customers"
  | "patients"
  | "vehicleOwners"
  | "campaigns"
  | "admin";

type SessionState = {
  user: AgentSession;
  tenant?: TenantSession;
};

type CampaignVariant = {
  id?: string;
  title?: string;
  visualTitle?: string;
  caption?: string;
  copy?: string;
  text?: string;
  cta?: string;
  hashtags?: string;
  image?: string;
  imageUrl?: string;
  url?: string;
  mediaUrl?: string;
  publicUrl?: string;
  generationStage?: string;
};

type PropertyImportRow = {
  rowNumber: number;
  title: string;
  propertyType: string;
  operation: string;
  price: number;
  address: string;
  material: string;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  meters: number;
  photoUrl: string;
  observations: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  captureOrigin: string;
  captureDate: string;
  assignedToName: string;
  stage: string;
  recognizedFields: number;
  errors: string[];
};

const navItems: Array<{ key: ScreenKey; label: string; short: string; module?: string }> = [
  { key: "dashboard", label: "Dashboard", short: "DA", module: "analytics" },
  { key: "inbox", label: "Inbox", short: "IO", module: "inbox" },
  { key: "agenda", label: "Agenda", short: "AG", module: "bookings" },
  { key: "pipeline", label: "Pipeline", short: "PI", module: "sales" },
  { key: "realtyLoads", label: "Cargas inmobiliarias", short: "CI", module: "realty_loads" },
  { key: "properties", label: "Propiedades", short: "PR", module: "properties" },
  { key: "realtyActivity", label: "Actividad inmobiliaria", short: "AC", module: "realty_activity" },
  { key: "brokerPortal", label: "Portal corredor", short: "PC", module: "broker_portal" },
  { key: "brokers", label: "Corredores", short: "CO", module: "brokers" },
  { key: "customers", label: "Clientes inmobiliarios", short: "CL", module: "realty_clients" },
  { key: "patients", label: "Pacientes", short: "PA", module: "patients" },
  { key: "vehicleOwners", label: "Dueños y vehículos", short: "DV", module: "vehicle_owners" },
  { key: "campaigns", label: "Campañas", short: "CA", module: "marketing" },
  { key: "admin", label: "Admin", short: "SA" }
];

const moduleAliases: Record<string, string[]> = {
  analytics: ["analytics", "dashboard"],
  inbox: ["inbox"],
  bookings: ["bookings", "agenda"],
  sales: ["sales", "pipeline"],
  realty_loads: ["realty_loads", "cargas_inmobiliarias", "cargas"],
  properties: ["properties", "propiedades"],
  realty_activity: ["realty_activity", "actividad_inmobiliaria"],
  broker_portal: ["broker_portal", "portal_corredor"],
  brokers: ["brokers", "corredores"],
  realty_clients: ["realty_clients", "clientes_inmobiliarios", "clientes"],
  patients: ["patients", "pacientes"],
  vehicle_owners: ["vehicle_owners", "dueños", "duenos", "vehiculos"],
  marketing: ["marketing", "campaigns"],
  admin: ["admin", "developer", "desarrollador"]
};

function normalizeModuleName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function mobileModuleAllowed(item: { key: ScreenKey; module?: string }, modules: string[], role?: string | null) {
  if (role === "SUPER_ADMIN") return true;
  if (!item.module) return true;
  if (item.key === "dashboard") return true;
  if (!modules.length) return true;
  const normalized = new Set(modules.map(normalizeModuleName));
  const aliases = moduleAliases[item.module] || [item.module, item.key];
  return aliases.some((alias) => normalized.has(normalizeModuleName(alias)));
}

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

function inputDateTime(offsetDays = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(19, 30, 0, 0);
  return date.toISOString().slice(0, 16);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function initials(value?: string | null) {
  const text = String(value || "EV").trim();
  return text.slice(0, 2).toUpperCase();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTemplateData(value: any) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function campaignVariantImage(variant?: CampaignVariant | null) {
  if (!variant) return "";
  return String(variant.imageUrl || variant.image || variant.mediaUrl || variant.publicUrl || variant.url || "");
}

function campaignVariantCaption(variant?: CampaignVariant | null) {
  if (!variant) return "";
  return String(variant.caption || variant.copy || variant.text || "");
}

function extractCampaignVariants(source: any): CampaignVariant[] {
  const templateData = parseTemplateData(source?.campaign?.templateData || source?.campaign?.template || source?.templateData || source?.template);
  const candidates = [
    source?.variants,
    source?.result?.variants,
    source?.campaign?.templateData?.variants,
    templateData?.variants
  ];
  const variants = candidates.find((item) => Array.isArray(item) && item.length);
  return Array.isArray(variants) ? variants : [];
}

function recordText(record: IndustryRecord, key: string, fallback = "-") {
  const value = record.data?.[key];
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function recordNumber(record: IndustryRecord, key: string, fallback = 0) {
  const value = record.data?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const REALTY_STAGES = ["Prospeccion", "Contacto", "Propuesta", "Negociacion", "Cierre"];

function realtyStage(record: IndustryRecord) {
  const value = recordText(record, "stage", record.status || REALTY_STAGES[0]);
  return REALTY_STAGES.includes(value) ? value : REALTY_STAGES[0];
}

function realtyPrice(record: IndustryRecord) {
  return recordNumber(record, "price") || recordNumber(record, "value") || recordNumber(record, "askingPrice");
}

function commissionProjection(value: number) {
  const total = Math.round(value * 0.02);
  return {
    total,
    seller: Math.round(total * 0.65),
    platform: Math.round(total * 0.35)
  };
}

function dataUrlFromFile(name?: string | null, mimeType?: string | null, base64?: string | null) {
  if (!base64) return "";
  const safeType = mimeType || (name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  return `data:${safeType};base64,${base64}`;
}

function normalizeImportKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizedImportRow(row: Record<string, unknown>) {
  return Object.entries(row || {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[normalizeImportKey(key)] = value;
    return acc;
  }, {});
}

function importValue(row: Record<string, unknown>, aliases: string[]) {
  const normalized = normalizedImportRow(row);
  for (const alias of aliases) {
    const value = normalized[normalizeImportKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function importText(row: Record<string, unknown>, aliases: string[], fallback = "") {
  const value = importValue(row, aliases);
  return String(value ?? fallback).trim();
}

function importNumber(row: Record<string, unknown>, aliases: string[]) {
  const value = importValue(row, aliases);
  const parsed = Number(String(value || "0").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePropertyStage(value: string) {
  const key = normalizeImportKey(value);
  if (key.includes("contact")) return "Contacto";
  if (key.includes("propuesta")) return "Propuesta";
  if (key.includes("negoci")) return "Negociacion";
  if (key.includes("cierre") || key.includes("ganad")) return "Cierre";
  return "Prospeccion";
}

function parsePropertyImportRow(row: Record<string, unknown>, index: number): PropertyImportRow {
  const title = importText(row, ["Nombre propiedad", "Propiedad", "Titulo", "Nombre", "Codigo"]);
  const address = importText(row, ["Direccion", "Ubicacion", "Comuna", "Direccion / comuna"]);
  const price = importNumber(row, ["Precio", "Valor", "Precio CLP", "Valor cartera"]);
  const propertyType = importText(row, ["Tipo propiedad", "Tipo", "Clase"], "casa").toLowerCase();
  const operation = importText(row, ["Operacion", "Tipo operacion", "Venta/arriendo"], "venta").toLowerCase();
  const assignedToName = importText(row, ["Corredor", "Vendedor", "Asignado a", "Ejecutivo"]);
  const recognizedFields = [
    title,
    address,
    price,
    propertyType,
    operation,
    importText(row, ["Material", "Material principal"]),
    importNumber(row, ["Piezas", "Dormitorios", "Habitaciones"]),
    importNumber(row, ["Banos", "Baños"]),
    importNumber(row, ["Estacionamientos", "Estac"]),
    importNumber(row, ["M2", "Metros", "Metros cuadrados"]),
    assignedToName,
    importText(row, ["Observaciones", "Notas"])
  ].filter(Boolean).length;
  const errors = [];
  if (!title && !address) errors.push("Falta nombre o direccion");
  if (!price) errors.push("Falta precio");

  return {
    rowNumber: index + 2,
    title: title || address || `Propiedad fila ${index + 2}`,
    propertyType,
    operation: operation.includes("arriendo") ? "arriendo" : "venta",
    price,
    address,
    material: importText(row, ["Material", "Material principal"]),
    bedrooms: importNumber(row, ["Piezas", "Dormitorios", "Habitaciones"]),
    bathrooms: importNumber(row, ["Banos", "Baños"]),
    parking: importNumber(row, ["Estacionamientos", "Estac"]),
    meters: importNumber(row, ["M2", "Metros", "Metros cuadrados"]),
    photoUrl: importText(row, ["Foto", "URL foto", "URL foto principal"]),
    observations: importText(row, ["Observaciones", "Notas", "Descripcion"]),
    ownerName: importText(row, ["Propietario", "Nombre propietario", "Dueño"]),
    ownerPhone: importText(row, ["Telefono propietario", "Fono propietario", "Telefono"]),
    ownerEmail: importText(row, ["Email propietario", "Correo propietario", "Email"]),
    captureOrigin: importText(row, ["Origen captacion", "Origen"], "excel_import"),
    captureDate: importText(row, ["Fecha captacion", "Fecha"]),
    assignedToName,
    stage: normalizePropertyStage(importText(row, ["Etapa", "Estado comercial", "Pipeline"])),
    recognizedFields,
    errors
  };
}

function parseCsvRows(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = text.split("\n", 1)[0] || "";
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ";" : ",";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && char === "\n") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  const [headers = [], ...values] = rows;
  return values.map((valuesRow) => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] || ""])));
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("EVOLUM mobile render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={styles.centerScreen}>
        <StatusBar style="light" />
        <View style={styles.recoveryCard}>
          <Text style={styles.loginTitle}>EVOLUM se recuperó</Text>
          <Text style={styles.muted}>Una pantalla tuvo un problema. Tus datos locales no se borraron.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => this.setState({ error: null })}>
            <Text style={styles.primaryButtonText}>Volver a intentar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
}

export default function App() {
  return <AppErrorBoundary><EvolumApp /></AppErrorBoundary>;
}

function EvolumApp() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<CrmOperationalDashboard | null>(null);
  const [realtyIntelligence, setRealtyIntelligence] = useState<RealtyIntelligence | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [chatFilter, setChatFilter] = useState<"all" | "whatsapp" | "instagram">("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [properties, setProperties] = useState<IndustryRecord[]>([]);
  const [customers, setCustomers] = useState<IndustryRecord[]>([]);
  const [patients, setPatients] = useState<IndustryRecord[]>([]);
  const [vehicleOwners, setVehicleOwners] = useState<IndustryRecord[]>([]);
  const [adminTenants, setAdminTenants] = useState<AdminTenant[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [pendingOfflineSync, setPendingOfflineSync] = useState(0);
  const [expoPushToken, setExpoPushToken] = useState("");

  const profile = useMemo(() => getIndustryProfile(session?.tenant?.industry), [session?.tenant?.industry]);
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || conversations[0] || null,
    [conversations, selectedConversationId]
  );

  const visibleNav = useMemo(() => {
    const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
    return navItems.filter((item) => {
      if (item.key === "admin") return isSuperAdmin;
      // Las fichas operativas son realmente independientes; una cuenta de
      // salud no ve clientes inmobiliarios y una inmobiliaria no ve pacientes.
      if (item.key === "customers" && profile.code !== "real_estate" && !isSuperAdmin) return false;
      if (item.key === "patients" && !["health", "dental", "veterinary"].includes(profile.code) && !isSuperAdmin) return false;
      if (item.key === "vehicleOwners" && profile.code !== "automotive" && !isSuperAdmin) return false;
      return mobileModuleAllowed(item, modules, session?.user?.role);
    });
  }, [modules, session?.user?.role]);

  const filteredConversations = useMemo(() => {
    if (chatFilter === "all") return conversations;
    return conversations.filter((item) => item.contact.channel === chatFilter);
  }, [chatFilter, conversations]);

  async function applyAvailableUpdate() {
    try {
      await Updates.fetchUpdateAsync();
      Alert.alert(
        "Actualización lista",
        "La nueva versión de EVOLUM ya está descargada.",
        [{ text: "Reiniciar ahora", onPress: () => void Updates.reloadAsync() }]
      );
    } catch {
      Alert.alert("No se pudo actualizar", "Revisa tu conexión e inténtalo nuevamente.");
    }
  }

  async function checkForApplicationUpdate() {
    // Expo Go y las compilaciones de desarrollo no reciben actualizaciones de producción.
    if (__DEV__ || !Updates.isEnabled) return;

    try {
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) return;

      Alert.alert(
        "Nueva versión disponible",
        "Hay una mejora disponible para EVOLUM. Puedes instalarla ahora sin perder tu sesión.",
        [
          { text: "Más tarde", style: "cancel" },
          { text: "Actualizar ahora", onPress: () => void applyAvailableUpdate() }
        ]
      );
    } catch {
      // La aplicación sigue funcionando con la última versión almacenada si no hay red.
    }
  }

  useEffect(() => {
    bootstrap();
    void checkForApplicationUpdate();
  }, []);

  useEffect(() => {
    if (!session || Platform.OS === "web") return;
    void registerForPushNotifications();
    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = response.notification.request.content.data?.screen;
      if (typeof screen === "string" && navItems.some((item) => item.key === screen)) setScreen(screen as ScreenKey);
    });
    const tokenListener = Notifications.addPushTokenListener((token) => {
      if (token.type === "expo") void savePushToken(token.data);
    });
    return () => {
      responseListener.remove();
      tokenListener.remove();
    };
  }, [session?.tenant?.id, session?.user?.id]);

  async function savePushToken(token: string) {
    if (!token) return;
    await registerMobilePushDevice({
      expoPushToken: token,
      platform: Platform.OS,
      preferences: { enabled: true, message: true, booking: true, payment: true, general: true }
    }).catch(() => undefined);
    setExpoPushToken(token);
  }

  async function registerForPushNotifications() {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("evolum-alerts", {
          name: "Alertas EVOLUM",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#8A2EFF"
        });
      }
      const existing = await Notifications.getPermissionsAsync();
      const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted") return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await savePushToken(token);
    } catch (error) {
      console.warn("No se pudo registrar notificaciones push", error);
    }
  }

  useEffect(() => {
    void refreshOfflineQueueCount();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void syncPendingOfflineActions();
    });
    return () => subscription.remove();
  }, []);

  async function refreshOfflineQueueCount() {
    setPendingOfflineSync(await getOfflineQueueCount());
  }

  async function syncPendingOfflineActions() {
    const result = await syncOfflineQueue();
    setPendingOfflineSync(result.pending);
    if (result.synced && session) await loadAll();
  }

  useEffect(() => {
    if (!selectedConversation?.id) return;
    loadMessages(selectedConversation.id);
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!session || screen !== "dashboard") return;
    const id = setInterval(() => {
      loadDashboard(false);
    }, 15000);
    return () => clearInterval(id);
  }, [screen, session]);

  useEffect(() => {
    if (!session || screen !== "inbox") return;
    const id = setInterval(() => {
      loadConversations(false);
      if (selectedConversation?.id) loadMessages(selectedConversation.id);
    }, 2500);
    return () => clearInterval(id);
  }, [screen, session, selectedConversation?.id]);

  async function bootstrap() {
    try {
      const cached = await getMobileSession<any>();
      if (cached?.user) {
        setSession({ user: cached.user, tenant: cached.tenant });
        await syncPendingOfflineActions();
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
    await Promise.allSettled([loadModules(), loadDashboard(false), loadRealtyIntelligence(), loadConversations(false), loadBookings(false), loadCampaigns(false), loadProperties(false), loadCustomers(false), loadPatients(false), loadVehicleOwners(false)]);
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

  async function loadRealtyIntelligence() {
    const data = await getRealtyIntelligence().catch(() => null);
    setRealtyIntelligence(data);
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

  async function loadCampaigns(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getCampaigns().catch(() => []);
    setCampaigns(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadProperties(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getIndustryRecords("property").catch(() => []);
    setProperties(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadCustomers(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getIndustryRecords("customer").catch(() => []);
    setCustomers(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadPatients(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getIndustryRecords("patient").catch(() => []);
    setPatients(data);
    if (showLoading) setRefreshing(false);
  }

  async function loadVehicleOwners(showLoading = true) {
    if (showLoading) setRefreshing(true);
    const data = await getIndustryRecords("vehicle").catch(() => []);
    setVehicleOwners(data);
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
      await syncPendingOfflineActions();
      await loadAll();
    } catch (error) {
      Alert.alert("No se pudo iniciar sesion", error instanceof Error ? error.message : "Intenta nuevamente");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleConnectionCheck() {
    try {
      setConnectionLoading(true);
      setConnectionStatus("Probando conexion...");
      const data = await checkApiHealth();
      setConnectionStatus(data?.db ? "Conexion OK: API y base de datos en linea." : "Conexion OK: API en linea.");
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : "No se pudo probar la conexion.");
    } finally {
      setConnectionLoading(false);
    }
  }

  async function handleLogout() {
    if (expoPushToken) await unregisterMobilePushDevice(expoPushToken).catch(() => undefined);
    await clearMobileSession();
    setSession(null);
    setDashboard(null);
    setRealtyIntelligence(null);
    setConversations([]);
    setMessages([]);
    setBookings([]);
    setProperties([]);
    setCustomers([]);
    setPatients([]);
    setVehicleOwners([]);
    setModules([]);
    setPendingOfflineSync(0);
  }

  async function refreshCurrent() {
    if (screen === "dashboard") {
      await Promise.all([loadDashboard(), loadRealtyIntelligence()]);
      return;
    }
    if (screen === "inbox") {
      await loadConversations();
      if (selectedConversation?.id) await loadMessages(selectedConversation.id);
      return;
    }
    if (screen === "agenda") return loadBookings();
    if (screen === "pipeline") {
      await loadDashboard();
      await loadConversations(false);
      await loadProperties(false);
      return;
    }
    if (screen === "realtyLoads") return loadProperties();
    if (screen === "realtyActivity") return loadProperties();
    if (screen === "brokerPortal") return loadProperties();
    if (screen === "brokers") return loadProperties();
    if (screen === "properties") return loadProperties();
    if (screen === "customers") return loadCustomers();
    if (screen === "patients") return loadPatients();
    if (screen === "vehicleOwners") return loadVehicleOwners();
    if (screen === "campaigns") return loadCampaigns();
    if (screen === "admin") return loadAdminTenants();
  }

  async function sendReply() {
    if (!selectedConversation?.id || !reply.trim()) return;
    const content = reply.trim();
    setReply("");
    try {
      const sent = await sendManualMessage(selectedConversation.id, content);
      await loadMessages(selectedConversation.id);
      await loadConversations(false);
      if (sent.status === "FAILED") {
        const errorText = sent.errorMessage || "Meta rechazo o no pudo enviar el mensaje.";
        const needsTemplate = /re-engagement|24 hours|24 horas/i.test(errorText);
        if (needsTemplate) {
          Alert.alert(
            "Chat fuera de ventana",
            "WhatsApp no permite texto libre porque el cliente no ha respondido en mas de 24 horas. Envia una plantilla aprobada para reabrir el chat.",
            [
              { text: "Cancelar", style: "cancel" },
              { text: "Enviar plantilla", onPress: () => sendReengagementTemplateForSelected() }
            ]
          );
        } else {
          Alert.alert("WhatsApp no entrego el mensaje", errorText);
        }
      }
    } catch (error) {
      Alert.alert("No se pudo enviar", error instanceof Error ? error.message : "Revisa la conexion");
      setReply(content);
    }
  }

  async function sendReengagementTemplateForSelected() {
    if (!selectedConversation?.id) return;
    try {
      const sent = await sendReengagementTemplate(selectedConversation.id);
      await loadMessages(selectedConversation.id);
      await loadConversations(false);
      if (sent.status === "FAILED") {
        Alert.alert("Plantilla no enviada", sent.errorMessage || "La plantilla aun no esta aprobada o Meta la rechazo.");
      } else {
        Alert.alert("Plantilla enviada", "Cuando el cliente responda, se abrira la ventana de 24 horas para continuar el chat.");
      }
    } catch (error) {
      Alert.alert("No se pudo enviar plantilla", error instanceof Error ? error.message : "Intenta nuevamente");
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
          <TouchableOpacity style={styles.secondaryButton} onPress={handleConnectionCheck} disabled={connectionLoading}>
            <Text style={styles.secondaryButtonText}>{connectionLoading ? "Probando..." : "Probar conexion"}</Text>
          </TouchableOpacity>
          <Text style={styles.apiHint}>{API_BASE_URL}</Text>
          {!!connectionStatus && <Text style={styles.connectionStatus}>{connectionStatus}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appShell}>
      <StatusBar style="light" />
      <SideNav
        items={visibleNav}
        active={screen}
        session={session}
        profile={profile}
        open={menuOpen}
        setOpen={setMenuOpen}
        onLogout={handleLogout}
        onChange={(next) => {
        setScreen(next);
        setMenuOpen(false);
        if (next === "admin") loadAdminTenants();
      }} />
      {screen === "inbox" && (
        <View style={styles.inboxTopContact}>
          <View style={styles.avatarTiny}><Text style={styles.avatarText}>{initials(selectedConversation?.contact.name || selectedConversation?.contact.externalId)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.topContactName}>{selectedConversation?.contact.name || selectedConversation?.contact.externalId || "Inbox"}</Text>
            <Text style={styles.topContactSub}>{selectedConversation ? `${selectedConversation.contact.channel} / ${selectedConversation.status} / ${selectedConversation.mode}` : "Selecciona una conversacion"}</Text>
          </View>
          <TouchableOpacity style={styles.chatsButtonCompact} onPress={() => setChatDrawerOpen(true)}>
            <Text style={styles.chatsButtonText}>CHATS</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.contentShell}>
        {pendingOfflineSync > 0 && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>{pendingOfflineSync} acción{pendingOfflineSync === 1 ? "" : "es"} pendiente{pendingOfflineSync === 1 ? "" : "s"} de sincronizar.</Text>
            <TouchableOpacity onPress={() => void syncPendingOfflineActions()}><Text style={styles.offlineBannerAction}>Sincronizar</Text></TouchableOpacity>
          </View>
        )}
        {screen === "dashboard" && (
          <DashboardScreen dashboard={dashboard} realtyIntelligence={realtyIntelligence} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} />
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
            compactHeader={screen === "inbox"}
          />
        )}
        {screen === "agenda" && <AgendaScreen bookings={bookings} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadBookings(false); await loadDashboard(false); }} />}
        {screen === "pipeline" && <PipelineScreen dashboard={dashboard} profile={profile} conversations={conversations} properties={properties} refreshing={refreshing} onRefresh={refreshCurrent} onPropertyUpdated={async () => { await loadProperties(false); await loadDashboard(false); }} onOpenConversation={(conversation) => { setSelectedConversationId(conversation.id); setScreen("inbox"); }} />}
        {screen === "realtyLoads" && <RealtyLoadsScreen records={properties} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadProperties(false); await loadDashboard(false); }} />}
        {screen === "properties" && <PropertiesScreen records={properties} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadProperties(false); await loadDashboard(false); }} />}
        {screen === "realtyActivity" && <RealtyActivityScreen records={properties} profile={profile} refreshing={refreshing} onRefresh={refreshCurrent} />}
        {screen === "brokerPortal" && <BrokerPortalScreen records={properties} session={session} refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadProperties(false); await loadDashboard(false); }} />}
        {screen === "brokers" && <BrokersScreen records={properties} refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadProperties(false); await loadDashboard(false); }} />}
        {screen === "customers" && <CustomersScreen records={customers} profile={profile} recordType="customer" entityLabel="Cliente inmobiliario" entityPlural="Clientes inmobiliarios" description="Ficha comercial para relacionar compradores con propiedades y mantener su seguimiento." documentLabel="Subir documentos del cliente" refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadCustomers(false); await loadDashboard(false); }} />}
        {screen === "patients" && <CustomersScreen records={patients} profile={profile} recordType="patient" entityLabel="Paciente" entityPlural="Pacientes" description="Ficha clínica independiente para registrar antecedentes, atención y seguimiento." documentLabel="Subir exámenes o documentos" refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadPatients(false); await loadDashboard(false); }} />}
        {screen === "vehicleOwners" && <CustomersScreen records={vehicleOwners} profile={profile} recordType="vehicle" entityLabel="Dueño y vehículo" entityPlural="Dueños y vehículos" description="Ficha automotriz para mantener vehículo, dueño, presupuestos e historial de taller." documentLabel="Subir presupuesto o documentos del vehículo" refreshing={refreshing} onRefresh={refreshCurrent} onCreated={async () => { await loadVehicleOwners(false); await loadDashboard(false); }} />}
        {screen === "campaigns" && <CampaignsScreen profile={profile} conversations={conversations} campaigns={campaigns} onRefresh={loadCampaigns} />}
        {screen === "admin" && <AdminScreen tenants={adminTenants} onToggleModule={toggleTenantModule} onRefresh={loadAdminTenants} />}
      </View>
    </SafeAreaView>
  );
}

function SideNav({
  items,
  active,
  session,
  profile,
  open,
  setOpen,
  onChange,
  onLogout
}: {
  items: typeof navItems;
  active: ScreenKey;
  session: SessionState;
  profile: IndustryProfile;
  open: boolean;
  setOpen: (open: boolean) => void;
  onChange: (key: ScreenKey) => void;
  onLogout: () => void;
}) {
  const { width } = useWindowDimensions();
  const menuWidth = Math.min(width - 16, 360);
  return (
    <>
      {!open && (
        <TouchableOpacity style={styles.floatingMenuButton} onPress={() => setOpen(true)}>
          <Image source={evolumLogo} style={styles.sideLogoImage} />
        </TouchableOpacity>
      )}

      {open && (
        <View style={styles.menuOverlay}>
          <View style={[styles.fullMenu, { width: menuWidth }]}>
            <View style={styles.fullMenuTop}>
              <View style={styles.sideLogo}><Image source={evolumLogo} style={styles.sideLogoImage} /></View>
              <TouchableOpacity style={styles.iconButton} onPress={() => setOpen(false)}><Text style={styles.iconButtonText}>x</Text></TouchableOpacity>
            </View>
            <View style={styles.accountBlock}>
              <Text style={styles.headerEyebrow}>EVOLUM / {profile.label}</Text>
              <Text style={styles.menuAccountName}>{session.tenant?.name || session.user.name}</Text>
              <Text style={styles.muted}>Nivel: {session.tenant?.plan || session.tenant?.type || "STARTER"}</Text>
              <Text style={styles.muted}>Usuario: {session.user.name}</Text>
              {session.user.jobTitle ? <Text style={styles.muted}>Cargo: {session.user.jobTitle}</Text> : null}
            </View>
            <ScrollView style={styles.menuItems} contentContainerStyle={styles.menuItemsContent} showsVerticalScrollIndicator={false}>
              {items.map((item) => (
                <TouchableOpacity key={item.key} style={[styles.menuItem, active === item.key && styles.menuItemActive]} onPress={() => onChange(item.key)}>
                  <View style={[styles.menuIcon, active === item.key && styles.menuIconActive]}><Text style={styles.sideItemTextActive}>{item.short}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuItemTitle}>{item.label}</Text>
                    <Text style={styles.menuItemSub}>{item.module || "cuenta"}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.logoutButton} onPress={onLogout}><Text style={styles.logoutButtonText}>Cerrar sesion</Text></TouchableOpacity>
          </View>
          <Pressable style={styles.menuScrim} onPress={() => setOpen(false)} />
        </View>
      )}
    </>
  );
}

function DashboardScreen({ dashboard, realtyIntelligence, profile, refreshing, onRefresh }: { dashboard: CrmOperationalDashboard | null; realtyIntelligence: RealtyIntelligence | null; profile: IndustryProfile; refreshing: boolean; onRefresh: () => void }) {
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
      <Panel title="Estado comercial">
        <View style={styles.compactMetrics}>
          <Kpi label="Listos cierre" value={dashboard?.kpis.readyToClose ?? 0} detail={`${dashboard?.kpis.averageCloseScore ?? 0}% score IA`} />
          <Kpi label="Conversion" value={`${dashboard?.kpis.conversionRate ?? 0}%`} detail={money(dashboard?.revenue.estimated)} />
        </View>
      </Panel>
      {realtyIntelligence ? <Panel title="Inteligencia inmobiliaria">
        <View style={styles.compactMetrics}>
          <Kpi label="Ficha completa" value={`${realtyIntelligence.inventory.averageCompleteness}%`} detail={`${realtyIntelligence.inventory.total} propiedades`} />
          <Kpi label="Visitas" value={realtyIntelligence.visits.pending} detail="seguimientos activos" />
        </View>
        {(realtyIntelligence.priorities || []).slice(0, 3).map((item) => <ListRow key={item.code} left="IA" title={item.message} subtitle={item.priority === "high" ? "Prioridad alta" : "Recomendación operacional"} />)}
      </Panel> : null}
      <Panel title="Actividad reciente">
        {(dashboard?.activity || []).slice(0, 5).map((item) => (
          <ListRow key={item.id} left={initials(item.type)} title={item.title} subtitle={item.description} right={dateLabel(item.createdAt)} />
        ))}
        {!dashboard?.activity?.length && <Text style={styles.muted}>Sin actividad registrada.</Text>}
      </Panel>
      <Panel title="Proximas actividades">
        {(dashboard?.upcomingBookings || []).slice(0, 4).map((booking) => (
          <ListRow key={booking.id} left="AG" title={booking.name || profile.bookingLabel} subtitle={`${dateLabel(booking.date)} ${timeLabel(booking.date)} / ${booking.location || "Sin ubicacion"}`} right={booking.status} />
        ))}
        {!dashboard?.upcomingBookings?.length && <Text style={styles.muted}>Sin reservas proximas.</Text>}
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
  compactHeader?: boolean;
}) {
  const active = props.selectedConversation;
  return (
    <KeyboardAvoidingView
      style={styles.inboxRoot}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      {!props.compactHeader && <View style={styles.chatHeader}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(active?.contact.name || active?.contact.externalId)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatName}>{active?.contact.name || active?.contact.externalId || "Inbox"}</Text>
          <Text style={styles.chatSub}>{active ? `${active.contact.channel} / ${active.status} / ${active.mode}` : "Selecciona una conversacion"}</Text>
        </View>
        <TouchableOpacity style={styles.chatsButton} onPress={() => props.setDrawerOpen(true)}>
          <Text style={styles.chatsButtonText}>CHATS</Text>
        </TouchableOpacity>
      </View>}

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
    </KeyboardAvoidingView>
  );
}

function AgendaScreen({
  bookings,
  profile,
  refreshing,
  onRefresh,
  onCreated
}: {
  bookings: Booking[];
  profile: IndustryProfile;
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void;
}) {
  const [monthDate, setMonthDate] = useState(new Date());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(inputDateTime());
  const [guests, setGuests] = useState("2");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(calendarStart.getDate() - ((calendarStart.getDay() + 6) % 7));
  const days = Array.from({ length: 35 }, (_, index) => {
    const day = new Date(calendarStart);
    day.setDate(calendarStart.getDate() + index);
    return day;
  });
  const visibleBookings = bookings.filter((booking) => monthKey(new Date(booking.date)) === monthKey(monthDate));

  async function submitBooking() {
    try {
      setSaving(true);
      await createBooking({
        name: name.trim() || "Reserva movil",
        phone: phone.trim() || undefined,
        date: new Date(date).toISOString(),
        guests: Number(guests || 1),
        location: location.trim() || undefined,
        total: 0,
        notes: "Creada desde app movil"
      });
      Alert.alert("Fecha agendada", "La reserva quedo registrada.");
      setName("");
      setPhone("");
      setGuests("2");
      setLocation("");
      setDate(inputDateTime());
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo agendar fecha", error instanceof Error ? error.message : "Revisa los datos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Agenda</Text>
      <Text style={styles.screenTitle}>Agenda {profile.label}</Text>
      <Text style={styles.screenSubtitle}>{profile.bookingLabel}s creadas por IA o manualmente.</Text>
      <Panel title={monthDate.toLocaleDateString("es-CL", { month: "long", year: "numeric" })}>
        <View style={styles.calendarActions}>
          <MiniButton label="<" onPress={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))} />
          <MiniButton label="Hoy" onPress={() => setMonthDate(new Date())} />
          <MiniButton label=">" onPress={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))} />
        </View>
        <View style={styles.calendarGrid}>
          {["L", "M", "M", "J", "V", "S", "D"].map((label, index) => <Text key={`${label}-${index}`} style={styles.calendarHead}>{label}</Text>)}
          {days.map((day) => {
            const dayBookings = bookings.filter((booking) => sameDay(new Date(booking.date), day));
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const outside = day.getMonth() !== monthDate.getMonth();
            return (
              <View key={day.toISOString()} style={[styles.calendarDay, isWeekend && styles.calendarWeekend, outside && styles.calendarOutside]}>
                <Text style={styles.calendarNumber}>{day.getDate()}</Text>
                {dayBookings.slice(0, 2).map((booking) => (
                  <Text key={booking.id} style={styles.calendarBooking} numberOfLines={2}>{timeLabel(booking.date)} {booking.name || profile.bookingLabel}</Text>
                ))}
              </View>
            );
          })}
        </View>
      </Panel>
      <Panel title="Crear reserva">
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nombre del cliente" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+56 9..." placeholderTextColor={colors.muted} keyboardType="phone-pad" />
        <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="2026-06-24T19:30" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={guests} onChangeText={setGuests} placeholder="Personas" placeholderTextColor={colors.muted} keyboardType="number-pad" />
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Sucursal, direccion u online" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.primaryButton} onPress={submitBooking} disabled={saving}><Text style={styles.primaryButtonText}>{saving ? "Agendando..." : "Crear reserva"}</Text></TouchableOpacity>
      </Panel>
      <Panel title={`Proximas ${profile.bookingLabel.toLowerCase()}s`}>
        {visibleBookings.slice(0, 12).map((booking) => (
          <ListRow key={booking.id} left="AG" title={booking.name || profile.bookingLabel} subtitle={`${dateLabel(booking.date)} / ${booking.location || "Sin ubicacion"} / ${booking.guests} personas`} right={booking.status} />
        ))}
        {!visibleBookings.length && <Text style={styles.muted}>Sin reservas para este mes.</Text>}
      </Panel>
    </ScrollView>
  );
}

function PipelineScreen({
  dashboard,
  profile,
  conversations,
  properties,
  refreshing,
  onRefresh,
  onPropertyUpdated,
  onOpenConversation
}: {
  dashboard: CrmOperationalDashboard | null;
  profile: IndustryProfile;
  conversations: Conversation[];
  properties: IndustryRecord[];
  refreshing: boolean;
  onRefresh: () => void;
  onPropertyUpdated: () => void | Promise<void>;
  onOpenConversation: (conversation: Conversation) => void;
}) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedRealtyStage, setSelectedRealtyStage] = useState<string | null>(null);
  const stageBuckets = profile.pipelineStages.map((stage, index) => {
    const items = conversations.filter((conversation) => {
      const score = conversation.aiCloseScore || 0;
      if (index === 0) return score < 30;
      if (index === 1) return score >= 30 && score < 55;
      if (index === 2) return score >= 55 && score < 75;
      if (index === 3) return score >= 75 && score < 90;
      return score >= 90 || conversation.aiHandoffRequired;
    });
    return { stage, items, value: dashboard?.pipeline?.[index]?.value || 0 };
  });
  const visibleBuckets = selectedStage ? stageBuckets.filter((bucket) => bucket.stage === selectedStage) : stageBuckets;
  const realtyBuckets = REALTY_STAGES.map((stage) => ({
    stage,
    items: properties.filter((record) => realtyStage(record) === stage),
    value: properties.filter((record) => realtyStage(record) === stage).reduce((sum, record) => sum + realtyPrice(record), 0)
  }));
  const visibleRealtyBuckets = selectedRealtyStage ? realtyBuckets.filter((bucket) => bucket.stage === selectedRealtyStage) : realtyBuckets;

  async function updatePropertyStage(record: IndustryRecord, stage: string) {
    try {
      await updateIndustryRecord(record.id, {
        status: stage === "Cierre" ? "closed" : "active",
        data: { ...(record.data || {}), stage, updatedFrom: "mobile_pipeline" }
      });
      await onPropertyUpdated();
    } catch (error) {
      Alert.alert("No se pudo mover propiedad", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  return (
    <ScrollView horizontal={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>CRM</Text>
      <Text style={styles.screenTitle}>Pipeline</Text>
      <Text style={styles.screenSubtitle}>Pipeline comercial general e inmobiliario dentro de un solo modulo.</Text>
      <Panel title="Resumen comercial">
        <View style={styles.compactMetrics}>
          <Kpi label="Oportunidades" value={conversations.length} detail={`${dashboard?.kpis.readyToClose ?? 0} listas`} />
          <Kpi label="Promedio IA" value={`${dashboard?.kpis.averageCloseScore ?? 0}%`} detail="score cierre" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
          <TouchableOpacity style={[styles.filterPill, !selectedStage && styles.filterPillActive]} onPress={() => setSelectedStage(null)}><Text style={[styles.filterText, !selectedStage && styles.filterTextActive]}>Todas</Text></TouchableOpacity>
          {profile.pipelineStages.map((stage) => (
            <TouchableOpacity key={stage} style={[styles.filterPill, selectedStage === stage && styles.filterPillActive]} onPress={() => setSelectedStage(stage)}><Text style={[styles.filterText, selectedStage === stage && styles.filterTextActive]}>{stage}</Text></TouchableOpacity>
          ))}
        </ScrollView>
      </Panel>
      <View style={styles.stageList}>
        {visibleBuckets.map(({ stage, items, value }) => {
          return (
            <View key={stage} style={styles.stageCard}>
              <View style={styles.stageHeader}><Text style={styles.stageTitle}>{stage}</Text><Text style={styles.stageCount}>{items.length}</Text></View>
              {!!value && <Text style={styles.muted}>{money(value)} estimado</Text>}
              {items.slice(0, 6).map((item) => (
                <TouchableOpacity key={item.id} style={styles.opportunityCard} onPress={() => onOpenConversation(item)}>
                  <Text style={styles.cardTitle}>{item.contact.name || item.contact.externalId}</Text>
                  <Text style={styles.muted}>{item.aiSummary || item.lastMessage?.content || "Oportunidad comercial"}</Text>
                  <Text style={styles.scoreText}>{item.aiCloseScore || 0}% cierre</Text>
                </TouchableOpacity>
              ))}
              {!items.length && <Text style={styles.mutedCenter}>Sin oportunidades en esta etapa.</Text>}
            </View>
          );
        })}
      </View>
      <Panel title="Pipeline inmobiliario">
        <View style={styles.compactMetrics}>
          <Kpi label="Propiedades" value={properties.length} detail="cargadas" />
          <Kpi label="Valor cartera" value={properties.reduce((sum, record) => sum + realtyPrice(record), 0) ? money(properties.reduce((sum, record) => sum + realtyPrice(record), 0)) : "Sin precio"} detail="inventario" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
          <TouchableOpacity style={[styles.filterPill, !selectedRealtyStage && styles.filterPillActive]} onPress={() => setSelectedRealtyStage(null)}><Text style={[styles.filterText, !selectedRealtyStage && styles.filterTextActive]}>Todas</Text></TouchableOpacity>
          {REALTY_STAGES.map((stage) => (
            <TouchableOpacity key={stage} style={[styles.filterPill, selectedRealtyStage === stage && styles.filterPillActive]} onPress={() => setSelectedRealtyStage(stage)}><Text style={[styles.filterText, selectedRealtyStage === stage && styles.filterTextActive]}>{stage}</Text></TouchableOpacity>
          ))}
        </ScrollView>
      </Panel>
      <View style={styles.stageList}>
        {visibleRealtyBuckets.map(({ stage, items, value }) => (
          <View key={`realty-${stage}`} style={styles.stageCard}>
            <View style={styles.stageHeader}><Text style={styles.stageTitle}>{stage}</Text><Text style={styles.stageCount}>{items.length}</Text></View>
            {!!value && <Text style={styles.muted}>{money(value)} cartera</Text>}
            {items.slice(0, 6).map((record) => (
              <View key={record.id} style={styles.opportunityCard}>
                <Text style={styles.cardTitle}>{record.title}</Text>
                <Text style={styles.muted}>{recordText(record, "location", "Sin ubicacion")} / {record.assignedTo?.name || recordText(record, "assignedToName", "Sin corredor")}</Text>
                <Text style={styles.scoreText}>{realtyPrice(record) ? money(realtyPrice(record)) : recordText(record, "price", "Sin precio")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                  {REALTY_STAGES.map((nextStage) => (
                    <TouchableOpacity key={nextStage} style={[styles.filterPill, realtyStage(record) === nextStage && styles.filterPillActive]} onPress={() => updatePropertyStage(record, nextStage)}>
                      <Text style={[styles.filterText, realtyStage(record) === nextStage && styles.filterTextActive]}>{nextStage}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}
            {!items.length && <Text style={styles.mutedCenter}>Sin propiedades en esta etapa.</Text>}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function RealtyLoadsScreen({
  records,
  profile,
  refreshing,
  onRefresh,
  onCreated
}: {
  records: IndustryRecord[];
  profile: IndustryProfile;
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [rooms, setRooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [parking, setParking] = useState("");
  const [meters, setMeters] = useState("");
  const [material, setMaterial] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFileName, setPhotoFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importPreview, setImportPreview] = useState<PropertyImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [industryUsers, setIndustryUsers] = useState<IndustryUser[]>([]);
  const [leads, setLeads] = useState<IndustryRecord[]>([]);
  const [visits, setVisits] = useState<IndustryRecord[]>([]);
  const [deals, setDeals] = useState<IndustryRecord[]>([]);
  const [forecasts, setForecasts] = useState<IndustryRecord[]>([]);
  const [assignmentPreview, setAssignmentPreview] = useState<Array<{ item: IndustryRecord; assignee: IndustryUser; order: number; mode: string }>>([]);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadInterest, setLeadInterest] = useState("");
  const [visitClient, setVisitClient] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const validImportRows = useMemo(() => importPreview.filter((row) => !row.errors.length), [importPreview]);
  const sellers = useMemo(() => {
    const activeUsers = industryUsers.filter((user) => user.isActive !== false);
    const sellerUsers = activeUsers.filter((user) => String(user.role || "").toUpperCase().includes("SELLER"));
    return sellerUsers.length ? sellerUsers : activeUsers;
  }, [industryUsers]);
  const selectedProperty = records.find((record) => record.id === selectedPropertyId) || records[0];
  const portfolioValue = records.reduce((sum, record) => sum + realtyPrice(record), 0);
  const readyRecords = records.filter((record) => ["Contacto", "Propuesta", "Negociacion", "Cierre"].includes(realtyStage(record)));
  const predictiveScore = records.length
    ? Math.min(100, Math.round((readyRecords.length / records.length) * 45 + Math.min(visits.length * 7, 25) + Math.min(deals.length * 15, 30)))
    : 0;
  const assignedCount = records.filter((record) => record.assignedToId || record.data?.assignedToName).length;

  async function loadRealtyWorkspace() {
    try {
      setWorkspaceLoading(true);
      const [usersData, leadsData, visitsData, dealsData, forecastData] = await Promise.all([
        getIndustryUsers().catch(() => [] as IndustryUser[]),
        getIndustryRecords("lead").catch(() => [] as IndustryRecord[]),
        getIndustryRecords("visit").catch(() => [] as IndustryRecord[]),
        getIndustryRecords("deal").catch(() => [] as IndustryRecord[]),
        getIndustryRecords("forecast").catch(() => [] as IndustryRecord[])
      ]);
      setIndustryUsers(usersData);
      setLeads(leadsData);
      setVisits(visitsData);
      setDeals(dealsData);
      setForecasts(forecastData);
      if (!selectedPropertyId && records[0]) setSelectedPropertyId(records[0].id);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  useEffect(() => {
    loadRealtyWorkspace();
  }, []);

  useEffect(() => {
    if (!selectedPropertyId && records[0]) setSelectedPropertyId(records[0].id);
  }, [records.length, selectedPropertyId]);

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Autoriza acceso a tus fotos para cargar imagenes de propiedades.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.72,
      base64: true
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const base64 = asset.base64 || await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" as any });
    setPhotoUrl(dataUrlFromFile(asset.fileName || "propiedad.jpg", asset.mimeType || "image/jpeg", base64));
    setPhotoFileName(asset.fileName || "foto-propiedad.jpg");
  }

  async function pickPropertyCsv() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values"],
      copyToCacheDirectory: true,
      multiple: false
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (asset.size && asset.size > 6 * 1024 * 1024) {
      Alert.alert("Archivo muy grande", "Sube un CSV de hasta 6 MB para mantener la app rapida.");
      return;
    }

    try {
      const csv = await FileSystem.readAsStringAsync(asset.uri, { encoding: "utf8" as any });
      const rows = parseCsvRows(csv);
      if (!rows.length) {
        Alert.alert("CSV sin datos", "No se encontraron filas validas.");
        return;
      }
      const preview = rows.slice(0, 250).map((row, index) => parsePropertyImportRow(row, index));
      setImportFileName(asset.name || "propiedades.csv");
      setImportPreview(preview);
      setImportSummary(`${preview.filter((row) => !row.errors.length).length} listas / ${preview.length} filas leidas`);
    } catch (error) {
      setImportPreview([]);
      setImportSummary("");
      Alert.alert("No se pudo leer el CSV", error instanceof Error ? error.message : "Revisa el formato del archivo.");
    }
  }

  async function importPropertiesFromCsv() {
    if (!validImportRows.length) {
      Alert.alert("Sin filas validas", "Primero selecciona un CSV con propiedades completas.");
      return;
    }

    const importBatchId = `mobile-property-import-${Date.now()}`;
    const importedIds: string[] = [];
    let skippedRows = importPreview.length - validImportRows.length;

    try {
      setImporting(true);
      for (const row of validImportRows) {
        let ownerId = "";
        if (row.ownerName) {
          const owner = await createIndustryRecord({
            recordType: "owner",
            title: row.ownerName,
            status: "active",
            data: {
              name: row.ownerName,
              phone: row.ownerPhone,
              email: row.ownerEmail,
              origin: row.captureOrigin,
              source: "mobile_csv_import",
              importBatchId,
              importFileName,
              importRowNumber: row.rowNumber
            }
          });
          ownerId = owner.id;
        }

        const property = await createIndustryRecord({
          recordType: "property",
          title: row.title,
          status: "available",
          data: {
            propertyType: row.propertyType,
            operation: row.operation,
            price: row.price,
            location: row.address,
            address: row.address,
            material: row.material,
            rooms: row.bedrooms,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
            parking: row.parking,
            meters: row.meters,
            photoUrl: row.photoUrl,
            notes: row.observations,
            observations: row.observations,
            ownerId,
            ownerName: row.ownerName,
            captureOrigin: row.captureOrigin,
            captureDate: row.captureDate,
            assignedToName: row.assignedToName,
            stage: row.stage,
            source: "mobile_csv_import",
            importBatchId,
            importFileName,
            importRowNumber: row.rowNumber,
            recognizedFields: row.recognizedFields,
            predictiveLearning: {
              enabled: true,
              source: "mobile_bulk_property_upload",
              confidenceBase: Math.min(100, row.recognizedFields * 8)
            }
          }
        });
        importedIds.push(property.id);
      }

      await createIndustryRecord({
        recordType: "ai_interaction",
        title: `Aprendizaje inmobiliario movil ${new Date().toLocaleDateString("es-CL")}`,
        status: "processed",
        data: {
          agentType: "realty_mobile_csv_learning",
          context: "Importacion masiva de propiedades desde app movil para acelerar aprendizaje predictivo.",
          result: `${importedIds.length} propiedades importadas`,
          requiresSupervision: false,
          importBatchId,
          importFileName,
          importedPropertyIds: importedIds,
          skippedRows
        }
      });

      Alert.alert("CSV importado", `${importedIds.length} propiedades quedaron cargadas para la IA predictiva.`);
      setImportPreview([]);
      setImportFileName("");
      setImportSummary("");
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo importar", error instanceof Error ? error.message : "Revisa la conexion y el formato.");
    } finally {
      setImporting(false);
    }
  }

  async function saveProperty() {
    if (!title.trim()) {
      Alert.alert("Falta nombre", "Agrega un nombre o direccion para la propiedad.");
      return;
    }
    try {
      setSaving(true);
      await createIndustryRecord({
        recordType: "property",
        title: title.trim(),
        status: "available",
        data: {
          price,
          location,
          rooms,
          bathrooms,
          parking,
          meters,
          material,
          notes,
          photoUrl,
          photoFileName,
          stage: "Prospeccion",
          source: "mobile"
        }
      });
      Alert.alert("Propiedad guardada", "La ficha quedo disponible en EVOLUM.");
      setTitle("");
      setPrice("");
      setLocation("");
      setRooms("");
      setBathrooms("");
      setParking("");
      setMeters("");
      setMaterial("");
      setNotes("");
      setPhotoUrl("");
      setPhotoFileName("");
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : "Revisa los datos.");
    } finally {
      setSaving(false);
    }
  }

  async function calculateAssignments() {
    try {
      setWorkspaceLoading(true);
      const result = await getBalancedIndustryAssignments({ recordType: "property", assigneeRole: "SELLER" });
      setAssignmentPreview(result.assignments || []);
      if (!result.assignments?.length) Alert.alert("Sin reparto pendiente", "No hay propiedades o vendedores disponibles para repartir.");
    } catch (error) {
      Alert.alert("No se pudo calcular", error instanceof Error ? error.message : "Revisa vendedores y propiedades.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function applyAssignments() {
    if (!assignmentPreview.length) {
      Alert.alert("Primero calcula", "Genera una propuesta de reparto antes de aplicarla.");
      return;
    }
    try {
      setWorkspaceLoading(true);
      await Promise.all(assignmentPreview.map(({ item, assignee }) => updateIndustryRecord(item.id, {
        assignedToId: assignee.id,
        data: {
          ...(item.data || {}),
          assignedToName: assignee.name,
          assignmentMode: "mobile_balanced",
          assignedAt: new Date().toISOString()
        }
      })));
      Alert.alert("Reparto aplicado", "Las propiedades quedaron asignadas al equipo comercial.");
      setAssignmentPreview([]);
      await onCreated();
      await loadRealtyWorkspace();
    } catch (error) {
      Alert.alert("No se pudo aplicar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function updatePropertyStage(record: IndustryRecord, stage: string) {
    try {
      await updateIndustryRecord(record.id, {
        status: stage === "Cierre" ? "closed" : "active",
        data: { ...(record.data || {}), stage, updatedFrom: "mobile_realty" }
      });
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo mover etapa", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  async function assignProperty(record: IndustryRecord, assigneeId: string) {
    const assignee = sellers.find((user) => user.id === assigneeId);
    try {
      await updateIndustryRecord(record.id, {
        assignedToId: assigneeId || null,
        data: {
          ...(record.data || {}),
          assignedToName: assignee?.name || "",
          assignmentMode: assigneeId ? "mobile_manual" : "unassigned",
          assignedAt: assigneeId ? new Date().toISOString() : null
        }
      });
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo asignar", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  async function createPredictiveSnapshot() {
    try {
      setWorkspaceLoading(true);
      const projectedValue = readyRecords.reduce((sum, record) => sum + Math.round(realtyPrice(record) * 0.65), 0);
      await createIndustryRecord({
        recordType: "forecast",
        title: `Forecast inmobiliario movil ${new Date().toLocaleDateString("es-CL")}`,
        status: "active",
        data: {
          source: "mobile_realty_predictive_snapshot",
          properties: records.length,
          assigned: assignedCount,
          visits: visits.length,
          deals: deals.length,
          readyRecords: readyRecords.length,
          portfolioValue,
          projectedValue,
          predictiveScore
        }
      });
      await createIndustryRecord({
        recordType: "ai_interaction",
        title: "Snapshot IA inmobiliaria",
        status: "processed",
        data: {
          agentType: "realty_predictive_mobile",
          context: "La app consolido propiedades, visitas, asignaciones y cierres para mejorar prediccion comercial.",
          predictiveScore,
          requiresSupervision: predictiveScore < 45
        }
      });
      Alert.alert("IA actualizada", "Se guardo un snapshot predictivo para la vertical inmobiliaria.");
      await loadRealtyWorkspace();
    } catch (error) {
      Alert.alert("No se pudo actualizar IA", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function createCaptureOpportunity() {
    if (!leadName.trim()) {
      Alert.alert("Falta contacto", "Agrega el nombre del interesado o propietario.");
      return;
    }
    try {
      setWorkspaceLoading(true);
      await createIndustryRecord({
        recordType: "lead",
        title: leadName.trim(),
        status: "new",
        data: {
          name: leadName.trim(),
          phone: leadPhone,
          interest: leadInterest,
          propertyId: selectedProperty?.id,
          propertyTitle: selectedProperty?.title,
          source: "mobile_realty_capture",
          stage: "Prospeccion"
        }
      });
      Alert.alert("Lead creado", "La oportunidad quedo disponible para seguimiento inmobiliario.");
      setLeadName("");
      setLeadPhone("");
      setLeadInterest("");
      await loadRealtyWorkspace();
    } catch (error) {
      Alert.alert("No se pudo crear lead", error instanceof Error ? error.message : "Revisa la conexion.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function createVisit() {
    if (!selectedProperty) {
      Alert.alert("Sin propiedad", "Carga o selecciona una propiedad primero.");
      return;
    }
    if (!visitClient.trim() || !visitDate.trim()) {
      Alert.alert("Faltan datos", "Agrega cliente y fecha/hora de visita.");
      return;
    }
    try {
      setWorkspaceLoading(true);
      await createIndustryRecord({
        recordType: "visit",
        title: `Visita ${selectedProperty.title}`,
        status: "scheduled",
        assignedToId: selectedProperty.assignedToId || null,
        data: {
          client: visitClient.trim(),
          scheduledAt: visitDate.trim(),
          propertyId: selectedProperty.id,
          propertyTitle: selectedProperty.title,
          location: recordText(selectedProperty, "location", ""),
          assignedToName: recordText(selectedProperty, "assignedToName", ""),
          source: "mobile_realty_visit"
        }
      });
      Alert.alert("Visita agendada", "La visita quedo registrada en la vertical inmobiliaria.");
      setVisitClient("");
      setVisitDate("");
      await loadRealtyWorkspace();
    } catch (error) {
      Alert.alert("No se pudo crear visita", error instanceof Error ? error.message : "Revisa los datos.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function createDeal() {
    if (!selectedProperty) {
      Alert.alert("Sin propiedad", "Selecciona una propiedad para cerrar.");
      return;
    }
    const value = Number(String(dealValue || realtyPrice(selectedProperty)).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert("Valor invalido", "Agrega un valor de cierre valido.");
      return;
    }
    const commission = commissionProjection(value);
    try {
      setWorkspaceLoading(true);
      await createIndustryRecord({
        recordType: "deal",
        title: `Cierre ${selectedProperty.title}`,
        status: "open",
        assignedToId: selectedProperty.assignedToId || null,
        data: {
          propertyId: selectedProperty.id,
          propertyTitle: selectedProperty.title,
          value,
          commission,
          assignedToName: recordText(selectedProperty, "assignedToName", ""),
          source: "mobile_realty_deal"
        }
      });
      await updateIndustryRecord(selectedProperty.id, {
        status: "closed",
        data: {
          ...(selectedProperty.data || {}),
          stage: "Cierre",
          dealValue: value,
          commission
        }
      });
      Alert.alert("Cierre registrado", `Comision estimada: ${money(commission.total)}.`);
      setDealValue("");
      await onCreated();
      await loadRealtyWorkspace();
    } catch (error) {
      Alert.alert("No se pudo crear cierre", error instanceof Error ? error.message : "Revisa la conexion.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Rubro {profile.label}</Text>
      <Text style={styles.screenTitle}>Propiedades</Text>
      <Text style={styles.screenSubtitle}>Carga viviendas, fotos y atributos comerciales para asignarlas al equipo.</Text>
      <View style={styles.compactMetrics}>
        <Kpi label="Propiedades" value={records.length} detail={`${assignedCount} asignadas`} />
        <Kpi label="Cartera" value={portfolioValue ? money(portfolioValue) : "Sin precio"} detail={`${sellers.length} vendedores`} />
      </View>
      <View style={styles.compactMetrics}>
        <Kpi label="Visitas" value={visits.length} detail={`${leads.length} leads`} />
        <Kpi label="Score IA" value={`${predictiveScore}%`} detail={`${forecasts.length} forecasts`} />
      </View>
      <Panel title="Importar CSV para IA">
        <Text style={styles.muted}>Sube un CSV con propiedades, propietarios, atributos y vendedor sugerido. EVOLUM creara fichas y dejara metadata para el aprendizaje predictivo.</Text>
        <View style={styles.importActionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={pickPropertyCsv} disabled={importing}>
            <Text style={styles.secondaryButtonText}>{importFileName || "Seleccionar CSV"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={importPropertiesFromCsv} disabled={importing || !validImportRows.length}>
            <Text style={styles.primaryButtonText}>{importing ? "Importando..." : "Importar"}</Text>
          </TouchableOpacity>
        </View>
        {!!importSummary && <Text style={styles.greenText}>{importSummary}</Text>}
        {!!importPreview.length && (
          <View style={styles.importPreviewBox}>
            {importPreview.slice(0, 5).map((row) => (
              <View key={`${row.rowNumber}-${row.title}`} style={[styles.importPreviewRow, row.errors.length ? styles.importPreviewRowError : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.muted} numberOfLines={1}>{row.address || "Sin direccion"} / {row.assignedToName || "Sin vendedor"}</Text>
                </View>
                <Text style={row.errors.length ? styles.dangerText : styles.greenText}>{row.errors.length ? "Revisar" : money(row.price)}</Text>
              </View>
            ))}
            {importPreview.length > 5 && <Text style={styles.muted}>Vista previa de 5 filas. Se importaran todas las filas validas.</Text>}
          </View>
        )}
      </Panel>
      <Panel title="Reparto por vendedor">
        <Text style={styles.muted}>Distribuye propiedades sin vendedor de forma balanceada y deja metadata para auditoria comercial.</Text>
        <View style={styles.formRow}>
          <TouchableOpacity style={[styles.secondaryButton, styles.formHalf]} onPress={calculateAssignments} disabled={workspaceLoading}>
            <Text style={styles.secondaryButtonText}>{workspaceLoading ? "Calculando..." : "Calcular reparto"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryButton, styles.formHalf]} onPress={applyAssignments} disabled={!assignmentPreview.length || workspaceLoading}>
            <Text style={styles.primaryButtonText}>Aplicar</Text>
          </TouchableOpacity>
        </View>
        {!!assignmentPreview.length && assignmentPreview.slice(0, 6).map(({ item, assignee }) => (
          <ListRow key={`${item.id}-${assignee.id}`} left="RE" title={item.title} subtitle={`Asignar a ${assignee.name}`} right={recordText(item, "location", "")} />
        ))}
        {!assignmentPreview.length && <Text style={styles.muted}>{sellers.length ? `${sellers.length} vendedores disponibles.` : "Crea usuarios vendedores para activar reparto automatico."}</Text>}
      </Panel>
      <Panel title="IA predictiva inmobiliaria">
        <Text style={styles.muted}>Consolida propiedades, visitas, cierres y asignaciones para acelerar aprendizaje comercial de la vertical.</Text>
        <View style={styles.compactMetrics}>
          <Kpi label="Listas" value={readyRecords.length} detail="contacto o mas" />
          <Kpi label="Forecast" value={portfolioValue ? money(Math.round(portfolioValue * 0.65)) : "$0"} detail="ponderado" />
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={createPredictiveSnapshot} disabled={workspaceLoading}>
          <Text style={styles.primaryButtonText}>{workspaceLoading ? "Actualizando..." : "Crear snapshot IA"}</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title="Captacion y seguimiento">
        <TextInput style={styles.input} value={leadName} onChangeText={setLeadName} placeholder="Nombre del cliente o propietario" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={leadPhone} onChangeText={setLeadPhone} placeholder="Telefono" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
        <TextInput style={styles.input} value={leadInterest} onChangeText={setLeadInterest} placeholder="Interes, presupuesto o zona" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.primaryButton} onPress={createCaptureOpportunity} disabled={workspaceLoading}>
          <Text style={styles.primaryButtonText}>Crear lead inmobiliario</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title="Visitas y cierres">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
          {records.slice(0, 10).map((record) => (
            <TouchableOpacity key={record.id} style={[styles.filterPill, selectedProperty?.id === record.id && styles.filterPillActive]} onPress={() => setSelectedPropertyId(record.id)}>
              <Text style={[styles.filterText, selectedProperty?.id === record.id && styles.filterTextActive]} numberOfLines={1}>{record.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.muted}>{selectedProperty ? `Seleccionada: ${selectedProperty.title}` : "Selecciona una propiedad"}</Text>
        <TextInput style={styles.input} value={visitClient} onChangeText={setVisitClient} placeholder="Cliente para visita" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={visitDate} onChangeText={setVisitDate} placeholder="Fecha y hora visita ej: 2026-07-10 16:00" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.secondaryButton} onPress={createVisit} disabled={workspaceLoading}>
          <Text style={styles.secondaryButtonText}>Agendar visita</Text>
        </TouchableOpacity>
        <TextInput style={styles.input} value={dealValue} onChangeText={setDealValue} placeholder="Valor de cierre CLP" placeholderTextColor={colors.muted} keyboardType="numeric" />
        <TouchableOpacity style={styles.primaryButton} onPress={createDeal} disabled={workspaceLoading}>
          <Text style={styles.primaryButtonText}>Registrar cierre</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title="Nueva propiedad">
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Nombre, direccion o codigo" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Valor o rango" placeholderTextColor={colors.muted} keyboardType="numeric" />
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Comuna, sucursal o ubicacion" placeholderTextColor={colors.muted} />
        <View style={styles.formRow}>
          <TextInput style={[styles.input, styles.formHalf]} value={rooms} onChangeText={setRooms} placeholder="Piezas" placeholderTextColor={colors.muted} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.formHalf]} value={bathrooms} onChangeText={setBathrooms} placeholder="Banos" placeholderTextColor={colors.muted} keyboardType="number-pad" />
        </View>
        <View style={styles.formRow}>
          <TextInput style={[styles.input, styles.formHalf]} value={parking} onChangeText={setParking} placeholder="Estac." placeholderTextColor={colors.muted} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.formHalf]} value={meters} onChangeText={setMeters} placeholder="M2" placeholderTextColor={colors.muted} keyboardType="numeric" />
        </View>
        <TextInput style={styles.input} value={material} onChangeText={setMaterial} placeholder="Material de vivienda" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.uploadButton} onPress={pickPhoto}>
          <Text style={styles.uploadButtonText}>{photoFileName || "Subir foto desde el telefono"}</Text>
        </TouchableOpacity>
        {!!photoUrl && <Image source={{ uri: photoUrl }} style={styles.propertyPreview} resizeMode="cover" />}
        <TextInput style={[styles.input, styles.textArea]} value={notes} onChangeText={setNotes} placeholder="Observaciones generales" placeholderTextColor={colors.muted} multiline />
        <TouchableOpacity style={styles.primaryButton} onPress={saveProperty} disabled={saving}>
          <Text style={styles.primaryButtonText}>{saving ? "Guardando..." : "Guardar propiedad"}</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title="Propiedades activas">
        {records.slice(0, 12).map((record) => (
          <View key={record.id} style={styles.propertyCardMobile}>
            <View style={styles.recordCard}>
              <View style={styles.recordMedia}>
                {recordText(record, "photoUrl", "") ? <Image source={{ uri: recordText(record, "photoUrl", "") }} style={styles.recordImage} resizeMode="cover" /> : <Text style={styles.avatarText}>PR</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{record.title}</Text>
                <Text style={styles.muted}>{recordText(record, "location", "Sin ubicacion")} / {recordText(record, "meters", "0")} m2</Text>
                <Text style={styles.greenText}>{realtyPrice(record) ? money(realtyPrice(record)) : recordText(record, "price", "Sin precio")}</Text>
                <Text style={styles.muted}>Vendedor: {record.assignedTo?.name || recordText(record, "assignedToName", "Sin asignar")}</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
              {REALTY_STAGES.map((stage) => (
                <TouchableOpacity key={stage} style={[styles.filterPill, realtyStage(record) === stage && styles.filterPillActive]} onPress={() => updatePropertyStage(record, stage)}>
                  <Text style={[styles.filterText, realtyStage(record) === stage && styles.filterTextActive]}>{stage}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {!!sellers.length && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                {sellers.slice(0, 8).map((seller) => (
                  <TouchableOpacity key={seller.id} style={[styles.filterPill, record.assignedToId === seller.id && styles.filterPillActive]} onPress={() => assignProperty(record, seller.id)}>
                    <Text style={[styles.filterText, record.assignedToId === seller.id && styles.filterTextActive]}>{seller.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.compactMetrics}>
              <Kpi label="Etapa" value={realtyStage(record)} detail="pipeline" />
              <Kpi label="Comision" value={realtyPrice(record) ? money(commissionProjection(realtyPrice(record)).total) : "$0"} detail="estimada" />
            </View>
          </View>
        ))}
        {!records.length && <Text style={styles.muted}>Aun no hay propiedades cargadas.</Text>}
      </Panel>
    </ScrollView>
  );
}

function PropertiesScreen({
  records,
  profile,
  refreshing,
  onRefresh,
  onCreated
}: {
  records: IndustryRecord[];
  profile: IndustryProfile;
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void | Promise<void>;
}) {
  async function updatePropertyStage(record: IndustryRecord, stage: string) {
    try {
      await updateIndustryRecord(record.id, {
        status: stage === "Cierre" ? "closed" : "active",
        data: { ...(record.data || {}), stage, updatedFrom: "mobile_property_portal" }
      });
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo actualizar", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Portal inmobiliario</Text>
      <Text style={styles.screenTitle}>Propiedades cargadas</Text>
      <Text style={styles.screenSubtitle}>Vista tipo portal para corredores y jefe comercial.</Text>
      {records.map((record) => (
        <View key={record.id} style={styles.portalPropertyCard}>
          <View style={styles.portalImageWrap}>
            {recordText(record, "photoUrl", "") ? <Image source={{ uri: recordText(record, "photoUrl", "") }} style={styles.portalImage} resizeMode="cover" /> : <Text style={styles.portalImageInitials}>PR</Text>}
          </View>
          <View style={styles.portalBody}>
            <Text style={styles.cardTitle}>{record.title}</Text>
            <Text style={styles.portalPrice}>{realtyPrice(record) ? money(realtyPrice(record)) : recordText(record, "price", "Sin precio")}</Text>
            <Text style={styles.muted}>{recordText(record, "location", "Sin ubicacion")}</Text>
            <View style={styles.portalSpecs}>
              <Text style={styles.specPill}>{recordText(record, "rooms", "0")} dorm.</Text>
              <Text style={styles.specPill}>{recordText(record, "bathrooms", "0")} banos</Text>
              <Text style={styles.specPill}>{recordText(record, "parking", "0")} estac.</Text>
              <Text style={styles.specPill}>{recordText(record, "meters", "0")} m2</Text>
            </View>
            <Text style={styles.muted}>Corredor: {record.assignedTo?.name || recordText(record, "assignedToName", "Sin asignar")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
              {REALTY_STAGES.map((stage) => (
                <TouchableOpacity key={stage} style={[styles.filterPill, realtyStage(record) === stage && styles.filterPillActive]} onPress={() => updatePropertyStage(record, stage)}>
                  <Text style={[styles.filterText, realtyStage(record) === stage && styles.filterTextActive]}>{stage}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ))}
      {!records.length && <Text style={styles.muted}>Aun no hay propiedades cargadas.</Text>}
    </ScrollView>
  );
}

function RealtyActivityScreen({
  records,
  profile,
  refreshing,
  onRefresh
}: {
  records: IndustryRecord[];
  profile: IndustryProfile;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [visits, setVisits] = useState<IndustryRecord[]>([]);
  const [owners, setOwners] = useState<IndustryRecord[]>([]);
  const [alerts, setAlerts] = useState<IndustryRecord[]>([]);

  async function loadActivity() {
    const [visitData, ownerData, alertData] = await Promise.all([
      getIndustryRecords("visit").catch(() => [] as IndustryRecord[]),
      getIndustryRecords("owner").catch(() => [] as IndustryRecord[]),
      getIndustryRecords("realty_alert").catch(() => [] as IndustryRecord[])
    ]);
    setVisits(visitData);
    setOwners(ownerData);
    setAlerts(alertData);
  }

  useEffect(() => {
    loadActivity();
  }, []);

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { await onRefresh(); await loadActivity(); }} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Actividad inmobiliaria</Text>
      <Text style={styles.screenTitle}>Control operativo</Text>
      <Text style={styles.screenSubtitle}>Visitas, propietarios, portal corredor, alertas y propiedades activas.</Text>
      <View style={styles.kpiGrid}>
        <Kpi label="Visitas" value={visits.length} detail="agendadas" />
        <Kpi label="Propietarios" value={owners.length} detail="registrados" />
        <Kpi label="Portal corredor" value={records.filter((item) => item.assignedToId || recordText(item, "assignedToName", "")).length} detail="asignadas" />
        <Kpi label="Alertas" value={alerts.length} detail="pendientes" />
        <Kpi label="Activas" value={records.filter((item) => item.status !== "closed").length} detail="propiedades" />
      </View>
      <Panel title="Visitas">
        {visits.slice(0, 8).map((visit) => <ListRow key={visit.id} left="VI" title={visit.title} subtitle={recordText(visit, "client", "Sin cliente")} right={dateLabel(recordText(visit, "scheduledAt", visit.createdAt))} />)}
        {!visits.length && <Text style={styles.muted}>Sin visitas registradas.</Text>}
      </Panel>
      <Panel title="Alertas">
        {alerts.slice(0, 8).map((alert) => <ListRow key={alert.id} left="AL" title={alert.title} subtitle={recordText(alert, "message", "Alerta inmobiliaria")} right={alert.status} />)}
        {!alerts.length && <Text style={styles.muted}>Sin alertas activas.</Text>}
      </Panel>
      <Panel title={`Activas ${profile.label}`}>
        {records.filter((item) => item.status !== "closed").slice(0, 8).map((record) => <ListRow key={record.id} left="PR" title={record.title} subtitle={recordText(record, "location", "Sin ubicacion")} right={realtyStage(record)} />)}
      </Panel>
    </ScrollView>
  );
}

function BrokerPortalScreen({
  records,
  session,
  refreshing,
  onRefresh,
  onCreated
}: {
  records: IndustryRecord[];
  session: SessionState;
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const isManager = ["SUPER_ADMIN", "OWNER", "ADMIN"].includes(String(session.user.role || "").toUpperCase());
  const visibleRecords = isManager ? records : records.filter((record) => record.assignedToId === session.user.id || recordText(record, "assignedToName", "") === session.user.name);

  async function addFollowUp(record: IndustryRecord) {
    if (!note.trim()) {
      Alert.alert("Falta seguimiento", "Escribe una nota corta para esta propiedad.");
      return;
    }
    try {
      await createIndustryRecord({
        recordType: "broker_followup",
        title: `Seguimiento ${record.title}`,
        status: "active",
        assignedToId: record.assignedToId || session.user.id,
        data: {
          propertyId: record.id,
          propertyTitle: record.title,
          note,
          brokerName: session.user.name,
          createdFrom: "mobile_broker_portal"
        }
      });
      setNote("");
      Alert.alert("Seguimiento guardado", "Quedo asociado a la propiedad.");
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Portal corredor</Text>
      <Text style={styles.screenTitle}>{isManager ? "Vista jefe de corredores" : "Mis propiedades"}</Text>
      <Text style={styles.screenSubtitle}>Seguimiento independiente por corredor y acceso total para jefatura.</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Nota de seguimiento para cliente interesado" placeholderTextColor={colors.muted} />
      {visibleRecords.map((record) => (
        <View key={record.id} style={styles.propertyCardMobile}>
          <Text style={styles.cardTitle}>{record.title}</Text>
          <Text style={styles.muted}>{recordText(record, "location", "Sin ubicacion")} / {realtyStage(record)}</Text>
          <Text style={styles.greenText}>{realtyPrice(record) ? money(realtyPrice(record)) : recordText(record, "price", "Sin precio")}</Text>
          <Text style={styles.muted}>Corredor: {record.assignedTo?.name || recordText(record, "assignedToName", "Sin asignar")}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => addFollowUp(record)}>
            <Text style={styles.secondaryButtonText}>Guardar seguimiento</Text>
          </TouchableOpacity>
        </View>
      ))}
      {!visibleRecords.length && <Text style={styles.muted}>No hay propiedades asignadas para esta cuenta.</Text>}
    </ScrollView>
  );
}

function BrokersScreen({
  records,
  refreshing,
  onRefresh,
  onCreated
}: {
  records: IndustryRecord[];
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [brokers, setBrokers] = useState<IndustryRecord[]>([]);
  const [saving, setSaving] = useState(false);

  async function loadBrokers() {
    setBrokers(await getIndustryRecords("broker_profile").catch(() => [] as IndustryRecord[]));
  }

  useEffect(() => {
    loadBrokers();
  }, []);

  async function createBroker() {
    if (!name.trim()) {
      Alert.alert("Falta corredor", "Agrega el nombre del corredor.");
      return;
    }
    try {
      setSaving(true);
      await createIndustryRecord({
        recordType: "broker_profile",
        title: name.trim(),
        status: "active",
        data: { name, email, phone, role: "SELLER", source: "mobile_brokers" }
      });
      Alert.alert("Corredor creado", "Ya puedes asignarle propiedades manual o automaticamente.");
      setName("");
      setEmail("");
      setPhone("");
      await loadBrokers();
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo crear", error instanceof Error ? error.message : "Revisa la conexion.");
    } finally {
      setSaving(false);
    }
  }

  async function assignToBroker(property: IndustryRecord, broker: IndustryRecord) {
    try {
      await updateIndustryRecord(property.id, {
        data: {
          ...(property.data || {}),
          assignedBrokerId: broker.id,
          assignedToName: broker.title,
          assignmentMode: "mobile_manual_broker_profile",
          assignedAt: new Date().toISOString()
        }
      });
      Alert.alert("Propiedad asignada", `${property.title} quedo con ${broker.title}.`);
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo asignar", error instanceof Error ? error.message : "Revisa la conexion.");
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { await onRefresh(); await loadBrokers(); }} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Corredores</Text>
      <Text style={styles.screenTitle}>Perfiles y asignaciones</Text>
      <Text style={styles.screenSubtitle}>Crea corredores y reparte propiedades desde el celular.</Text>
      <Panel title="Nuevo corredor">
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nombre del corredor" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" />
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Telefono" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
        <TouchableOpacity style={styles.primaryButton} onPress={createBroker} disabled={saving}>
          <Text style={styles.primaryButtonText}>{saving ? "Creando..." : "Crear corredor"}</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title="Corredores activos">
        {brokers.map((broker) => (
          <View key={broker.id} style={styles.propertyCardMobile}>
            <Text style={styles.cardTitle}>{broker.title}</Text>
            <Text style={styles.muted}>{recordText(broker, "email", "Sin email")} / {recordText(broker, "phone", "Sin telefono")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
              {records.filter((record) => !recordText(record, "assignedBrokerId", "")).slice(0, 8).map((record) => (
                <TouchableOpacity key={record.id} style={styles.filterPill} onPress={() => assignToBroker(record, broker)}>
                  <Text style={styles.filterText}>{record.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ))}
        {!brokers.length && <Text style={styles.muted}>Aun no hay corredores creados.</Text>}
      </Panel>
    </ScrollView>
  );
}

function CustomersScreen({
  records,
  profile,
  recordType,
  entityLabel,
  entityPlural,
  description,
  documentLabel,
  refreshing,
  onRefresh,
  onCreated
}: {
  records: IndustryRecord[];
  profile: IndustryProfile;
  recordType: "customer" | "patient" | "vehicle";
  entityLabel: string;
  entityPlural: string;
  description: string;
  documentLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [interest, setInterest] = useState("");
  const [segment, setSegment] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [notes, setNotes] = useState("");
  const [documents, setDocuments] = useState<Array<{ name: string; type?: string; size?: number; dataUrl?: string }>>([]);
  const [saving, setSaving] = useState(false);

  async function pickDocuments() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      multiple: true,
      copyToCacheDirectory: true
    });
    if (result.canceled || !result.assets?.length) return;
    const nextDocs: Array<{ name: string; type?: string; size?: number; dataUrl?: string }> = [];
    for (const asset of result.assets.slice(0, 6)) {
      if (asset.size && asset.size > 2.5 * 1024 * 1024) {
        Alert.alert("Documento muy pesado", `${asset.name} supera 2.5 MB.`);
        continue;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" as any });
      nextDocs.push({
        name: asset.name,
        type: asset.mimeType,
        size: asset.size,
        dataUrl: dataUrlFromFile(asset.name, asset.mimeType, base64)
      });
    }
    setDocuments((current) => [...current, ...nextDocs].slice(0, 6));
  }

  async function saveCustomer() {
    if (!name.trim()) {
      Alert.alert(`Falta ${entityLabel.toLowerCase()}`, `Agrega el nombre del ${entityLabel.toLowerCase()}.`);
      return;
    }
    try {
      setSaving(true);
      await createIndustryRecord({
          recordType,
        title: name.trim(),
        status: "active",
        data: {
          phone,
          email,
          interest,
          segment,
          nextAction,
          notes,
          documents,
          source: "mobile"
        }
      });
      Alert.alert("Ficha guardada", `${entityLabel} quedó disponible para seguimiento e inbox.`);
      setName("");
      setPhone("");
      setEmail("");
      setInterest("");
      setSegment("");
      setNextAction("");
      setNotes("");
      setDocuments([]);
      await onCreated();
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : "Revisa los datos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple2} />} contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>{entityPlural}</Text>
      <Text style={styles.screenTitle}>{entityPlural}</Text>
      <Text style={styles.screenSubtitle}>{description}</Text>
      <Panel title={`Nueva ficha: ${entityLabel}`}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={`Nombre de ${entityLabel.toLowerCase()}`} placeholderTextColor={colors.muted} />
        <View style={styles.formRow}>
          <TextInput style={[styles.input, styles.formHalf]} value={phone} onChangeText={setPhone} placeholder="Telefono" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
          <TextInput style={[styles.input, styles.formHalf]} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" />
        </View>
        <TextInput style={styles.input} value={interest} onChangeText={setInterest} placeholder={recordType === "vehicle" ? "Patente, marca o modelo" : recordType === "patient" ? "Motivo de consulta o tratamiento" : "Interés o presupuesto"} placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={segment} onChangeText={setSegment} placeholder={recordType === "vehicle" ? "Kilometraje o tipo de servicio" : "Segmento o especialidad"} placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={nextAction} onChangeText={setNextAction} placeholder="Proxima accion / recordatorio" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.uploadButton} onPress={pickDocuments}>
          <Text style={styles.uploadButtonText}>{documentLabel}</Text>
        </TouchableOpacity>
        {documents.map((doc, index) => (
          <View key={`${doc.name}-${index}`} style={styles.documentChip}>
            <Text style={styles.documentChipText} numberOfLines={1}>{doc.name}</Text>
            <TouchableOpacity onPress={() => setDocuments((current) => current.filter((_, docIndex) => docIndex !== index))}><Text style={styles.rowRight}>Quitar</Text></TouchableOpacity>
          </View>
        ))}
        <TextInput style={[styles.input, styles.textArea]} value={notes} onChangeText={setNotes} placeholder={recordType === "vehicle" ? "Historial de arreglos, repuestos y observaciones" : "Notas de contexto, historial o preferencias"} placeholderTextColor={colors.muted} multiline />
        <TouchableOpacity style={styles.primaryButton} onPress={saveCustomer} disabled={saving}>
          <Text style={styles.primaryButtonText}>{saving ? "Guardando..." : "Guardar ficha"}</Text>
        </TouchableOpacity>
      </Panel>
      <Panel title={`${entityPlural} · ${profile.label}`}>
        {records.slice(0, 12).map((record) => (
          <ListRow
            key={record.id}
            left="CL"
            title={record.title}
            subtitle={`${recordText(record, "phone", "Sin telefono")} / ${recordText(record, "interest", "Sin interes registrado")}`}
            right={record.status}
          />
        ))}
        {!records.length && <Text style={styles.muted}>Aún no hay fichas cargadas.</Text>}
      </Panel>
    </ScrollView>
  );
}

function CampaignsScreen({
  profile,
  conversations,
  campaigns,
  onRefresh
}: {
  profile: IndustryProfile;
  conversations: Conversation[];
  campaigns: Campaign[];
  onRefresh: () => void;
}) {
  const [product, setProduct] = useState("");
  const [idea, setIdea] = useState("");
  const [visualTitle, setVisualTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [cta, setCta] = useState("Reserva tu fecha hoy");
  const [platforms, setPlatforms] = useState<string[]>(["whatsapp"]);
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [working, setWorking] = useState(false);
  const [campaignStatus, setCampaignStatus] = useState("");
  const whatsappRecipients = useMemo(
    () => Array.from(new Set(conversations.filter((item) => item.contact.channel === "whatsapp").map((item) => item.contact.externalId).filter(Boolean))),
    [conversations]
  );
  const whatsappCount = whatsappRecipients.length;

  function togglePlatform(platform: string) {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  }

  function campaignPayloadText() {
    const productLabel = product.trim() || `${profile.label} ${profile.primaryEntity}`;
    const ideaLabel = idea.trim() || "Tenemos una novedad preparada para ti desde EVOLUM.";
    const ctaLabel = cta.trim() || "Responde este mensaje y coordinamos los detalles.";
    return caption.trim() || `${ideaLabel}\n\n${productLabel}\n${ctaLabel}`;
  }

  function selectedCampaignVariant(text?: string) {
    const current = variants[selectedVariantIndex];
    return current
      ? { ...current, caption: text || campaignVariantCaption(current), cta: cta.trim() || current.cta }
      : { caption: text || campaignPayloadText(), cta };
  }

  function applyVariant(variant: CampaignVariant, index: number) {
    setSelectedVariantIndex(index);
    const nextCaption = campaignVariantCaption(variant);
    if (nextCaption) setCaption(nextCaption);
    if (variant.cta) setCta(variant.cta);
    if (variant.title || variant.visualTitle) setVisualTitle(String(variant.title || variant.visualTitle));
  }

  async function handleCreateCampaign() {
    try {
      setWorking(true);
      setCampaignStatus("Creando campana...");
      const text = campaignPayloadText();
      const campaign = await createCampaignDraft({
        name: visualTitle.trim() || product.trim() || "Campana movil EVOLUM",
        segment: "manual",
        product: product.trim() || `${profile.label} ${profile.primaryEntity}`,
        visualTitle: visualTitle.trim() || "Campana movil EVOLUM",
        idea: idea.trim() || text,
        caption: text,
        cta,
        platforms,
        selectedVariant: selectedCampaignVariant(text),
        variants: variants.length ? variants : [{ caption: text, cta }]
      });
      setCampaignId(campaign.id);
      setCaption(text);
      setCampaignStatus("Campana creada como borrador.");
      Alert.alert("Campana creada", "El borrador quedo guardado y listo para publicar.");
      await onRefresh();
    } catch (error) {
      setCampaignStatus("No se pudo crear la campana.");
      Alert.alert("No se pudo crear", error instanceof Error ? error.message : "Revisa los datos.");
    } finally {
      setWorking(false);
    }
  }

  async function handleGenerateCampaign() {
    try {
      setWorking(true);
      setCampaignStatus("Generando imagenes y textos...");
      const result = await generateCampaignCopy({
        product: product.trim() || `${profile.label} ${profile.primaryEntity}`,
        visualTitle: visualTitle.trim() || "Campaña movil EVOLUM",
        idea: idea.trim() || "Promocion para contactos recientes del inbox",
        caption,
        cta,
        platforms
      });
      const firstVariant = result?.variants?.[0];
      setCaption(firstVariant?.caption || firstVariant?.copy || result?.caption || caption || "Hola, tenemos novedades para ti. Responde este mensaje y coordinamos los detalles.");
      if (result?.campaign?.id) setCampaignId(result.campaign.id);
      setCampaignStatus("Copy generado y listo para publicar.");
      Alert.alert("Campaña generada", "El copy quedo listo para revisar y publicar.");
      await onRefresh();
    } catch (error) {
      setCampaignStatus("No se pudo generar el copy.");
      Alert.alert("No se pudo generar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setWorking(false);
    }
  }

  async function handleGenerateCampaignImages() {
    try {
      setWorking(true);
      setCampaignStatus("Generando imagenes y textos...");
      const payload = {
        product: product.trim() || `${profile.label} ${profile.primaryEntity}`,
        visualTitle: visualTitle.trim() || "Campana movil EVOLUM",
        idea: idea.trim() || "Promocion para contactos recientes del inbox",
        caption,
        cta,
        platforms,
        variantCount: 3,
        quickMode: false,
        imageSize: "1024x1024"
      };
      const started = await generateCampaignImages(payload);
      let job = started?.job || started;

      if (started?.jobId) {
        for (let attempt = 0; attempt < 28; attempt += 1) {
          await wait(2500);
          job = await getCampaignJob(started.jobId);
          setCampaignStatus(job?.message || "Generando imagenes...");
          if (job?.status === "COMPLETED" || job?.status === "FAILED") break;
        }
      }

      if (job?.status === "FAILED") {
        throw new Error(job.error || "No se pudieron generar imagenes.");
      }

      const generatedVariants = extractCampaignVariants(job || started);
      if (generatedVariants.length) {
        setVariants(generatedVariants);
        setSelectedVariantIndex(0);
        const firstVariant = generatedVariants[0];
        setCaption(campaignVariantCaption(firstVariant) || caption || "Hola, tenemos novedades para ti. Responde este mensaje y coordinamos los detalles.");
        if (firstVariant?.cta) setCta(firstVariant.cta);
        if (firstVariant?.title || firstVariant?.visualTitle) setVisualTitle(String(firstVariant.title || firstVariant.visualTitle));
        if (job?.result?.campaign?.id) setCampaignId(job.result.campaign.id);
        setCampaignStatus("Imagenes listas. Elige una variante para publicar.");
        Alert.alert("Campana generada", "Ya puedes elegir la imagen y publicar.");
      } else {
        const result = await generateCampaignCopy(payload);
        const fallbackVariants = extractCampaignVariants(result);
        setVariants(fallbackVariants);
        const firstVariant = result?.variants?.[0];
        setCaption(firstVariant?.caption || firstVariant?.copy || result?.caption || caption || "Hola, tenemos novedades para ti. Responde este mensaje y coordinamos los detalles.");
        if (result?.campaign?.id) setCampaignId(result.campaign.id);
        setCampaignStatus("Copy generado. No llegaron imagenes desde el backend.");
        Alert.alert("Copy generado", "El texto quedo listo, pero no se recibieron imagenes.");
      }
      await onRefresh();
    } catch (error) {
      setCampaignStatus("No se pudo generar la campana.");
      Alert.alert("No se pudo generar", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setWorking(false);
    }
  }

  async function handlePublishCampaign() {
    try {
      setWorking(true);
      setCampaignStatus("Publicando campana...");
      const text = campaignPayloadText();
      const result = await publishCampaign({
        campaignId,
        product: product.trim() || `${profile.label} ${profile.primaryEntity}`,
        visualTitle: visualTitle.trim() || "Campaña movil EVOLUM",
        idea: idea.trim() || text,
        caption: text,
        cta,
        platforms,
        selectedVariant: selectedCampaignVariant(text),
        variants: variants.length ? variants : [{ caption: text, cta }],
        whatsappRecipients
      });
      if (result?.campaign?.id) setCampaignId(result.campaign.id);
      setCaption(text);
      setCampaignStatus("Campana enviada al backend para publicacion.");
      Alert.alert("Publicación enviada", "El backend recibió la campaña para publicarla en los canales seleccionados.");
      await onRefresh();
    } catch (error) {
      setCampaignStatus("No se pudo publicar la campana.");
      Alert.alert("No se pudo publicar", error instanceof Error ? error.message : "Revisa conectores y destinatarios.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Text style={styles.eyebrow}>Marketing IA</Text>
      <Text style={styles.screenTitle}>Campañas</Text>
      <Text style={styles.screenSubtitle}>Contenido y destinatarios conectados al inbox.</Text>
      <Panel title={`Campana rapida ${profile.label}`}>
        <Text style={styles.muted}>Genera contenido y publica usando destinatarios WhatsApp importados del inbox.</Text>
        <TextInput style={styles.input} value={product} onChangeText={setProduct} placeholder="Producto o servicio" placeholderTextColor={colors.muted} />
        <TextInput style={styles.input} value={visualTitle} onChangeText={setVisualTitle} placeholder="Titulo de campaña" placeholderTextColor={colors.muted} />
        <TextInput style={[styles.input, styles.textArea]} value={idea} onChangeText={setIdea} placeholder="Idea de campaña" placeholderTextColor={colors.muted} multiline />
        <View style={styles.filterRow}>
          {["whatsapp", "instagram", "facebook"].map((platform) => (
            <TouchableOpacity key={platform} style={[styles.filterPill, platforms.includes(platform) && styles.filterPillActive]} onPress={() => togglePlatform(platform)}>
              <Text style={[styles.filterText, platforms.includes(platform) && styles.filterTextActive]}>{platform}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.kpiValue}>{whatsappCount}</Text>
          <Text style={styles.muted}>numeros WhatsApp detectados</Text>
        </View>
        {!!campaignStatus && <Text style={styles.greenText}>{campaignStatus}</Text>}
        {!!variants.length && (
          <View style={styles.campaignImagesBlock}>
            <Text style={styles.panelTitle}>Imagenes para elegir</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.campaignImagesRow}>
              {variants.map((variant, index) => {
                const imageUrl = campaignVariantImage(variant);
                const active = index === selectedVariantIndex;
                return (
                  <TouchableOpacity key={variant.id || `${index}-${imageUrl}`} style={[styles.campaignImageCard, active && styles.campaignImageCardActive]} onPress={() => applyVariant(variant, index)}>
                    {imageUrl ? (
                      <Image source={{ uri: imageUrl }} style={styles.campaignImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.campaignImageEmpty}><Text style={styles.avatarText}>IMG</Text></View>
                    )}
                    <Text style={styles.campaignImageTitle} numberOfLines={2}>{variant.title || variant.visualTitle || `Opcion ${index + 1}`}</Text>
                    <Text style={active ? styles.greenText : styles.muted}>{active ? "Seleccionada" : "Tocar para usar"}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
        <TextInput style={[styles.input, styles.textArea]} value={caption} onChangeText={setCaption} placeholder="Texto generado o manual..." placeholderTextColor={colors.muted} multiline />
        <TextInput style={styles.input} value={cta} onChangeText={setCta} placeholder="CTA" placeholderTextColor={colors.muted} />
        <TouchableOpacity style={styles.secondaryButton} onPress={handleCreateCampaign} disabled={working}><Text style={styles.secondaryButtonText}>{working ? "Procesando..." : "Crear campana"}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={handleGenerateCampaignImages} disabled={working}><Text style={styles.secondaryButtonText}>{working ? "Procesando..." : "Generar imagenes IA"}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handlePublishCampaign} disabled={working}><Text style={styles.primaryButtonText}>{working ? "Publicando..." : "Publicar campaña"}</Text></TouchableOpacity>
      </Panel>
      <Panel title="Historial reciente">
        {campaigns.slice(0, 5).map((campaign) => <ListRow key={campaign.id} left="CA" title={campaign.name} subtitle={campaign.status} right={dateLabel(campaign.createdAt)} />)}
        {!campaigns.length && <Text style={styles.muted}>Sin campañas guardadas todavía.</Text>}
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
  secondaryButton: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(168,85,247,0.12)",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: { color: colors.text, fontWeight: "800" },
  apiHint: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  connectionStatus: { color: colors.purple2, fontSize: 12, lineHeight: 17 },
  appShell: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === "android" ? RNStatusBar.currentHeight || 0 : 0
  },
  floatingMenuButton: {
    position: "absolute",
    top: Platform.OS === "android" ? 34 : 22,
    left: 12,
    zIndex: 30,
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...shadow
  },
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
  sideLogoImage: { width: "100%", height: "100%", borderRadius: 999 },
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
  menuOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    flexDirection: "row"
  },
  menuScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)" },
  fullMenu: {
    borderRightWidth: 1,
    borderRightColor: colors.borderStrong,
    backgroundColor: "#07101f",
    padding: 16,
    paddingTop: Platform.OS === "android" ? 28 : 20,
    paddingBottom: Platform.OS === "android" ? 28 : 22,
    gap: 14,
    ...shadow
  },
  fullMenuTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accountBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 14,
    backgroundColor: colors.panel
  },
  menuAccountName: { color: colors.text, fontSize: 22, fontWeight: "900", marginVertical: 4 },
  menuItems: { flex: 1 },
  menuItemsContent: { gap: 8, paddingBottom: 8 },
  menuItem: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.16)",
    borderRadius: 18,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.03)"
  },
  menuItemActive: { backgroundColor: "rgba(139,63,244,0.36)", borderColor: colors.borderStrong },
  menuIcon: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,63,244,0.22)" },
  menuIconActive: { backgroundColor: colors.purple },
  menuItemTitle: { color: colors.text, fontWeight: "900" },
  menuItemSub: { color: colors.muted, fontSize: 11 },
  logoutButton: { minHeight: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(127,29,29,0.5)", borderWidth: 1, borderColor: "rgba(248,113,113,0.35)", marginBottom: 8 },
  logoutButtonText: { color: colors.text, fontWeight: "900" },
  inboxTopContact: {
    position: "absolute",
    top: Platform.OS === "android" ? 34 : 22,
    left: 76,
    right: 10,
    zIndex: 25,
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.panel,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  avatarTiny: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: colors.purple,
    alignItems: "center",
    justifyContent: "center"
  },
  topContactName: { color: colors.text, fontWeight: "900", fontSize: 15 },
  topContactSub: { color: colors.muted, fontSize: 10 },
  chatsButtonCompact: { backgroundColor: colors.purple, borderRadius: 13, minHeight: 38, paddingHorizontal: 10, justifyContent: "center" },
  contentShell: { flex: 1, paddingHorizontal: 10, paddingTop: Platform.OS === "android" ? 98 : 86, paddingBottom: 8 },
  header: {
    minHeight: 74,
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
  headerPlan: { color: colors.muted, fontSize: 11, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  accountPill: { backgroundColor: colors.purple, borderRadius: 999, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  accountPillText: { color: colors.text, fontWeight: "900" },
  logoutMini: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  logoutMiniText: { color: colors.text, fontWeight: "800" },
  screenContent: { paddingTop: 6, paddingBottom: 42, gap: 14 },
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
  dangerText: { color: "#ff6b8a", fontSize: 12, fontWeight: "900" },
  importActionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch"
  },
  importPreviewBox: {
    gap: 8,
    marginTop: 2
  },
  importPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.panel2,
    padding: 12
  },
  importPreviewRowError: {
    borderColor: "rgba(255,107,138,0.65)",
    backgroundColor: "rgba(255,107,138,0.1)"
  },
  compactMetrics: { flexDirection: "row", gap: 10 },
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
  inboxRoot: { flex: 1, paddingTop: 0, paddingBottom: 2 },
  chatHeader: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.panel,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  chatName: { color: colors.text, fontSize: 18, fontWeight: "900" },
  chatSub: { color: colors.muted, fontSize: 11 },
  chatsButton: { backgroundColor: colors.purple, borderRadius: 14, minHeight: 42, paddingHorizontal: 12, justifyContent: "center" },
  chatsButtonText: { color: colors.text, fontWeight: "900", fontSize: 12 },
  messageList: { flex: 1 },
  messageListContent: { paddingTop: 6, paddingBottom: 8, gap: 10 },
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
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
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
    paddingTop: 7,
    paddingBottom: Platform.OS === "android" ? 18 : 12
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
    top: Platform.OS === "android" ? -54 : -46,
    right: 0,
    bottom: -6,
    left: 0,
    zIndex: 20,
    flexDirection: "row"
  },
  drawerScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.28)" },
  chatDrawer: {
    width: "82%",
    backgroundColor: "#080814",
    borderLeftWidth: 1,
    borderLeftColor: colors.borderStrong,
    padding: 14,
    paddingTop: Platform.OS === "android" ? 18 : 14,
    gap: 12
  },
  drawerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  drawerTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  iconButton: { width: 36, height: 36, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: colors.text, fontWeight: "900" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterScrollContent: { gap: 8, paddingRight: 8 },
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
  campaignImagesBlock: { gap: 10 },
  campaignImagesRow: { gap: 10, paddingRight: 8 },
  campaignImageCard: {
    width: 158,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.panel2,
    padding: 9,
    gap: 8
  },
  campaignImageCardActive: { borderColor: colors.borderStrong, backgroundColor: "rgba(139,63,244,0.24)" },
  campaignImage: { width: "100%", height: 118, borderRadius: 14, backgroundColor: colors.panel },
  campaignImageEmpty: {
    width: "100%",
    height: 118,
    borderRadius: 14,
    backgroundColor: "rgba(139,63,244,0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  campaignImageTitle: { color: colors.text, fontWeight: "900", minHeight: 34 },
  textArea: { minHeight: 92, paddingTop: 12, textAlignVertical: "top" },
  calendarActions: { flexDirection: "row", gap: 8 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  calendarHead: { width: "13.4%", color: colors.purple2, textAlign: "center", fontWeight: "900", fontSize: 11 },
  calendarDay: {
    width: "13.4%",
    minHeight: 76,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.16)",
    borderRadius: 12,
    padding: 5,
    backgroundColor: "rgba(255,255,255,0.025)"
  },
  calendarWeekend: { backgroundColor: "rgba(139,63,244,0.12)" },
  calendarOutside: { opacity: 0.38 },
  calendarNumber: { color: colors.text, fontWeight: "900", fontSize: 11 },
  calendarBooking: { color: colors.green, fontSize: 8, marginTop: 3 },
  formRow: { flexDirection: "row", gap: 10 },
  formHalf: { flex: 1 },
  uploadButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 16,
    backgroundColor: "rgba(139,63,244,0.16)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  uploadButtonText: { color: colors.text, fontWeight: "900", textAlign: "center" },
  propertyPreview: {
    width: "100%",
    height: 170,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2
  },
  recordCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.18)",
    borderRadius: 16,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.035)"
  },
  recordMedia: {
    width: 72,
    height: 72,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(139,63,244,0.26)",
    alignItems: "center",
    justifyContent: "center"
  },
  recordImage: { width: "100%", height: "100%" },
  propertyCardMobile: {
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.18)",
    borderRadius: 18,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.025)"
  },
  portalPropertyCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: colors.panel,
    marginBottom: 14,
    ...shadow
  },
  portalImageWrap: {
    width: "100%",
    height: 190,
    backgroundColor: "rgba(139,63,244,0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  portalImage: {
    width: "100%",
    height: "100%"
  },
  portalImageInitials: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 34,
    letterSpacing: 1
  },
  portalBody: {
    padding: 14,
    gap: 8
  },
  portalPrice: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 24
  },
  portalSpecs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  specPill: {
    color: colors.text,
    fontWeight: "800",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(168,85,247,0.12)"
  },
  documentChip: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.18)",
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.035)"
  },
  documentChipText: { color: colors.text, fontWeight: "800", flex: 1 },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  moduleToggle: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  moduleToggleOn: { backgroundColor: colors.purple, borderColor: colors.borderStrong },
  moduleToggleText: { color: colors.muted, fontWeight: "800" },
  moduleToggleTextOn: { color: colors.text },
  recoveryCard: { width: "88%", maxWidth: 420, gap: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 24, backgroundColor: colors.panel },
  offlineBanner: { marginHorizontal: 14, marginTop: 12, paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: "rgba(249, 115, 22, 0.16)", borderWidth: 1, borderColor: "rgba(249, 115, 22, 0.55)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  offlineBannerText: { color: colors.text, fontSize: 12, fontWeight: "700", flex: 1 },
  offlineBannerAction: { color: "#fdba74", fontSize: 12, fontWeight: "900" }
});
