"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import * as XLSX from "xlsx";
import { EvolumSidebar } from "@/components/evolum-sidebar";
import { ModuleGate } from "@/components/module-gate";
import {
  createNotification,
  createCampaign,
  createIndustryRecord,
  getBalancedIndustryAssignments,
  getIndustryRecords,
  getIndustryUsers,
  getNotifications,
  updateIndustryRecord,
  type IndustryRecord,
  type IndustryUser,
  type TenantNotification
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth";

const PROPERTY_STAGES = [
  { key: "LEAD", label: "Lead", tone: "violet" },
  { key: "CONTACT", label: "Contacto", tone: "cyan" },
  { key: "QUALIFIED", label: "Calificado", tone: "blue" },
  { key: "VISIT_SCHEDULED", label: "Visita agendada", tone: "amber" },
  { key: "VISIT_DONE", label: "Visita realizada", tone: "pink" },
  { key: "OFFER", label: "Oferta", tone: "green" },
  { key: "NEGOTIATION", label: "Negociacion", tone: "amber" },
  { key: "CLOSING", label: "Cierre", tone: "cyan" },
  { key: "POSTSALE", label: "Postventa", tone: "violet" }
];

const BROKER_LEVELS = {
  STARTER: { label: "Starter", broker: 30, evolum: 30, tgi: 40 },
  MEDIO: { label: "Medio", broker: 50, evolum: 20, tgi: 30 },
  SENIOR: { label: "Senior", broker: 80, evolum: 10, tgi: 10 }
} as const;

type BrokerLevel = keyof typeof BROKER_LEVELS;

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
  brokerLevel: BrokerLevel;
  stage: string;
  recognizedFields: number;
  errors: string[];
};

const emptyProperty = {
  title: "",
  propertyType: "casa",
  operation: "venta",
  price: "",
  address: "",
  material: "",
  bedrooms: "",
  bathrooms: "",
  parking: "",
  meters: "",
  photoUrl: "",
  photoFileName: "",
  observations: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  captureOrigin: "base_tgi",
  captureDate: "",
  assignedToId: "",
  brokerLevel: "MEDIO" as BrokerLevel,
  stage: "LEAD"
};

const emptyVisit = {
  propertyId: "",
  client: "",
  phone: "",
  scheduledAt: "",
  address: "",
  result: ""
};

const emptyDeal = {
  propertyId: "",
  contact: "",
  dealType: "venta",
  value: "",
  brokerLevel: "MEDIO" as BrokerLevel,
  captureOrigin: "base_tgi",
  closeDate: ""
};

const emptyCapture = {
  ownerName: "",
  phone: "",
  email: "",
  source: "captacion_evolum",
  propertyHint: "",
  notes: ""
};

const emptyReminder = {
  title: "",
  dueAt: "",
  propertyId: "",
  assignedToId: "",
  body: ""
};

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!amount) return "Sin precio";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function recordValue(record: IndustryRecord, key: string): string | number {
  const value = record.data?.[key];
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Si" : "No";
  return "";
}

function recordStage(record: IndustryRecord) {
  const stage = String(recordValue(record, "stage") || "LEAD").toUpperCase();
  return PROPERTY_STAGES.some((item) => item.key === stage) ? stage : "LEAD";
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "EV";
}

function priceNumber(record: IndustryRecord) {
  return Number(recordValue(record, "price") || 0);
}

function propertyById(properties: IndustryRecord[], id?: string) {
  return properties.find((item) => item.id === id);
}

function calculateCommission(value: number, level: BrokerLevel, captureOrigin?: string) {
  const rule = BROKER_LEVELS[level] || BROKER_LEVELS.MEDIO;
  const commissionTotal = Math.round(value * 0.02);
  return {
    commissionTotal,
    brokerShare: Math.round(commissionTotal * (rule.broker / 100)),
    evolumShare: Math.round(commissionTotal * (rule.evolum / 100)),
    tgiShare: Math.round(commissionTotal * (rule.tgi / 100)),
    captureCommission: String(captureOrigin || "").toLowerCase().includes("evolum") ? Math.round(commissionTotal * 0.15) : 0,
    rule
  };
}

function normalizeImportKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizedRow(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[normalizeImportKey(key)] = value;
    return acc;
  }, {});
}

function importValue(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeImportKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function importText(row: Record<string, unknown>, aliases: string[]) {
  return String(importValue(row, aliases) || "").trim();
}

function importNumber(row: Record<string, unknown>, aliases: string[]) {
  const value = importValue(row, aliases);
  if (typeof value === "number") return value;
  const cleaned = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeImportStage(value: string) {
  const key = normalizeImportKey(value);
  const map: Record<string, string> = {
    lead: "LEAD",
    nuevo: "LEAD",
    prospecto: "LEAD",
    contacto: "CONTACT",
    contactado: "CONTACT",
    calificado: "QUALIFIED",
    qualified: "QUALIFIED",
    visita: "VISIT_SCHEDULED",
    visitaagendada: "VISIT_SCHEDULED",
    visitaprogramada: "VISIT_SCHEDULED",
    visitarealizada: "VISIT_DONE",
    oferta: "OFFER",
    negociacion: "NEGOTIATION",
    cierre: "CLOSING",
    cerrado: "CLOSING",
    postventa: "POSTSALE"
  };
  return map[key] || "LEAD";
}

function normalizeBrokerLevel(value: string): BrokerLevel {
  const key = normalizeImportKey(value);
  if (key.includes("starter") || key.includes("basico")) return "STARTER";
  if (key.includes("senior") || key.includes("pro")) return "SENIOR";
  return "MEDIO";
}

function parsePropertyImportRow(row: Record<string, unknown>, index: number): PropertyImportRow | null {
  const source = normalizedRow(row);
  const hasContent = Object.values(source).some((value) => String(value || "").trim() !== "");
  if (!hasContent) return null;

  const title = importText(source, ["nombre", "nombre propiedad", "propiedad", "titulo", "titulo propiedad", "name"]);
  const address = importText(source, ["direccion", "direccion comuna", "comuna", "ubicacion", "address"]);
  const propertyType = importText(source, ["tipo", "tipo propiedad", "categoria", "property type"]) || "casa";
  const operation = importText(source, ["operacion", "tipo operacion", "venta arriendo", "operation"]) || "venta";
  const stage = normalizeImportStage(importText(source, ["estado", "etapa", "pipeline", "stage"]));
  const brokerLevel = normalizeBrokerLevel(importText(source, ["nivel corredor", "nivel", "broker level", "corredor nivel"]));
  const fallbackTitle = address ? `${propertyType} ${address}` : "";
  const errors: string[] = [];
  if (!title && !fallbackTitle) errors.push("Falta nombre o direccion");

  const recognizedFields = [
    title,
    propertyType,
    operation,
    importValue(source, ["precio", "price", "valor"]),
    address,
    importText(source, ["material", "material principal"]),
    importValue(source, ["piezas", "dormitorios", "bedrooms"]),
    importValue(source, ["banos", "baños", "bathrooms"]),
    importValue(source, ["estacionamientos", "estac", "parking"]),
    importValue(source, ["m2", "metros", "metros cuadrados", "superficie"]),
    importText(source, ["propietario", "dueno", "dueño", "owner"]),
    importText(source, ["vendedor", "corredor", "asignado"])
  ].filter((value) => String(value || "").trim() !== "").length;

  return {
    rowNumber: index + 2,
    title: title || fallbackTitle,
    propertyType,
    operation,
    price: importNumber(source, ["precio", "price", "valor", "valor clp"]),
    address,
    material: importText(source, ["material", "material principal", "construccion"]),
    bedrooms: importNumber(source, ["piezas", "dormitorios", "habitaciones", "bedrooms"]),
    bathrooms: importNumber(source, ["banos", "baños", "bathrooms"]),
    parking: importNumber(source, ["estacionamientos", "estac", "parking"]),
    meters: importNumber(source, ["m2", "metros", "metros cuadrados", "superficie"]),
    photoUrl: importText(source, ["foto", "url foto", "foto principal", "photo", "photo url"]),
    observations: importText(source, ["observaciones", "descripcion", "comentarios", "notes"]),
    ownerName: importText(source, ["propietario", "dueno", "dueño", "owner"]),
    ownerPhone: importText(source, ["telefono propietario", "fono propietario", "telefono", "phone"]),
    ownerEmail: importText(source, ["email propietario", "correo propietario", "email", "correo"]),
    captureOrigin: importText(source, ["origen", "origen captacion", "fuente", "source"]) || "excel_import",
    captureDate: importText(source, ["fecha captacion", "fecha", "capture date"]),
    assignedToName: importText(source, ["vendedor", "corredor", "asignado", "seller", "broker"]),
    brokerLevel,
    stage,
    recognizedFields,
    errors
  };
}

export default function PropertiesPage() {
  const agent = getStoredSession();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [properties, setProperties] = useState<IndustryRecord[]>([]);
  const [owners, setOwners] = useState<IndustryRecord[]>([]);
  const [leads, setLeads] = useState<IndustryRecord[]>([]);
  const [visits, setVisits] = useState<IndustryRecord[]>([]);
  const [deals, setDeals] = useState<IndustryRecord[]>([]);
  const [aiInteractions, setAiInteractions] = useState<IndustryRecord[]>([]);
  const [forecasts, setForecasts] = useState<IndustryRecord[]>([]);
  const [notifications, setNotifications] = useState<TenantNotification[]>([]);
  const [users, setUsers] = useState<IndustryUser[]>([]);
  const [form, setForm] = useState(emptyProperty);
  const [visitForm, setVisitForm] = useState(emptyVisit);
  const [dealForm, setDealForm] = useState(emptyDeal);
  const [captureForm, setCaptureForm] = useState(emptyCapture);
  const [reminderForm, setReminderForm] = useState(emptyReminder);
  const [assignments, setAssignments] = useState<Array<{ item: IndustryRecord; assignee: IndustryUser }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [campaigningId, setCampaigningId] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importPreview, setImportPreview] = useState<PropertyImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [propertyData, ownerData, leadData, visitData, dealData, aiData, forecastData, notificationData, userData] = await Promise.all([
        getIndustryRecords("property"),
        getIndustryRecords("owner").catch(() => []),
        getIndustryRecords("lead").catch(() => []),
        getIndustryRecords("visit").catch(() => []),
        getIndustryRecords("deal").catch(() => []),
        getIndustryRecords("ai_interaction").catch(() => []),
        getIndustryRecords("forecast").catch(() => []),
        getNotifications({ status: "UNREAD", limit: 30 }).catch(() => ({ notifications: [] })),
        getIndustryUsers().catch(() => [])
      ]);
      setProperties(propertyData);
      setOwners(ownerData);
      setLeads(leadData);
      setVisits(visitData);
      setDeals(dealData);
      setAiInteractions(aiData);
      setForecasts(forecastData);
      setNotifications(notificationData.notifications);
      setUsers(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la vertical inmobiliaria");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sellers = useMemo(() => users.filter((user) => ["SELLER", "AGENT", "OWNER", "ADMIN"].includes(user.role)), [users]);
  const activeProperties = useMemo(() => properties.filter((record) => record.status !== "ARCHIVED"), [properties]);
  const activeDeals = useMemo(() => deals.filter((record) => record.status !== "ARCHIVED"), [deals]);
  const totalValue = useMemo(() => activeProperties.reduce((sum, record) => sum + priceNumber(record), 0), [activeProperties]);
  const unassigned = useMemo(() => activeProperties.filter((record) => !record.assignedToId).length, [activeProperties]);
  const activePipelineCount = useMemo(
    () => activeProperties.filter((record) => !["POSTSALE"].includes(recordStage(record))).length,
    [activeProperties]
  );
  const closedValue = useMemo(() => activeDeals.reduce((sum, record) => sum + Number(recordValue(record, "value") || 0), 0), [activeDeals]);
  const openVisitCount = useMemo(() => visits.filter((record) => record.status !== "DONE" && record.status !== "ARCHIVED").length, [visits]);
  const sellerLoads = useMemo(() => {
    return sellers.map((seller) => ({
      seller,
      count: activeProperties.filter((record) => record.assignedToId === seller.id).length,
      value: activeProperties
        .filter((record) => record.assignedToId === seller.id)
        .reduce((sum, record) => sum + priceNumber(record), 0)
    }));
  }, [activeProperties, sellers]);

  const dealPreview = useMemo(() => calculateCommission(Number(dealForm.value || 0), dealForm.brokerLevel, dealForm.captureOrigin), [dealForm]);
  const nextVisits = useMemo(() => {
    const now = Date.now();
    return visits
      .filter((record) => {
        const scheduled = Date.parse(String(recordValue(record, "scheduledAt") || ""));
        return record.status !== "ARCHIVED" && (!Number.isNaN(scheduled) ? scheduled >= now - 60 * 60 * 1000 : true);
      })
      .slice(0, 6);
  }, [visits]);
  const predictiveScore = useMemo(() => {
    if (!activeProperties.length) return 0;
    const weighted = activeProperties.reduce((sum, record) => {
      const stageIndex = PROPERTY_STAGES.findIndex((stage) => stage.key === recordStage(record));
      return sum + Math.max(stageIndex + 1, 1);
    }, 0);
    return Math.min(95, Math.round((weighted / (activeProperties.length * PROPERTY_STAGES.length)) * 100));
  }, [activeProperties]);
  const aiReadyProperties = useMemo(
    () => activeProperties.filter((record) => ["VISIT_DONE", "OFFER", "NEGOTIATION", "CLOSING"].includes(recordStage(record))),
    [activeProperties]
  );
  const validImportRows = useMemo(() => importPreview.filter((row) => !row.errors.length), [importPreview]);

  function matchingSellerId(name: string) {
    const normalized = normalizeImportKey(name);
    if (!normalized) return "";
    const exact = sellers.find((seller) => normalizeImportKey(seller.name) === normalized);
    if (exact) return exact.id;
    const partial = sellers.find((seller) => {
      const sellerName = normalizeImportKey(seller.name);
      return sellerName.includes(normalized) || normalized.includes(sellerName);
    });
    return partial?.id || "";
  }

  async function handleExcelFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    setImportSummary(null);
    if (file.size > 6_000_000) {
      setError("El archivo debe pesar menos de 6 MB para importarlo desde el navegador.");
      return;
    }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!worksheet) {
        setError("El Excel no tiene hojas disponibles.");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
      const parsed = rows
        .slice(0, 250)
        .map((row, index) => parsePropertyImportRow(row, index))
        .filter((row): row is PropertyImportRow => Boolean(row));
      setImportFileName(file.name);
      setImportPreview(parsed);
      if (!parsed.length) {
        setError("No se encontraron filas con datos en la primera hoja.");
      } else {
        const valid = parsed.filter((row) => !row.errors.length).length;
        const capped = rows.length > 250 ? " Se leyeron las primeras 250 filas para proteger el rendimiento." : "";
        setImportSummary(`${valid} de ${parsed.length} filas listas para importar.${capped}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el Excel");
    }
  }

  function downloadPropertyTemplate() {
    const headers = [
      "Nombre propiedad",
      "Tipo propiedad",
      "Operacion",
      "Precio",
      "Direccion",
      "Material",
      "Piezas",
      "Banos",
      "Estacionamientos",
      "M2",
      "URL foto principal",
      "Observaciones",
      "Propietario",
      "Telefono propietario",
      "Email propietario",
      "Origen captacion",
      "Fecha captacion",
      "Corredor",
      "Nivel corredor",
      "Etapa"
    ];
    const example = [
      "Casa Los Robles",
      "casa",
      "venta",
      "185000000",
      "Las Condes",
      "Hormigon",
      "4",
      "3",
      "2",
      "180",
      "https://...",
      "Cercana a colegios y metro",
      "Maria Torres",
      "+56912345678",
      "maria@correo.cl",
      "base_tgi",
      "2026-07-04",
      "Vendedor 1",
      "MEDIO",
      "LEAD"
    ];
    const csv = [headers, example]
      .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-propiedades-evolum.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importPropertiesFromExcel() {
    if (!validImportRows.length) return;
    try {
      setImporting(true);
      setSaving(true);
      setError(null);
      setMessage(null);
      const importBatchId = `realty_excel_${Date.now()}`;
      const importedIds: string[] = [];
      let createdOwners = 0;

      for (const row of validImportRows) {
        let ownerRecordId = "";
        if (row.ownerName) {
          const owner = await createIndustryRecord({
            recordType: "owner",
            title: row.ownerName,
            status: "ACTIVE",
            data: {
              name: row.ownerName,
              phone: row.ownerPhone,
              email: row.ownerEmail,
              origin: row.captureOrigin,
              source: "excel_import",
              importBatchId,
              importFileName,
              importRowNumber: row.rowNumber
            }
          });
          ownerRecordId = owner.id;
          createdOwners += 1;
        }

        const property = await createIndustryRecord({
          recordType: "property",
          title: row.title,
          status: "ACTIVE",
          assignedToId: matchingSellerId(row.assignedToName) || null,
          data: {
            propertyType: row.propertyType,
            operation: row.operation,
            price: row.price,
            address: row.address,
            material: row.material,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
            parking: row.parking,
            meters: row.meters,
            photoUrl: row.photoUrl,
            photoFileName: row.photoUrl ? "excel_url" : "",
            observations: row.observations,
            ownerRecordId,
            ownerName: row.ownerName,
            ownerPhone: row.ownerPhone,
            ownerEmail: row.ownerEmail,
            captureOrigin: row.captureOrigin,
            captureDate: row.captureDate,
            brokerLevel: row.brokerLevel,
            stage: row.stage,
            assignedToName: row.assignedToName,
            source: "excel_import",
            importBatchId,
            importFileName,
            importRowNumber: row.rowNumber,
            recognizedFields: row.recognizedFields,
            predictiveLearning: {
              enabled: true,
              source: "bulk_property_upload",
              confidenceBase: Math.min(100, row.recognizedFields * 8)
            }
          }
        });
        importedIds.push(property.id);
      }

      await createIndustryRecord({
        recordType: "ai_interaction",
        title: `Aprendizaje inmobiliario desde Excel - ${importFileName || "archivo"}`,
        status: "READY",
        data: {
          agentType: "realty_excel_learning",
          context: "Importacion masiva de propiedades para acelerar aprendizaje predictivo",
          result: `${importedIds.length} propiedades y ${createdOwners} propietarios importados`,
          requiresSupervision: false,
          importBatchId,
          importFileName,
          importedPropertyIds: importedIds.slice(0, 80),
          skippedRows: importPreview.length - validImportRows.length
        }
      });

      setImportPreview([]);
      setImportFileName("");
      setImportSummary(null);
      setMessage(`Importacion completada: ${importedIds.length} propiedades cargadas y disponibles para IA predictiva.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar el Excel inmobiliario");
    } finally {
      setImporting(false);
      setSaving(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    try {
      setSaving(true);
      setMessage(null);
      setError(null);

      let ownerRecordId = "";
      if (form.ownerName.trim()) {
        const owner = await createIndustryRecord({
          recordType: "owner",
          title: form.ownerName,
          status: "ACTIVE",
          data: {
            name: form.ownerName,
            phone: form.ownerPhone,
            email: form.ownerEmail,
            origin: form.captureOrigin
          }
        });
        ownerRecordId = owner.id;
      }

      await createIndustryRecord({
        recordType: "property",
        title: form.title,
        status: "ACTIVE",
        assignedToId: form.assignedToId || null,
        data: {
          propertyType: form.propertyType,
          operation: form.operation,
          price: Number(form.price || 0),
          address: form.address,
          material: form.material,
          bedrooms: Number(form.bedrooms || 0),
          bathrooms: Number(form.bathrooms || 0),
          parking: Number(form.parking || 0),
          meters: Number(form.meters || 0),
          photoUrl: form.photoUrl,
          photoFileName: form.photoFileName,
          observations: form.observations,
          ownerRecordId,
          ownerName: form.ownerName,
          ownerPhone: form.ownerPhone,
          ownerEmail: form.ownerEmail,
          captureOrigin: form.captureOrigin,
          captureDate: form.captureDate,
          brokerLevel: form.brokerLevel,
          stage: form.stage
        }
      });
      setForm(emptyProperty);
      setMessage("Propiedad, propietario y asignacion inicial guardados.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la propiedad");
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3_500_000) {
      setError("La foto debe pesar menos de 3.5 MB para adjuntarla a la ficha.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setForm((current) => ({ ...current, photoUrl: result, photoFileName: file.name }));
      setMessage("Foto cargada en la ficha. Guarda la propiedad para aplicarla.");
    };
    reader.readAsDataURL(file);
  }

  async function calculateAssignments() {
    try {
      setError(null);
      const result = await getBalancedIndustryAssignments({ recordType: "property", assigneeRole: "SELLER" });
      setAssignments(result.assignments.map((item) => ({ item: item.item, assignee: item.assignee })));
      if (!result.assignments.length) setMessage("No hay vendedores SELLER activos. Puedes usar asignacion manual.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo calcular la asignacion");
    }
  }

  async function applyAssignments() {
    try {
      setSaving(true);
      setError(null);
      await Promise.all(assignments.map((assignment) =>
        updateIndustryRecord(assignment.item.id, {
          assignedToId: assignment.assignee.id,
          data: {
            ...(assignment.item.data || {}),
            assignmentMode: "balanceada"
          }
        })
      ));
      setMessage("Asignacion balanceada aplicada.");
      setAssignments([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar la asignacion");
    } finally {
      setSaving(false);
    }
  }

  async function updateAssignment(record: IndustryRecord, assignedToId: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, {
        assignedToId: assignedToId || null,
        data: { ...(record.data || {}), assignmentMode: "manual" }
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el vendedor");
    }
  }

  async function updateStage(record: IndustryRecord, stage: string) {
    try {
      setError(null);
      await updateIndustryRecord(record.id, {
        status: stage === "POSTSALE" ? "DONE" : "ACTIVE",
        data: { ...(record.data || {}), stage }
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mover la propiedad");
    }
  }

  async function createPropertyCampaign(record: IndustryRecord) {
    try {
      setCampaigningId(record.id);
      setError(null);
      const price = money(recordValue(record, "price"));
      const address = String(recordValue(record, "address") || "ubicacion por confirmar");
      const observations = String(recordValue(record, "observations") || "");
      await createCampaign({
        name: `Campana inmobiliaria - ${record.title}`,
        segment: "realty",
        template: JSON.stringify({
          source: "property",
          propertyId: record.id,
          product: record.title,
          visualTitle: `Propiedad destacada: ${record.title}`,
          caption: `${record.title} en ${address}. Precio: ${price}. ${observations}`.trim(),
          cta: "Agenda tu visita",
          platforms: ["instagram", "facebook", "whatsapp"],
          status: "DRAFT",
          requiresSupervision: true
        })
      });
      setMessage("Borrador de campana inmobiliaria creado para supervision.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la campana");
    } finally {
      setCampaigningId(null);
    }
  }

  async function createPredictiveSnapshot() {
    try {
      setSaving(true);
      setError(null);
      const projectedValue = aiReadyProperties.reduce((sum, record) => sum + priceNumber(record), 0);
      const highIntent = aiReadyProperties.length;
      const forecast = await createIndustryRecord({
        recordType: "forecast",
        title: `Forecast inmobiliario ${new Date().toLocaleDateString("es-CL")}`,
        status: "ACTIVE",
        data: {
          predictiveScore,
          projectedValue,
          highIntent,
          totalProperties: activeProperties.length,
          openVisits: openVisitCount,
          recommendation: highIntent
            ? "Priorizar visitas realizadas, ofertas y negociaciones para cierre asistido."
            : "Aumentar captacion, agenda de visitas y seguimiento de leads para generar volumen predictivo."
        }
      });
      await createIndustryRecord({
        recordType: "ai_interaction",
        title: "Analisis predictivo inmobiliario",
        status: "READY",
        data: {
          agentType: "predictive_real_estate",
          context: "Pipeline, visitas, negocios y propiedades activas",
          result: `Score ${predictiveScore}% / ${money(projectedValue)} en oportunidad ponderada`,
          requiresSupervision: false,
          linkedRecordId: forecast.id
        }
      });
      setMessage("Forecast predictivo creado con los datos actuales de la vertical.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el forecast inmobiliario");
    } finally {
      setSaving(false);
    }
  }

  async function createCaptureOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureForm.ownerName.trim()) return;
    try {
      setSaving(true);
      setError(null);
      const owner = await createIndustryRecord({
        recordType: "owner",
        title: captureForm.ownerName,
        status: "PENDING_CAPTURE",
        data: {
          name: captureForm.ownerName,
          phone: captureForm.phone,
          email: captureForm.email,
          origin: captureForm.source,
          propertyHint: captureForm.propertyHint,
          notes: captureForm.notes
        }
      });
      await createIndustryRecord({
        recordType: "ai_interaction",
        title: `Captacion supervisada - ${captureForm.ownerName}`,
        status: "PENDING_REVIEW",
        data: {
          agentType: "capture_agent",
          context: captureForm.propertyHint,
          result: captureForm.notes || "Oportunidad de captacion pendiente de validacion humana.",
          requiresSupervision: true,
          linkedRecordId: owner.id
        }
      });
      setCaptureForm(emptyCapture);
      setMessage("Oportunidad de captacion creada para supervision.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la captacion");
    } finally {
      setSaving(false);
    }
  }

  async function createRealtyReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reminderForm.title.trim()) return;
    try {
      setSaving(true);
      setError(null);
      const selected = propertyById(activeProperties, reminderForm.propertyId);
      await createNotification({
        title: reminderForm.title,
        body: reminderForm.body || (selected ? `Seguimiento de ${selected.title}` : "Recordatorio inmobiliario"),
        severity: "warning",
        targetUrl: "/properties",
        assignedToId: reminderForm.assignedToId || undefined,
        metadata: {
          industry: "REAL_ESTATE",
          dueAt: reminderForm.dueAt,
          propertyId: reminderForm.propertyId || null,
          propertyTitle: selected?.title || null,
          source: "real_estate_vertical"
        }
      });
      setReminderForm(emptyReminder);
      setMessage("Recordatorio inmobiliario creado.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el recordatorio");
    } finally {
      setSaving(false);
    }
  }

  async function createVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visitForm.propertyId || !visitForm.client.trim()) return;
    try {
      setSaving(true);
      setError(null);
      const selected = propertyById(activeProperties, visitForm.propertyId);
      const selectedOperation = selected ? recordValue(selected, "operation") : null;
      const selectedAddress = selected ? recordValue(selected, "address") : null;
      const lead = await createIndustryRecord({
        recordType: "lead",
        title: visitForm.client,
        status: "ACTIVE",
        assignedToId: selected?.assignedToId || null,
        data: {
          name: visitForm.client,
          phone: visitForm.phone,
          interestType: selectedOperation || "compra",
          pipelineStage: "VISIT_SCHEDULED",
          interestedPropertyId: visitForm.propertyId
        }
      });
      await createIndustryRecord({
        recordType: "visit",
        title: `Visita ${visitForm.client}`,
        status: "SCHEDULED",
        assignedToId: selected?.assignedToId || null,
        data: {
          leadId: lead.id,
          client: visitForm.client,
          phone: visitForm.phone,
          propertyId: visitForm.propertyId,
          propertyTitle: selected?.title || "",
          scheduledAt: visitForm.scheduledAt,
          address: visitForm.address || String(selectedAddress || ""),
          result: visitForm.result
        }
      });
      if (selected) await updateStage(selected, "VISIT_SCHEDULED");
      setVisitForm(emptyVisit);
      setMessage("Visita y lead inmobiliario registrados.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la visita");
    } finally {
      setSaving(false);
    }
  }

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dealForm.propertyId || !dealForm.value) return;
    try {
      setSaving(true);
      setError(null);
      const selected = propertyById(activeProperties, dealForm.propertyId);
      const value = Number(dealForm.value || 0);
      const commission = calculateCommission(value, dealForm.brokerLevel, dealForm.captureOrigin);
      const deal = await createIndustryRecord({
        recordType: "deal",
        title: `Negocio ${selected?.title || dealForm.contact || "inmobiliario"}`,
        status: "CLOSED",
        assignedToId: selected?.assignedToId || null,
        data: {
          propertyId: dealForm.propertyId,
          propertyTitle: selected?.title || "",
          contact: dealForm.contact,
          dealType: dealForm.dealType,
          value,
          brokerLevel: dealForm.brokerLevel,
          closeDate: dealForm.closeDate,
          captureOrigin: dealForm.captureOrigin,
          ...commission
        }
      });
      await createIndustryRecord({
        recordType: "commission_distribution",
        title: `Comision ${selected?.title || deal.id}`,
        status: "LOCKED",
        assignedToId: selected?.assignedToId || null,
        data: {
          dealId: deal.id,
          propertyId: dealForm.propertyId,
          commissionTotal: commission.commissionTotal,
          brokerPercent: commission.rule.broker,
          evolumPercent: commission.rule.evolum,
          tgiPercent: commission.rule.tgi,
          brokerShare: commission.brokerShare,
          evolumShare: commission.evolumShare,
          tgiShare: commission.tgiShare,
          captureCommission: commission.captureCommission
        }
      });
      if (selected) await updateStage(selected, "CLOSING");
      setDealForm(emptyDeal);
      setMessage("Negocio cerrado y comision calculada segun nivel de corredor.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el negocio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModuleGate moduleKey="properties">
      <div className={`executive-shell vertical-shell ${sidebarOpen ? "" : "nav-collapsed"}`}>
        <EvolumSidebar active="Propiedades" isDeveloper={agent?.role === "SUPER_ADMIN"} isOpen={sidebarOpen} onToggle={() => setSidebarOpen((value) => !value)} />
        <main className="vertical-page realty-page">
          <header className="vertical-hero realty-hero">
            <div>
              <span>Broker inmobiliario / TGI</span>
              <h1>Propiedades, visitas y comisiones</h1>
              <p>Vertical Nivel 1 con propietarios, corredores, propiedades, leads, visitas, negocios y calculo automatico de comision.</p>
            </div>
            <div className="realty-hero-actions">
              <button className="ghost-btn" type="button" onClick={load}>Actualizar</button>
              <button className="primary-btn" type="button" onClick={calculateAssignments}>Calcular reparto</button>
            </div>
          </header>

          {error ? <div className="sales-queue-error">{error}</div> : null}
          {message ? <div className="admin-notice success">{message}</div> : null}

          <section className="realty-kpi-grid tgi-kpi-grid">
            <article className="realty-kpi-card"><span>Propiedades</span><strong>{activeProperties.length}</strong><small>{unassigned} sin vendedor</small></article>
            <article className="realty-kpi-card"><span>Valor cartera</span><strong>{money(totalValue)}</strong><small>Inventario activo</small></article>
            <article className="realty-kpi-card"><span>Visitas abiertas</span><strong>{openVisitCount}</strong><small>{leads.length} leads registrados</small></article>
            <article className="realty-kpi-card"><span>Negocios cerrados</span><strong>{activeDeals.length}</strong><small>{money(closedValue)}</small></article>
            <article className="realty-kpi-card"><span>Pipeline activo</span><strong>{activePipelineCount}</strong><small>{PROPERTY_STAGES.length} etapas TGI</small></article>
          </section>

          <section className="realty-ops-grid tgi-ops-grid">
            <form className="vertical-card vertical-form realty-property-form" onSubmit={handleCreate}>
              <div><span>Nueva propiedad</span><h2>Ficha completa TGI</h2></div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Nombre de propiedad" required />
              <div className="vertical-three">
                <select value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value })}>
                  <option value="casa">Casa</option>
                  <option value="departamento">Departamento</option>
                  <option value="terreno">Terreno</option>
                  <option value="oficina">Oficina</option>
                  <option value="local">Local</option>
                </select>
                <select value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })}>
                  <option value="venta">Venta</option>
                  <option value="arriendo">Arriendo</option>
                </select>
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Precio CLP" inputMode="numeric" />
              </div>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Direccion / comuna" required />
              <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Material principal" />
              <div className="vertical-four">
                <input value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} placeholder="Piezas" inputMode="numeric" />
                <input value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} placeholder="Banos" inputMode="numeric" />
                <input value={form.parking} onChange={(e) => setForm({ ...form, parking: e.target.value })} placeholder="Estac." inputMode="numeric" />
                <input value={form.meters} onChange={(e) => setForm({ ...form, meters: e.target.value })} placeholder="M2" inputMode="numeric" />
              </div>
              <div className="file-picker-row">
                <input value={form.photoUrl} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} placeholder="URL o archivo de foto principal" />
                <label className="ghost-btn file-picker-button">Subir foto<input type="file" accept="image/*" onChange={handlePhotoFile} /></label>
              </div>
              {form.photoFileName ? <span className="meta-line">Foto seleccionada: {form.photoFileName}</span> : null}
              <textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} placeholder="Observaciones generales de la vivienda" rows={4} />
              <div className="tgi-form-block">
                <strong>Propietario y captacion</strong>
                <div className="vertical-three">
                  <input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Propietario" />
                  <input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} placeholder="Telefono propietario" />
                  <input value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="Email propietario" />
                </div>
                <div className="vertical-three">
                  <select value={form.captureOrigin} onChange={(e) => setForm({ ...form, captureOrigin: e.target.value })}>
                    <option value="base_tgi">Base TGI</option>
                    <option value="referido">Referido</option>
                    <option value="captacion_evolum">Captacion EVOLUM</option>
                    <option value="web">Web</option>
                  </select>
                  <input value={form.captureDate} onChange={(e) => setForm({ ...form, captureDate: e.target.value })} type="date" />
                  <select value={form.brokerLevel} onChange={(e) => setForm({ ...form, brokerLevel: e.target.value as BrokerLevel })}>
                    {Object.entries(BROKER_LEVELS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="vertical-two">
                <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">Sin corredor asignado</option>
                  {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} / {seller.role}</option>)}
                </select>
                <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {PROPERTY_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                </select>
              </div>
              <button className="primary-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar propiedad"}</button>
            </form>

            <section className="vertical-card realty-assignment-panel">
              <div className="vertical-card-head">
                <div><span>Equipo comercial</span><h2>Corredores y reparto</h2></div>
                {assignments.length ? <button className="ghost-btn" type="button" onClick={applyAssignments} disabled={saving}>Aplicar reparto</button> : null}
              </div>
              <div className="seller-load-grid">
                {sellerLoads.length ? sellerLoads.map(({ seller, count, value }) => (
                  <article key={seller.id} className="seller-load-card">
                    <div className="seller-avatar">{initials(seller.name)}</div>
                    <div><strong>{seller.name}</strong><span>{count} propiedades</span></div>
                    <small>{money(value)}</small>
                  </article>
                )) : <p className="meta-line">Agrega usuarios con rol SELLER para activar reparto automatico.</p>}
              </div>
              <div className="vertical-assignment-list realty-suggested-list">
                {assignments.length ? assignments.map((assignment) => (
                  <article key={assignment.item.id}><strong>{assignment.item.title}</strong><span>{assignment.assignee.name}</span></article>
                )) : <p className="meta-line">Calcula el reparto para distribuir propiedades sin corredor de forma balanceada.</p>}
              </div>
            </section>
          </section>

          <section className="vertical-card tgi-import-panel">
            <div className="vertical-card-head tgi-import-head">
              <div>
                <span>Importacion masiva</span>
                <h2>Excel de propiedades para IA predictiva</h2>
                <p>Sube una planilla con viviendas, propietarios, precios, ubicaciones, fotos, etapas y corredores. EVOLUM la transforma en fichas y deja el lote listo para aprendizaje comercial.</p>
              </div>
              <div className="tgi-import-actions">
                <button className="ghost-btn" type="button" onClick={downloadPropertyTemplate}>Descargar plantilla</button>
                <label className="ghost-btn file-picker-button">
                  Subir Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                    onChange={handleExcelFile}
                  />
                </label>
                <button className="primary-btn" type="button" onClick={importPropertiesFromExcel} disabled={!validImportRows.length || importing}>
                  {importing ? "Importando..." : "Importar propiedades"}
                </button>
              </div>
            </div>
            <div className="tgi-import-spec">
              <span>Columnas clave</span>
              <strong>Nombre, direccion, precio, material, piezas, banos, M2, propietario, corredor, etapa</strong>
              <small>Tambien reconoce alias como comuna, dormitorios, estacionamientos, observaciones, foto principal y origen de captacion.</small>
            </div>
            {importSummary ? <div className="admin-notice success">{importSummary}</div> : null}
            {importFileName ? <p className="meta-line">Archivo seleccionado: {importFileName}</p> : null}
            {importPreview.length ? (
              <div className="tgi-import-preview">
                <header>
                  <strong>Previsualizacion</strong>
                  <span>{validImportRows.length} listas / {importPreview.length} filas</span>
                </header>
                <div className="tgi-import-table" role="table" aria-label="Preview de importacion inmobiliaria">
                  <div className="tgi-import-row tgi-import-row-head" role="row">
                    <span>Fila</span>
                    <span>Propiedad</span>
                    <span>Direccion</span>
                    <span>Precio</span>
                    <span>Corredor</span>
                    <span>Estado</span>
                  </div>
                  {importPreview.slice(0, 8).map((row) => (
                    <div className={`tgi-import-row ${row.errors.length ? "has-error" : ""}`} role="row" key={`${row.rowNumber}-${row.title}`}>
                      <span>{row.rowNumber}</span>
                      <strong>{row.title || "Sin nombre"}</strong>
                      <span>{row.address || "Sin direccion"}</span>
                      <span>{money(row.price)}</span>
                      <span>{row.assignedToName || "Sin asignar"}</span>
                      <span>{row.errors.length ? row.errors.join(", ") : PROPERTY_STAGES.find((stage) => stage.key === row.stage)?.label}</span>
                    </div>
                  ))}
                </div>
                {importPreview.length > 8 ? <small className="meta-line">Mostrando 8 filas de ejemplo. Al importar se cargan todas las filas validas del preview.</small> : null}
              </div>
            ) : null}
          </section>

          <section className="tgi-intelligence-grid">
            <section className="vertical-card tgi-ai-panel">
              <div className="vertical-card-head">
                <div><span>Nivel 2 / IA predictiva</span><h2>Predictibilidad comercial</h2></div>
                <button className="primary-btn" type="button" onClick={createPredictiveSnapshot} disabled={saving}>Crear forecast</button>
              </div>
              <div className="tgi-radar-card">
                <strong>{predictiveScore}%</strong>
                <span>score predictivo</span>
                <p>{aiReadyProperties.length} propiedades en etapas de alta intencion y {openVisitCount} visitas abiertas.</p>
              </div>
              <div className="tgi-record-list">
                {(forecasts.length ? forecasts : aiInteractions.filter((item) => String(recordValue(item, "agentType")).includes("predictive"))).slice(0, 4).map((record) => (
                  <article key={record.id}>
                    <strong>{record.title}</strong>
                    <span>{recordValue(record, "result") || recordValue(record, "recommendation") || "Analisis generado"}</span>
                    <small>{new Date(record.createdAt).toLocaleString("es-CL")}</small>
                  </article>
                ))}
                {!forecasts.length && !aiInteractions.length ? <p className="meta-line">Crea el primer forecast para iniciar historico predictivo.</p> : null}
              </div>
            </section>

            <form className="vertical-card vertical-form tgi-capture-panel" onSubmit={createCaptureOpportunity}>
              <div><span>Nivel 3 / captacion</span><h2>Agenda y captacion supervisada</h2></div>
              <div className="vertical-two">
                <input value={captureForm.ownerName} onChange={(e) => setCaptureForm({ ...captureForm, ownerName: e.target.value })} placeholder="Nombre propietario" />
                <input value={captureForm.phone} onChange={(e) => setCaptureForm({ ...captureForm, phone: e.target.value })} placeholder="Telefono" />
              </div>
              <div className="vertical-two">
                <input value={captureForm.email} onChange={(e) => setCaptureForm({ ...captureForm, email: e.target.value })} placeholder="Email" />
                <select value={captureForm.source} onChange={(e) => setCaptureForm({ ...captureForm, source: e.target.value })}>
                  <option value="captacion_evolum">Captacion EVOLUM</option>
                  <option value="referido">Referido</option>
                  <option value="base_tgi">Base TGI</option>
                  <option value="web">Web</option>
                </select>
              </div>
              <input value={captureForm.propertyHint} onChange={(e) => setCaptureForm({ ...captureForm, propertyHint: e.target.value })} placeholder="Propiedad tentativa / comuna / necesidad" />
              <textarea value={captureForm.notes} onChange={(e) => setCaptureForm({ ...captureForm, notes: e.target.value })} placeholder="Notas para validacion humana" rows={3} />
              <button className="primary-btn" disabled={saving}>Crear captacion supervisada</button>
            </form>

            <form className="vertical-card vertical-form tgi-reminder-panel" onSubmit={createRealtyReminder}>
              <div><span>Recordatorios</span><h2>Seguimiento corredor</h2></div>
              <input value={reminderForm.title} onChange={(e) => setReminderForm({ ...reminderForm, title: e.target.value })} placeholder="Titulo del recordatorio" />
              <div className="vertical-two">
                <input value={reminderForm.dueAt} onChange={(e) => setReminderForm({ ...reminderForm, dueAt: e.target.value })} type="datetime-local" />
                <select value={reminderForm.assignedToId} onChange={(e) => setReminderForm({ ...reminderForm, assignedToId: e.target.value })}>
                  <option value="">Asignar a equipo</option>
                  {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
                </select>
              </div>
              <select value={reminderForm.propertyId} onChange={(e) => setReminderForm({ ...reminderForm, propertyId: e.target.value })}>
                <option value="">Sin propiedad asociada</option>
                {activeProperties.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
              </select>
              <textarea value={reminderForm.body} onChange={(e) => setReminderForm({ ...reminderForm, body: e.target.value })} placeholder="Accion pendiente, llamada, documentos, postventa..." rows={3} />
              <button className="primary-btn" disabled={saving}>Crear recordatorio</button>
            </form>
          </section>

          <section className="tgi-work-grid">
            <form className="vertical-card vertical-form" onSubmit={createVisit}>
              <div><span>Agenda comercial</span><h2>Registrar visita</h2></div>
              <select value={visitForm.propertyId} onChange={(e) => {
                const selected = propertyById(activeProperties, e.target.value);
                setVisitForm({ ...visitForm, propertyId: e.target.value, address: selected ? String(recordValue(selected, "address") || "") : "" });
              }}>
                <option value="">Selecciona propiedad</option>
                {activeProperties.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
              </select>
              <div className="vertical-two">
                <input value={visitForm.client} onChange={(e) => setVisitForm({ ...visitForm, client: e.target.value })} placeholder="Cliente comprador/arrendatario" />
                <input value={visitForm.phone} onChange={(e) => setVisitForm({ ...visitForm, phone: e.target.value })} placeholder="Telefono" />
              </div>
              <div className="vertical-two">
                <input value={visitForm.scheduledAt} onChange={(e) => setVisitForm({ ...visitForm, scheduledAt: e.target.value })} type="datetime-local" />
                <input value={visitForm.address} onChange={(e) => setVisitForm({ ...visitForm, address: e.target.value })} placeholder="Direccion de visita" />
              </div>
              <textarea value={visitForm.result} onChange={(e) => setVisitForm({ ...visitForm, result: e.target.value })} placeholder="Resultado o notas de visita" rows={3} />
              <button className="primary-btn" disabled={saving}>Guardar visita</button>
            </form>

            <form className="vertical-card vertical-form" onSubmit={createDeal}>
              <div><span>Comisiones TGI</span><h2>Registrar negocio</h2></div>
              <select value={dealForm.propertyId} onChange={(e) => {
                const selected = propertyById(activeProperties, e.target.value);
                setDealForm({
                  ...dealForm,
                  propertyId: e.target.value,
                  value: selected ? String(recordValue(selected, "price") || dealForm.value || "") : dealForm.value,
                  captureOrigin: selected ? String(recordValue(selected, "captureOrigin") || dealForm.captureOrigin) : dealForm.captureOrigin
                });
              }}>
                <option value="">Selecciona propiedad</option>
                {activeProperties.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
              </select>
              <div className="vertical-three">
                <select value={dealForm.dealType} onChange={(e) => setDealForm({ ...dealForm, dealType: e.target.value })}>
                  <option value="venta">Venta</option>
                  <option value="arriendo">Arriendo</option>
                </select>
                <input value={dealForm.value} onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })} placeholder="Valor operacion CLP" inputMode="numeric" />
                <select value={dealForm.brokerLevel} onChange={(e) => setDealForm({ ...dealForm, brokerLevel: e.target.value as BrokerLevel })}>
                  {Object.entries(BROKER_LEVELS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                </select>
              </div>
              <div className="vertical-three">
                <input value={dealForm.contact} onChange={(e) => setDealForm({ ...dealForm, contact: e.target.value })} placeholder="Comprador / arrendatario" />
                <input value={dealForm.closeDate} onChange={(e) => setDealForm({ ...dealForm, closeDate: e.target.value })} type="date" />
                <select value={dealForm.captureOrigin} onChange={(e) => setDealForm({ ...dealForm, captureOrigin: e.target.value })}>
                  <option value="base_tgi">Base TGI</option>
                  <option value="referido">Referido</option>
                  <option value="captacion_evolum">Captacion EVOLUM</option>
                </select>
              </div>
              <div className="commission-preview">
                <span>Total comision 2% <strong>{money(dealPreview.commissionTotal)}</strong></span>
                <span>Corredor {percent(dealPreview.rule.broker)} <strong>{money(dealPreview.brokerShare)}</strong></span>
                <span>EVOLUM {percent(dealPreview.rule.evolum)} <strong>{money(dealPreview.evolumShare)}</strong></span>
                <span>TGI {percent(dealPreview.rule.tgi)} <strong>{money(dealPreview.tgiShare)}</strong></span>
              </div>
              <button className="primary-btn" disabled={saving}>Cerrar y calcular comision</button>
            </form>
          </section>

          <section className="vertical-list realty-pipeline-section">
            <div className="vertical-card-head"><div><span>Pipeline inmobiliario</span><h2>Lead a postventa</h2></div></div>
            <div className="realty-pipeline tgi-pipeline">
              {PROPERTY_STAGES.map((stage) => {
                const stageRecords = activeProperties.filter((record) => recordStage(record) === stage.key);
                const stageValue = stageRecords.reduce((sum, record) => sum + priceNumber(record), 0);
                return (
                  <article className={`realty-stage-column tone-${stage.tone}`} key={stage.key}>
                    <header><strong>{stage.label}</strong><span>{stageRecords.length}</span></header>
                    <small>{money(stageValue)}</small>
                    <div className="realty-stage-list">
                      {stageRecords.length ? stageRecords.map((record) => (
                        <div className="realty-stage-card" key={record.id}>
                          <strong>{record.title}</strong>
                          <span>{recordValue(record, "address") || "Sin direccion"}</span>
                          <div className="realty-mini-row">
                            <small>{money(recordValue(record, "price"))}</small>
                            <small>{record.assignedTo?.name || "Sin corredor"}</small>
                          </div>
                          <select value={record.assignedToId || ""} onChange={(e) => updateAssignment(record, e.target.value)}>
                            <option value="">Asignar corredor</option>
                            {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
                          </select>
                          <div className="property-card-actions">
                            <select value={recordStage(record)} onChange={(e) => updateStage(record, e.target.value)}>
                              {PROPERTY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                            </select>
                            <button className="ghost-btn" type="button" onClick={() => createPropertyCampaign(record)} disabled={campaigningId === record.id}>
                              {campaigningId === record.id ? "Creando..." : "Campana"}
                            </button>
                          </div>
                        </div>
                      )) : <p>No hay propiedades en esta etapa.</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="tgi-work-grid">
            <section className="vertical-list">
              <div className="vertical-card-head"><div><span>{visits.length} visitas</span><h2>Agenda y resultados</h2></div></div>
              <div className="tgi-record-list">
                {visits.length ? visits.slice(0, 8).map((record) => (
                  <article key={record.id}>
                    <strong>{record.title}</strong>
                    <span>{recordValue(record, "propertyTitle")} / {recordValue(record, "scheduledAt") || "sin fecha"}</span>
                    <small>{recordValue(record, "result") || "Pendiente de resultado"}</small>
                  </article>
                )) : <p className="meta-line">Aun no hay visitas registradas.</p>}
              </div>
            </section>
            <section className="vertical-list">
              <div className="vertical-card-head"><div><span>{owners.length} propietarios</span><h2>Propietarios y captacion</h2></div></div>
              <div className="tgi-record-list">
                {owners.length ? owners.slice(0, 8).map((record) => (
                  <article key={record.id}>
                    <strong>{record.title}</strong>
                    <span>{recordValue(record, "phone") || "Sin telefono"} / {recordValue(record, "origin") || "sin origen"}</span>
                    <small>{recordValue(record, "email") || "Sin email"}</small>
                  </article>
                )) : <p className="meta-line">Los propietarios se crean al cargar propiedades.</p>}
              </div>
            </section>
          </section>

          <section className="tgi-work-grid">
            <section className="vertical-list tgi-mobile-panel">
              <div className="vertical-card-head"><div><span>Portal corredor</span><h2>Vista movil operativa</h2></div></div>
              <div className="tgi-mobile-preview">
                <div className="mobile-phone-shell">
                  <div className="mobile-phone-head"><strong>TGI Corredor</strong><span>{activeProperties.length} propiedades</span></div>
                  <div className="mobile-phone-kpis">
                    <span>{nextVisits.length}<small>visitas</small></span>
                    <span>{aiReadyProperties.length}<small>prioridad</small></span>
                    <span>{activeDeals.length}<small>cierres</small></span>
                  </div>
                  <div className="mobile-phone-list">
                    {activeProperties.slice(0, 4).map((record) => (
                      <article key={record.id}>
                        <strong>{record.title}</strong>
                        <span>{record.assignedTo?.name || "Sin corredor"} / {recordStage(record)}</span>
                        <small>{money(recordValue(record, "price"))}</small>
                      </article>
                    ))}
                  </div>
                </div>
                <p>Los corredores ven propiedades asignadas, leads, visitas y acciones de seguimiento desde mobile usando los mismos registros de esta vertical.</p>
              </div>
            </section>

            <section className="vertical-list">
              <div className="vertical-card-head"><div><span>{notifications.length} alertas</span><h2>Alertas y recordatorios activos</h2></div></div>
              <div className="tgi-record-list">
                {notifications.length ? notifications.slice(0, 6).map((item) => (
                  <article key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.body || "Sin detalle"}</span>
                    <small>{item.metadata?.dueAt ? `Vence: ${String(item.metadata.dueAt)}` : new Date(item.createdAt).toLocaleString("es-CL")}</small>
                  </article>
                )) : <p className="meta-line">No hay recordatorios activos.</p>}
              </div>
            </section>
          </section>

          <section className="vertical-list">
            <div className="vertical-card-head"><div><span>{activeProperties.length} activas</span><h2>Inventario inmobiliario</h2></div></div>
            <div className="property-card-grid">
              {activeProperties.map((record) => (
                <article className="property-card" key={record.id}>
                  {recordValue(record, "photoUrl") ? <img src={String(recordValue(record, "photoUrl"))} alt="" /> : <div className="property-photo-fallback">PR</div>}
                  <div><strong>{record.title}</strong><span>{recordValue(record, "address") || "Sin direccion"}</span></div>
                  <div className="property-specs">
                    <span>{recordValue(record, "bedrooms") || 0} piezas</span>
                    <span>{recordValue(record, "bathrooms") || 0} banos</span>
                    <span>{recordValue(record, "parking") || 0} est.</span>
                    <span>{recordValue(record, "meters") || 0} m2</span>
                  </div>
                  <p>{recordValue(record, "observations") || "Sin observaciones."}</p>
                  <footer><strong>{money(recordValue(record, "price"))}</strong><small>{record.assignedTo?.name || "Sin corredor"}</small></footer>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </ModuleGate>
  );
}
