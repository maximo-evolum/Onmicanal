/** Archivo: Proporciona infraestructura y utilidades compartidas para notifications. */
import { prisma } from "./db.js";
import { normalizeMetadata } from "./metadata.js";
import { sendTenantPushNotification } from "./push-notifications.js";
import { normalizeIndustryCode } from "./industries.js";

// Las notificaciones pertenecen a un tenant, pero no toda capacidad del
// tenant pertenece a la misma vertical. Este alcance evita que, por ejemplo,
// un aviso de Nubox aparezca en Broker OS si existe una configuración histórica
// o una sincronización equivocada dentro de la misma empresa.
export const NOTIFICATION_SCOPES = Object.freeze({
  CORE: "CORE",
  FINANCE: "FINANCE",
  REAL_ESTATE: "REAL_ESTATE",
  AUTOMOTIVE: "AUTOMOTIVE",
  GASTRONOMY: "GASTRONOMY",
  HEALTH: "HEALTH",
  DENTAL: "DENTAL",
  VETERINARY: "VETERINARY"
});

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scopeFromValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/\b(finance|finanzas|financiero|nubox|sii|dte|floid|defontana|softland|cartola|banco|conciliacion|cobranza)\b/.test(text)) return NOTIFICATION_SCOPES.FINANCE;
  if (/\b(real estate|inmobiliari|broker|propiedad|captacion|tasacion|arriendo|corredor|postventa)\b/.test(text)) return NOTIFICATION_SCOPES.REAL_ESTATE;
  if (/\b(automotriz|automotive|taller|vehiculo|repuesto)\b/.test(text)) return NOTIFICATION_SCOPES.AUTOMOTIVE;
  if (/\b(gastronomia|gastronomy|restaurante|comanda|mesa)\b/.test(text)) return NOTIFICATION_SCOPES.GASTRONOMY;
  if (/\b(dental|odontolog)\b/.test(text)) return NOTIFICATION_SCOPES.DENTAL;
  if (/\b(veterinari|mascota)\b/.test(text)) return NOTIFICATION_SCOPES.VETERINARY;
  if (/\b(salud|health|clinica|paciente)\b/.test(text)) return NOTIFICATION_SCOPES.HEALTH;
  if (/\b(core|crm|general|evolum)\b/.test(text)) return NOTIFICATION_SCOPES.CORE;
  return null;
}

function scopeFromTarget(targetUrl) {
  const target = String(targetUrl || "").trim().toLowerCase();
  if (target.startsWith("/finance")) return NOTIFICATION_SCOPES.FINANCE;
  if (target.startsWith("/realty") || target.startsWith("/broker")) return NOTIFICATION_SCOPES.REAL_ESTATE;
  if (target.startsWith("/workshop")) return NOTIFICATION_SCOPES.AUTOMOTIVE;
  if (target.startsWith("/operations/gastronomy")) return NOTIFICATION_SCOPES.GASTRONOMY;
  if (target.startsWith("/operations/dental")) return NOTIFICATION_SCOPES.DENTAL;
  if (target.startsWith("/operations/veterinary")) return NOTIFICATION_SCOPES.VETERINARY;
  if (target.startsWith("/operations/health") || target.startsWith("/patients") || target.startsWith("/exams")) return NOTIFICATION_SCOPES.HEALTH;
  return null;
}

/**
 * Determina el ámbito de producto para avisos nuevos y heredados. La URL de
 * destino es prioritaria: es el contexto real al que se enviará a la persona.
 * Para registros antiguos se usa metadata y, como último recurso, texto
 * inequívoco como "Nubox" o "cartola".
 */
export function notificationScopeFor(input = {}) {
  const data = normalizeMetadata(input.data || input.metadata, {});
  const targetUrl = input.targetUrl || data.targetUrl;
  const fromTarget = scopeFromTarget(targetUrl);
  if (fromTarget) return fromTarget;

  for (const value of [
    data.notificationScope,
    data.vertical,
    data.verticalCode,
    data.product,
    data.productCode,
    data.industry,
    data.module,
    data.recordType,
    data.screen,
    data.provider,
    data.notificationType
  ]) {
    const scope = scopeFromValue(value);
    if (scope) return scope;
  }

  const fromContent = scopeFromValue([input.title, input.body, data.body].filter(Boolean).join(" "));
  return fromContent || NOTIFICATION_SCOPES.CORE;
}

/** El Core es compartido; los ámbitos verticales solo se ven en su rubro. */
export function notificationVisibleForIndustry(input, industry) {
  const scope = notificationScopeFor(input);
  if (scope === NOTIFICATION_SCOPES.CORE) return true;
  return scope === normalizeIndustryCode(industry);
}

export async function createTenantNotification({
  tenantId,
  title,
  body = "",
  severity = "info",
  targetUrl = null,
  assignedToId = null,
  metadata = {}
} = {}) {
  if (!tenantId || !title) return null;

  const notificationScope = notificationScopeFor({ title, body, targetUrl, metadata });
  // Esta comprobación queda en la capa central porque los trabajos automáticos
  // (por ejemplo Nubox) no pasan por la ruta HTTP de notificaciones. Así se
  // evita guardar o enviar push de Finanzas dentro de una cuenta Broker.
  // Una falla transitoria al consultar el tenant no debe dejar una promesa
  // rechazada en trabajos en segundo plano. Se omite el aviso hasta el próximo
  // ciclo, que es preferible a arriesgar una filtración entre verticales.
  const tenant = await prisma.tenant
    .findUnique({ where: { id: tenantId }, select: { industry: true } })
    .catch(() => null);
  if (!tenant || !notificationVisibleForIndustry({ title, body, targetUrl, metadata: { ...metadata, notificationScope } }, tenant.industry)) {
    return null;
  }

  const notification = await prisma.industryRecord.create({
    data: {
      tenantId,
      recordType: "notification",
      title: String(title).trim(),
      status: "UNREAD",
      assignedToId,
      data: normalizeMetadata({
        ...metadata,
        body: String(body || "").trim(),
        severity: String(severity || "info").trim().toLowerCase(),
        targetUrl,
        notificationScope
      }, {})
    }
  });

  // La creación del aviso interno no depende del proveedor push. Si Expo/FCM
  // no responde, el aviso sigue disponible dentro de EVOLUM.
  void sendTenantPushNotification({
    tenantId,
    assignedToId,
    title: notification.title,
    body,
    type: String(metadata?.notificationType || "general"),
    data: {
      notificationId: notification.id,
      targetUrl,
      screen: metadata?.screen || null,
      notificationScope
    }
  });

  return notification;
}
