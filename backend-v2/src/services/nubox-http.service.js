// Shared by connection checks, document reads and explicit issuance. Never
// echo provider response bodies: they may contain credentials or party data.
export class NuboxRequestError extends Error {
  constructor(code, message, { status = null, retryable = false, retryAfterMs = 0 } = {}) {
    super(message); this.name = "NuboxRequestError";
    Object.assign(this, { code, status, retryable, retryAfterMs });
  }
}
const failure = (code, message, options) => new NuboxRequestError(code, message, options);

export function nuboxEnvironment(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "api.test-nubox.com") return "CERTIFICATION";
    if (host === "api.pyme.nubox.com") return "PRODUCTION";
  } catch { /* The request validator reports invalid configuration. */ }
  return "UNCONFIRMED";
}

function endpoint(baseUrl, path) {
  let base;
  try { base = new URL(String(baseUrl || "").trim()); } catch {
    throw failure("CONFIGURATION", "Configura la URL base HTTPS entregada por Nubox para este ambiente.");
  }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
      || typeof path !== "string" || !/^\/v1\/[a-z0-9_/-]+(?:\?[^#\\]*)?$/i.test(path) || path.includes("..")) {
    throw failure("CONFIGURATION", "La URL o el recurso de Nubox no son válidos. Revisa la configuración del servidor.");
  }
  return `${base.href.replace(/\/$/, "")}${path}`;
}

async function readBounded(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw failure("RESPONSE_TOO_LARGE", "La respuesta de Nubox supera el límite seguro. No se incorporó el lote.");
  }
  const chunks = []; let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw failure("RESPONSE_TOO_LARGE", "La respuesta de Nubox supera el límite seguro. No se incorporó el lote.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function requestNubox({ baseUrl, apiKey, token, path, method = "GET", body,
  responseType = "json", extraHeaders = {}, fetchImpl = globalThis.fetch, timeoutMs = 15000,
  maxBytes = responseType === "binary" ? 25 * 1024 * 1024 : 10 * 1024 * 1024 }) {
  const url = endpoint(baseUrl, path);
  const key = String(apiKey || "").trim(), secret = String(token || "").trim().replace(/^Bearer(?:\s+|$)/i, "").trim();
  if (!key || !secret || /[\r\n]/.test(key + secret)) throw failure("CREDENTIALS", "Faltan credenciales válidas de Nubox. Revisa x-api-key y Authorization.");
  // Allow only the documented issuance idempotency header; callers cannot
  // replace authentication or change the target through arbitrary headers.
  const idempotence = extraHeaders["X-Idempotence-Id"];
  const isPdf = /\/pdf(?:\?|$)/.test(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method, redirect: "manual", signal: controller.signal,
      headers: { Authorization: `Bearer ${secret}`, "X-Api-Key": key,
        Accept: responseType === "binary" ? (isPdf ? "application/pdf" : "application/xml") : "application/json",
        "Content-Type": responseType === "binary" && isPdf ? "application/pdf" : "application/json",
        ...(idempotence ? { "X-Idempotence-Id": idempotence } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      if (status >= 300 && status < 400) throw failure("REDIRECT", "Nubox redirigió la consulta. No se reenviaron credenciales; revisa la URL del ambiente.", { status });
      if ([401, 403].includes(status)) throw failure("AUTHORIZATION", "Nubox rechazó las credenciales o permisos. Revisa la autorización de la empresa y el ambiente.", { status });
      if (status === 404) throw failure("RESOURCE", "Nubox no encontró el recurso. Comprueba el ambiente y el producto habilitado.", { status });
      const retryAfter = response.headers.get("retry-after");
      const delay = /^\d+$/.test(retryAfter || "") ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
      throw failure(status === 429 ? "RATE_LIMIT" : "HTTP", status === 429
        ? "Nubox limitó temporalmente las consultas. Espera antes de reintentar."
        : `Nubox no pudo completar la operación (HTTP ${status}).`,
      { status, retryable: method === "GET" && (status === 429 || status >= 500), retryAfterMs: Math.min(delay, 60000) });
    }
    const bytes = await readBounded(response, maxBytes);
    if (!bytes.length) throw failure("EMPTY_RESPONSE", "Nubox respondió sin contenido. No se confirmó la operación.");
    if (responseType === "binary") {
      const prefix = bytes.subarray(0, 1024).toString("utf8").trim();
      const pdf = prefix.startsWith("%PDF-"), xml = /^(?:<\?xml\b|<(?:\w+:)?(?:DTE|EnvioDTE|EnvioBOLETA)\b)/i.test(prefix);
      if (isPdf ? !pdf : !xml) throw failure("INVALID_FILE", "Nubox no devolvió el archivo PDF/XML esperado. No se descargó una respuesta inválida.");
      return { payload: bytes, contentType: pdf ? "application/pdf" : "application/xml", total: 0 };
    }
    let payload;
    try { payload = JSON.parse(bytes.toString("utf8")); } catch { throw failure("INVALID_JSON", "Nubox devolvió contenido que no es JSON válido. No se confirmó la operación."); }
    if (!payload || typeof payload !== "object") throw failure("INVALID_JSON", "Nubox devolvió una respuesta incompleta. No se confirmó la operación.");
    if (/^\/v1\/sales\?/.test(path) && !Array.isArray(payload) && !["content", "items", "data", "results"].some(key => Array.isArray(payload[key]))) {
      throw failure("INVALID_SALES", "Nubox no devolvió una lista de documentos válida. La conexión no se dará por verificada.");
    }
    const rawTotal = response.headers.get("x-total-count");
    if (rawTotal !== null && (!/^\d+$/.test(rawTotal) || !Number.isSafeInteger(Number(rawTotal)))) throw failure("INVALID_TOTAL", "Nubox devolvió un total de documentos inválido.");
    return { payload, total: Number(rawTotal || 0) };
  } catch (error) {
    if (error instanceof NuboxRequestError) throw error;
    if (controller.signal.aborted) throw failure("TIMEOUT", "Nubox excedió el tiempo de espera. El resultado no está confirmado.", { retryable: method === "GET" });
    throw failure("NETWORK", "No fue posible comunicarse con Nubox. Revisa la disponibilidad y la configuración del servidor.", { retryable: method === "GET" });
  } finally { clearTimeout(timer); }
}
