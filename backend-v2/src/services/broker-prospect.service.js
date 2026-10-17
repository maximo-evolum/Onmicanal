/** Archivo: Implementa reglas de negocio y procesos del dominio broker prospect. */
// Prospectos previos al mandato: no son propiedades publicables ni negocios.
export const PROSPECT_STAGES = ["PROSPECCION", "CONTACTO", "TASACION", "NEGOCIACION"];
export const PROSPECT_LABELS = ["Prospección", "Contacto", "Tasación preliminar", "Negociación de mandato"];
const fail = (message, status = 422) => { throw Object.assign(new Error(message), { status }); };
const str = value => String(value ?? "").trim();
const fields = ["ownerName", "ownerPhone", "ownerEmail", "ownerRut", "title", "address", "comuna", "region", "propertyType", "captureOrigin", "referredBy", "intendedService", "currency", "siteVisitAt", "firstContactAt", "ownerExpectedPrice", "usableSquareMeters", "totalSquareMeters", "bedrooms", "bathrooms", "photoUrl", "floorPlanUrl", "observations", "propertyConditionAtHandover"];

export function prospectInput(input, previous = {}) {
  const data = { ...previous };
  for (const key of fields) if (input[key] !== undefined) data[key] = str(input[key]).slice(0, key === "observations" ? 5000 : 1000);
  for (const key of ["ownerName", "title", "captureOrigin", "intendedService"]) if (!data[key]) fail(`Completa el campo ${({ ownerName: "propietario", title: "propiedad", captureOrigin: "origen", intendedService: "destino" })[key]}.`);
  if (!data.ownerPhone && !data.ownerEmail) fail("Registra teléfono o correo de contacto.");
  if (data.captureOrigin === "Referido" && !data.referredBy) fail("Identifica quién refirió al propietario.");
  if (data.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.ownerEmail)) fail("El correo no es válido.");
  if (!["VENTA", "ARRIENDO", "ADMINISTRACION"].includes(data.intendedService)) fail("Destino de operación no válido.");
  data.currency ||= "CLP";
  if (!["CLP", "UF", "USD"].includes(data.currency)) fail("Moneda no válida.");
  for (const key of ["ownerExpectedPrice", "usableSquareMeters", "totalSquareMeters", "bedrooms", "bathrooms"]) {
    if (data[key] !== undefined && data[key] !== "") {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0) fail(`Valor no válido para ${key}. Usa números sin separador de miles.`);
      data[key] = value;
    }
  }
  if (Number(data.usableSquareMeters) > Number(data.totalSquareMeters)) fail("La superficie útil no puede superar la total.");
  for (const key of ["siteVisitAt", "firstContactAt"]) if (data[key] && Number.isNaN(Date.parse(data[key]))) fail("Fecha no válida.");
  if (data.ownerRut) {
    const rut = data.ownerRut.replace(/[.\s-]/g, "").toUpperCase();
    if (!/^\d{7,8}[\dK]$/.test(rut)) fail("RUT del propietario no válido.");
    const digits = rut.slice(0, -1);
    let sum = 0, factor = 2;
    for (const digit of [...digits].reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
    const remainder = 11 - sum % 11;
    if ((remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder)) !== rut.at(-1)) fail("El dígito verificador del RUT no coincide.");
    data.ownerRut = `${digits}-${rut.at(-1)}`;
  }
  return data;
}

export function prospectEvent(data, action, userId, details = {}, now = new Date()) {
  return { ...data, version: (data.version || 0) + 1, timeline: [...(data.timeline || []), { at: now.toISOString(), userId, action, ...details }] };
}

export function prospectTransition(data, target) {
  if (data.outcome) fail("El prospecto ya está cerrado.", 409);
  if (data.isReferral && !data.referralConvertedAt) fail("Incorpora el referido al embudo antes de avanzar.");
  const index = PROSPECT_STAGES.indexOf(data.stage);
  if (PROSPECT_STAGES[index + 1] !== target) fail("Solo puedes avanzar a la etapa inmediatamente siguiente.");
  if (target === "TASACION" && (!data.address || !data.comuna || !data.propertyType)) fail("Completa dirección, comuna y tipo de propiedad antes de tasar.");
  if (target === "NEGOCIACION" && !(data.valuation?.amount > 0)) fail("Registra una valorización preliminar antes de negociar.");
  return { ...data, stage: target, stageEnteredAt: new Date().toISOString() };
}

export function mandateTerms(data, input) {
  if (data.stage !== "NEGOCIACION" || data.outcome) fail("El prospecto debe estar en negociación de mandato.", 409);
  if (!data.address || !data.comuna || !data.propertyType) fail("Completa la ubicación y tipo de inmueble.");
  const price = Number(input.publicationPrice), rate = Number(input.commissionPct), days = Number(input.exclusivityDays);
  if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(rate) || rate <= 0 || rate > 100 || ![60, 90, 120, 180].includes(days)) fail("Revisa precio, comisión y plazo de exclusividad.");
  if (!str(input.evidenceReference) || input.confirmSigned !== true) fail("Confirma la firma y registra la referencia del mandato firmado. Esto no sustituye una firma electrónica.");
  if (!str(input.signedAt) || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(str(input.signedAt))) fail("Indica una fecha de firma válida.");
  const signedAt = new Date(input.signedAt);
  if (!Number.isNaN(signedAt.getTime()) && signedAt.toISOString().slice(0,10) !== str(input.signedAt).slice(0,10)) fail("La fecha de firma no existe en el calendario.");
  if (Number.isNaN(signedAt.getTime()) || signedAt > new Date()) fail("Fecha de firma no válida o futura.");
  return { publicationPrice: price, commissionPct: rate, exclusivityDays: days, signedAt: signedAt.toISOString(), evidenceReference: str(input.evidenceReference).slice(0, 1000), currency: data.currency };
}

export function prospectPresentation(record, now = new Date()) {
  const d = record.data;
  const days = Math.max(0, Math.floor((now - new Date(d.stageEnteredAt || record.createdAt)) / 86400000));
  const gap = d.valuation?.amount > 0 && d.ownerExpectedPrice > 0 ? (d.ownerExpectedPrice - d.valuation.amount) / d.valuation.amount * 100 : null;
  const next = { PROSPECCION: "Contactar al propietario y calificar su necesidad", CONTACTO: "Coordinar visita y completar datos del inmueble", TASACION: "Revisar comparables y alinear expectativa de precio", NEGOCIACION: "Acordar condiciones y registrar el mandato firmado" };
  return { ...record, daysInStage: days, priceGapPct: gap, priceGapWarning: gap !== null && Math.abs(gap) > 10, priority: !d.outcome && (days >= 7 || d.stage === "NEGOCIACION") ? "ALTA" : "NORMAL", nextAction: d.outcome ? "Proceso finalizado" : next[d.stage] };
}

// Actualización condicional: serializa la conversión y evita pérdida de notas.
export async function claimProspect(db, record, version) {
  if (version !== record.data.version) fail("La ficha cambió. Actualiza antes de guardar.", 409);
  const claimed = await db.industryRecord.updateMany({ where: { id: record.id, tenantId: record.tenantId, data: { path: ["version"], equals: version } }, data: { data: { ...record.data, version: version + 1 } } });
  if (claimed.count !== 1) fail("Otra acción actualizó este prospecto. Recarga la ficha.", 409);
}

export function comparableValuation(data, records) {
  const norm = v => str(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const candidates = records.filter(r => {
    const p = r.data || {};
    return norm(p.comuna || p.commune) === norm(data.comuna) && norm(p.propertyType) === norm(data.propertyType) && norm(p.operation) === norm(data.intendedService) && str(p.currency || "CLP") === data.currency && Number(p.price) > 0;
  }).map(r => ({ id: r.id, title: r.title, price: Number(r.data.price), area: Number(r.data.usableSquareMeters || r.data.meters) }));
  if (candidates.length < 3) fail("No hay al menos tres comparables autorizados de igual comuna, tipo, destino y moneda. Registra una evaluación profesional con su fundamento.");
  const perMeter = Number(data.usableSquareMeters) > 0 && candidates.every(c => c.area > 0);
  const values = candidates.map(c => perMeter ? c.price / c.area * Number(data.usableSquareMeters) : c.price).sort((a,b) => a-b);
  const middle = Math.floor(values.length / 2);
  const amount = Number((values.length % 2 ? values[middle] : (values[middle-1] + values[middle]) / 2).toFixed(data.currency === "CLP" ? 0 : 2));
  return { amount, currency: data.currency, method: "MEDIANA_COMPARABLES", rationale: perMeter ? "Mediana de precios por m² útil aplicada a la superficie del prospecto." : "Mediana de precios publicados; superficies no homogéneas. Requiere revisión profesional.", comparables: candidates, generatedAt: new Date().toISOString(), preliminary: true };
}
