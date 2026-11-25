/** Controles operativos versionados por empresa y permisos de uso de los agentes Broker. */
import { createHash } from "node:crypto";
import { BROKER_AGENT_CATALOG } from "./broker-workflows.service.js";
import { canBrokerAction } from "./broker-access.service.js";

const TYPE = "broker_tenant_control";
export const brokerControlError = (status, message) => Object.assign(new Error(message), { status });
export const operationalDefaults = Object.freeze({
  priceGapPct: 10, draftDays: 7, incompleteDays: 0, matchScore: 65,
  reminderLimit: 3, onReminderLimit: "ESCALATE", trackerNotices: true,
  blockDuplicateContacts: true, blockDuplicateCampaigns: true, showInfoNotices:true
});
const capabilities = {
  commercial: ["EVALUATE", "SUGGEST"], marketing: ["EVALUATE", "DRAFT"],
  analytics: ["EVALUATE", "SCAN"], crm: ["DRAFT"]
};
const areas = {commercial:["commercial"],marketing:["projects"],crm:["commercial"],
  analytics:["commercial","operations","documents","rentals","maintenance","post_sale","financing","projects","administration","commissions","ai"]};
export function agentDefaults(key) {
  const agent = BROKER_AGENT_CATALOG.find(item => item.key === key);
  if (!agent) throw brokerControlError(404, "Agente desconocido.");
  const available = ["AVAILABLE", "LIMITED"].includes(agent.status);
  return { enabled: available, approverOnly:false, actions: available ? [...(capabilities[key] || [])] : [], areas: available ? [...(areas[key] || [])] : [] };
}
export function validateControls(key, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw brokerControlError(422, "Configuración no válida.");
  if (key.startsWith("notices:")) {
    if (typeof value.showInfoNotices !== "boolean") throw brokerControlError(422,"Elige si quieres ver avisos informativos.");
    return {showInfoNotices:value.showInfoNotices};
  }
  if (key.startsWith("agent:")) {
    const base = agentDefaults(key.slice(6));
    if (!base.enabled || typeof value.enabled !== "boolean" || (value.approverOnly !== undefined && typeof value.approverOnly !== "boolean") || !Array.isArray(value.actions) ||
        !Array.isArray(value.areas) || value.areas.some(a=>!base.areas.includes(a)) || (value.enabled && !value.areas.length) ||
        value.actions.some(a => !base.actions.includes(a)) || (value.enabled && !value.actions.length)) {
      throw brokerControlError(422, "El agente no admite esa habilitación o acción.");
    }
    return { enabled: value.enabled, approverOnly:value.approverOnly === true, actions: [...new Set(value.actions)], areas:[...new Set(value.areas)] };
  }
  const ranges = { priceGapPct: [0,100], draftDays: [1,365], incompleteDays: [0,365], matchScore: [0,100], reminderLimit: [1,30] };
  for (const [field, [min,max]] of Object.entries(ranges)) {
    if (!Number.isInteger(value[field]) || value[field] < min || value[field] > max) throw brokerControlError(422, "Revisa los rangos de la política operativa.");
  }
  if (!["ESCALATE", "BLOCK"].includes(value.onReminderLimit) ||
      ["trackerNotices","blockDuplicateContacts","blockDuplicateCampaigns","showInfoNotices"].some(k => typeof value[k] !== "boolean")) throw brokerControlError(422, "Revisa los controles de avisos, duplicados y escalamiento.");
  return Object.fromEntries(Object.keys(operationalDefaults).map(k => [k,value[k]]));
}
function initial(key) { return key === "operations" ? operationalDefaults : key.startsWith("notices:") ? {showInfoNotices:true} : agentDefaults(key.slice(6)); }
function idFor(tenantId, key) {
  if (!tenantId) throw brokerControlError(403, "Falta la empresa activa.");
  return "bc_" + createHash("sha256").update(JSON.stringify([tenantId,key])).digest("hex");
}
function payload(key, row) {
  return { value: row ? validateStored(key,row.data.value) : initial(key), revision: row?.schemaVersion ?? 0,
    previous: row?.data?.previous ?? null, reason: row?.data?.reason ?? null, updatedAt: row?.updatedAt ?? null };
}
function validateStored(key, value) {
  if (key.startsWith("agent:") && !agentDefaults(key.slice(6)).enabled) return { enabled:false, actions:[], areas:[] };
  return validateControls(key,value);
}
export async function readBrokerControl(db,tenantId,key = "operations") {
  return payload(key,await db.industryRecord.findFirst({ where:{ tenantId,recordType:TYPE,id:idFor(tenantId,key) } }));
}
export async function agentRegistry(db, tenantId) {
  const keys = BROKER_AGENT_CATALOG.map(a => [a.key,idFor(tenantId,"agent:"+a.key)]);
  const rows = await db.industryRecord.findMany({ where:{ tenantId,recordType:TYPE,id:{in:keys.map(([,id])=>id)} } });
  const byId = new Map(rows.map(r => [r.id,r]));
  return Object.fromEntries(keys.map(([key,id])=>[key,payload("agent:"+key,byId.get(id))]));
}
export function canUseAgent(control, key, action, access, area) {
  return Boolean(control?.value.enabled && control.value.actions.includes(action) &&
    (!control.value.approverOnly || canBrokerAction(access,"ai","APPROVE")) &&
    (!area || control.value.areas.includes(area)) &&
    (access?.profileKind !== "CUSTOM" || access.agentKeys?.includes(key)));
}
export async function assertAgent(db,req,key,action,area) {
  const control = await readBrokerControl(db,req.tenantId,"agent:"+key);
  if (!canUseAgent(control,key,action,req.brokerAccess,area)) {
    throw brokerControlError(403,"Esta acción del agente no está habilitada para tu empresa o perfil.");
  }
  return control.value;
}
export async function saveBrokerControl(db,{tenantId,userId},key,input) {
  if (!Number.isInteger(input?.revision) || input.revision < 0 || typeof input.reason !== "string" ||
      input.reason.trim().length < 5 || input.reason.length > 500) throw brokerControlError(422,"Revisa la versión e indica un motivo de entre 5 y 500 caracteres.");
  const stale = () => brokerControlError(409,"Otra persona modificó este control. Actualiza y revisa los cambios.");
  try {
    return await db.$transaction(async tx => {
      const old = await readBrokerControl(tx,tenantId,key);
      if (old.revision !== input.revision) throw stale();
      if (key.startsWith("agent:") && !input.revert && old.value.approverOnly && input.value?.approverOnly === undefined) {
        throw brokerControlError(422,"Actualiza el editor antes de cambiar el control de aprobación.");
      }
      const value = validateControls(key,input.revert === true ? old.previous : input.value);
      const id = idFor(tenantId,key), revision = old.revision + 1, reason = input.reason.trim();
      const data = { key,value,previous:old.value,reason };
      if (!old.revision) {
        await tx.industryRecord.create({data:{id,tenantId,recordType:TYPE,title:key,schemaVersion:revision,data}});
      } else {
        const saved = await tx.industryRecord.updateMany({where:{id,tenantId,recordType:TYPE,schemaVersion:old.revision},data:{schemaVersion:revision,data}});
        if (saved.count !== 1) throw stale();
      }
      await tx.tenantAuditLog.create({data:{tenantId,actorUserId:userId,action:"BROKER_TENANT_CONTROL_CHANGED",entity:TYPE,entityId:id,
        metadata:{key,revision,reason,before:old.value,after:value,reverted:input.revert === true}}});
      return readBrokerControl(tx,tenantId,key);
    });
  } catch(e) { if (e.code === "P2002" || e.code === "P2034") throw stale(); throw e; }
}
