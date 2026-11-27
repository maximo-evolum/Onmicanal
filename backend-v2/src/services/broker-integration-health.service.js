/** Lectura pasiva de conexiones Broker por empresa. No abre canales ni contacta a proveedores. */
import { Prisma } from "@prisma/client";
import { BROKER_PUBLICATION_CHANNELS, BROKER_PUBLICATION_PROVIDER_STATUSES } from "./broker-publication.service.js";

const remote=(key,label,group,channels,required=["token"])=>({key,label,group,channels,required,remote:true});
const local=(key,label,group,channels,required=[])=>({key,label,group,channels,required,remote:false});
const ml="broker_mercadolibre_real_estate";
// Incorporar un adaptador aquí solo cuando se conozca qué conector escribe su evidencia.
// Una cuenta de Mercado Pago, un activo Meta vecino o Nubox no prueban conectividad de otro canal.
export const brokerSources=[
  remote(ml,"Mercado Libre Inmuebles","Publicación",[ml],["token","external"]),
  remote("meta_whatsapp","WhatsApp Business","Comunicación",["meta_whatsapp","whatsapp"],["token","phone","business"]),
  remote("meta_instagram","Instagram Business","Comunicación",["meta_instagram","instagram"],["token","business"]),
  remote("facebook_business","Facebook Business","Comunicación",["facebook_business","facebook"],["token","external"]),
  remote("meta_business","Meta Business Suite","Comunicación",["meta_business"]),
  remote("gmail","Gmail","Correo y archivos",["gmail"],["token","external"]),
  remote("google_drive","Google Drive","Correo y archivos",["google_drive"],["token","external"]),
  remote("sharepoint","SharePoint / OneDrive","Correo y archivos",["sharepoint"],["token","external"]),
  remote("mercadopago","Mercado Pago","Pagos",["mercadopago"],["token","external"]),
  local("email_imap","Correo IMAP / SMTP","Correo y archivos",["email_imap","email"],["token","imap"]),
  local("webpay","Webpay / Transbank","Pagos",["webpay","transbank"],["token","commerce"]),
  local("bank_links","Datos para transferencia","Pagos",["bank_links"],["bank"]),
  ...[["google_workspace","Google Workspace"],["google_calendar","Google Calendar"],["onedrive","OneDrive"],["stripe","Stripe"]].map(([key,label])=>local(key,label,"Otros registros",[key]))
];
export const brokerSourceByKey=new Map(brokerSources.map(s=>[s.key,s]));
export function brokerAccountDiscovered(key, discovery){
  if(!brokerSourceByKey.get(key)?.remote)return true;
  if(!discovery?.externalAccountId)return false;
  if(key==="meta_whatsapp")return Boolean(discovery.phoneNumberId && discovery.businessAccountId);
  if(key==="meta_instagram")return Boolean(discovery.discovery?.account?.instagram?.id);
  return true;
}
const labels={NOT_CONFIGURED:"Sin registro",DISCONNECTED:"Desactivada",INCOMPLETE:"Configuración incompleta",UNVERIFIED:"Sin prueba remota confirmada",LOCAL_ONLY:"Solo configuración local",VERIFIED:"Verificación reciente",STALE:"Verificación antigua",ERROR:"Última comprobación fallida",EXPIRED:"Credencial vencida"};
const errorLabels={AUTH:"El proveedor no aceptó la autorización.",PERMISSION:"Permiso insuficiente en el proveedor.",TIMEOUT:"El proveedor no respondió a tiempo.",LIMIT:"El proveedor limitó las solicitudes.",MISSING:"Faltan datos para completar la prueba.",OTHER:"La comprobación no fue satisfactoria."};
export function brokerErrorCode(message){
  const existing=Object.keys(errorLabels).find(code=>message===errorLabels[code]);
  if(existing)return existing;
  if(/faltan campos/i.test(message))return "MISSING";
  if(/401|unauthori|invalid.grant|invalid.token/i.test(message))return "AUTH";
  if(/403|forbidden|permission|permis/i.test(message))return "PERMISSION";
  if(/timeout|timed out|abort/i.test(message))return "TIMEOUT";
  return /429|rate.limit/i.test(message)?"LIMIT":"OTHER";
}
export function brokerSafeTestError(provider,message){
  return message&&brokerSourceByKey.has(provider.key)?errorLabels[brokerErrorCode(message)]:message;
}
const stamp=v=>{if(!(v instanceof Date)&&typeof v!=="string")return null;const t=new Date(v);return Number.isFinite(+t)?t.toISOString():null;};
const newest=(...values)=>values.map(stamp).filter(Boolean).sort().at(-1)||null;
const day=86400000;
export function brokerHealthItem(source,row,audit={},now=new Date()){
  const m=row?.metadata||{},current=+now;
  const past=v=>{const t=stamp(v);return t&&Date.parse(t)<=current?t:null;};
  const checked=past(m.lastTestedAt), changed=stamp(m.connectionConfigChangedAt),expires=stamp(m.oauthExpiresAt);
  const result=String(m.lastTestStatus||"").toUpperCase(),kind=m.lastTestKind;
  const success=source.remote && result==="OK" && (kind==="REMOTE"||(!kind && row?.legacyAccount && ["Token y cuenta OAuth validados","OAuth conectado y cuenta detectada"].includes(m.lastTestMessage)));
  const lastSuccessAt=source.remote?newest(past(m.lastTestRemoteSuccessAt),success&&checked,past(audit.success)):null;
  const lastErrorAt=newest(past(m.lastTestFailureAt),result==="ERROR"&&checked,past(audit.error));
  const lastCheckedAt=newest(checked,lastSuccessAt,lastErrorAt,past(audit.success));
  const errorCode=lastErrorAt && (lastErrorAt===past(m.lastTestFailureAt)&&Object.hasOwn(errorLabels,m.lastTestFailureCode)
    ?m.lastTestFailureCode:(lastErrorAt===checked&&result==="ERROR")?brokerErrorCode(String(m.lastTestMessage||"")):"OTHER");
  let state;
  if(!row)state="NOT_CONFIGURED";
  else if(!row.isActive)state="DISCONNECTED";
  else if(source.remote&&expires&&Date.parse(expires)<=current)state="EXPIRED";
  else if(source.required.some(k=>!row[k]))state="INCOMPLETE";
  else if(lastErrorAt&&(!changed||lastErrorAt>=changed)&&(!checked||lastErrorAt>checked||(lastErrorAt===checked&&result==="ERROR")))state="ERROR";
  else if(!source.remote)state="LOCAL_ONLY";
  else if(!success||!checked||(changed&&checked<changed))state="UNVERIFIED";
  else state=current-Date.parse(checked)>day?"STALE":"VERIFIED";
  return {key:source.key,label:source.label,group:source.group,registered:!!row,state,stateLabel:labels[state],
    lastCheckedAt,lastSuccessAt,lastErrorAt,lastError:errorCode?errorLabels[errorCode]:null,expiresAt:expires};
}

/** Campos controlados por el servidor (prefijo lastTest bloqueado en ambos formularios de credenciales). */
export function brokerTestEvidence(provider,{at,ok,remote:contacted,error}){
  if(!brokerSourceByKey.has(provider.key))return {};
  return {lastTestKind:contacted?"REMOTE":"LOCAL",...(ok&&contacted?{lastTestRemoteSuccessAt:at}:{}),
    ...(!ok?{lastTestFailureAt:at,lastTestFailureCode:brokerErrorCode(String(error||""))}:{})};
}

export async function readBrokerIntegrationHealth(db,tenantId,{sources=brokerSources,includePortals=true,now=new Date()}={}){
  if(!tenantId)throw new Error("Falta la empresa de la consulta Broker.");
  const channels=sources.flatMap(s=>s.channels);
  // Solo PostgreSQL comprueba la presencia de una credencial; el proceso no recibe su valor.
  const rows=channels.length?await db.$queryRaw`SELECT id,channel,"isActive",
    (SELECT jsonb_object_agg(k,v) FROM jsonb_each(CASE WHEN jsonb_typeof(metadata)='object' THEN metadata ELSE '{}'::jsonb END) AS m(k,v) WHERE k IN
      ('lastTestedAt','connectionConfigChangedAt','oauthExpiresAt','lastTestStatus','lastTestKind','lastTestMessage','lastTestRemoteSuccessAt','lastTestFailureAt','lastTestFailureCode')) AS metadata,
    coalesce(trim("accessToken"),'')<>'' AS token,coalesce(trim("externalAccountId"),'')<>'' AS external,
    CASE WHEN channel IN ('instagram','meta_instagram') THEN coalesce(metadata#>>'{oauthDiscovery,account,instagram,id}','')<>''
         WHEN channel IN ('whatsapp','meta_whatsapp') THEN coalesce(metadata#>>'{oauthDiscovery,account,id}',metadata#>>'{oauthDiscovery,account,whatsapp,id}','')<>''
         ELSE coalesce(nullif(metadata#>>'{oauthDiscovery,account,id}',''),nullif(metadata#>>'{oauthDiscovery,account,email}',''),nullif(metadata#>>'{oauthDiscovery,account,permissionId}',''),nullif(metadata#>>'{oauthDiscovery,account,pageId}',''),nullif(metadata#>>'{oauthDiscovery,account,driveId}',''),'')<>'' END AS "legacyAccount",
    coalesce(trim(metadata->>'host'),'')<>'' AND coalesce(trim(metadata->>'port'),'')<>'' AND coalesce(trim(metadata->>'username'),'')<>'' AS imap,
    coalesce(trim(metadata->>'commerceCode'),'')<>'' AS commerce,
    coalesce(trim(metadata->>'bankName'),'')<>'' AND coalesce(trim(metadata->>'accountNumber'),'')<>'' AS bank,
    coalesce(trim("phoneNumberId"),'')<>'' AS phone,coalesce(trim("businessAccountId"),'')<>'' AS business
    FROM "TenantChannelConfig" WHERE "tenantId"=${tenantId} AND channel IN (${Prisma.join(channels)})`:[];
  const audits=rows.length?await db.$queryRaw`SELECT DISTINCT ON ("entityId", metadata->>'ok') "entityId",metadata->>'ok' AS ok,"createdAt" AS at,metadata->>'checkedAt' AS checked FROM "TenantAuditLog"
    WHERE "tenantId"=${tenantId} AND entity='tenant_channel_config' AND action IN ('CONNECTION_TESTED','CONNECTION_AUTO_VERIFIED')
      AND "entityId" IN (${Prisma.join(rows.map(r=>r.id))}) AND metadata->>'ok' IN ('true','false')
      AND coalesce(metadata->>'pending','false')<>'true' ORDER BY "entityId",metadata->>'ok',"createdAt" DESC`:[];
  const byId=new Map();for(const a of audits){const v=byId.get(a.entityId)||{};v[a.ok==="true"?"success":"error"]=stamp(a.checked)||a.at;byId.set(a.entityId,v);}
  const items=sources.map(s=>{const candidates=s.channels.map(c=>rows.find(r=>r.channel===c)).filter(Boolean);
    const row=candidates.find(c=>c.isActive)||candidates[0];return brokerHealthItem(s,row,byId.get(row?.id),now);});
  const contracts=includePortals?await db.industryRecord.findMany({where:{tenantId,recordType:"broker_publication_provider"},select:{data:true,status:true},orderBy:[{updatedAt:"desc"},{id:"desc"}]}):[];
  const portals=includePortals?BROKER_PUBLICATION_CHANNELS.filter(p=>p.key!=="EVOLUM_CATALOGO").map(p=>{
    const reg=contracts.find(r=>r.data?.channel===p.key),raw=reg?.data?.providerStatus||reg?.status;
    return {key:p.key,label:p.label,providerStatus:BROKER_PUBLICATION_PROVIDER_STATUSES.includes(raw)?raw:"PENDING_PROVIDER",
      technicalConnectionKey:p.key==="MERCADOLIBRE_INMUEBLES"?ml:null,externalPublishingEnabled:false};}):[];
  return {tenantId,asOf:now.toISOString(),freshnessHours:24,items,portals,externalActionsEnabled:false};
}
