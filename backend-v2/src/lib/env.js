import "dotenv/config";

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text.replace(/\/$/, "");
  return `https://${text.replace(/\/$/, "")}`;
}

function normalizeUrlList(value) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeUrl(item))
    .filter(Boolean);
}

const publicBaseUrl = normalizeUrl(firstEnv("PUBLIC_BASE_URL", "BACKEND_PUBLIC_URL", "RAILWAY_PUBLIC_DOMAIN"));
const frontendOrigin = normalizeUrl(firstEnv(
  "FRONTEND_ORIGIN",
  "FRONTEND_URL",
  "CORS_ORIGIN",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "frontendOrigin"
)) || publicBaseUrl || "*";
const corsOrigins = [
  ...normalizeUrlList(firstEnv("CORS_ORIGINS", "ALLOWED_ORIGINS", "ALLOWED_ORIGIN")),
  frontendOrigin,
  publicBaseUrl
].filter(Boolean);
const configuredDefaultTenantSlug = firstEnv("DEFAULT_TENANT_SLUG", "defaultTenantSlug");

export const env = {
  nodeEnv: firstEnv("NODE_ENV", "nodeEnv") || "development",

  port: Number(firstEnv("PORT") || 3000),

  DATABASE_URL: firstEnv("DATABASE_URL"),

  openAiApiKey: firstEnv("OPENAI_API_KEY", "openAiApiKey"),

  verifyToken: firstEnv("VERIFY_TOKEN", "verifyToken"),

  metaAccessToken: firstEnv(
    "META_ACCESS_TOKEN",
    "metaAccessToken"
  ),

  whatsappToken:
    firstEnv("WHATSAPP_TOKEN", "whatsappToken") ||
    firstEnv("META_ACCESS_TOKEN", "metaAccessToken"),

  whatsappPhoneNumberId: firstEnv(
    "WHATSAPP_PHONE_NUMBER_ID",
    "whatsappPhoneNumberId"
  ),

  instagramBusinessAccountId: firstEnv(
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "instagramBusinessAccountId"
  ),

  defaultTenantSlug:
    configuredDefaultTenantSlug ||
    "demo-inmobiliaria",

  jwtSecret: firstEnv("JWT_SECRET", "jwtSecret"),

  sessionCookieName: firstEnv("SESSION_COOKIE_NAME", "sessionCookieName") || "evolum_session",
  sessionCookieSameSite: firstEnv("SESSION_COOKIE_SAME_SITE", "sessionCookieSameSite") || "lax",
  sessionCookieDomain: firstEnv("SESSION_COOKIE_DOMAIN", "sessionCookieDomain"),
  metadataRetentionEnabled: firstEnv("METADATA_RETENTION_ENABLED", "metadataRetentionEnabled") === "true",

  frontendOrigin,
  corsOrigins: [...new Set(corsOrigins)],

  publicBaseUrl,

  enableAutomation:
    firstEnv("ENABLE_AUTOMATION", "enableAutomation") === "true",

  enableDevTools:
    firstEnv("ENABLE_DEV_TOOLS", "enableDevTools") === "true",

  enableTraceLogs:
    firstEnv("ENABLE_TRACE_LOGS", "enableTraceLogs") === "true",

  metaAppSecret: firstEnv(
    "META_APP_SECRET",
    "metaAppSecret"
  ),

  calendarUrl: firstEnv(
    "CALENDAR_URL",
    "calendarUrl"
  ),

  paymentBaseUrl: firstEnv(
    "PAYMENT_BASE_URL",
    "paymentBaseUrl"
  ),

  paymentProvider:
    firstEnv("PAYMENT_PROVIDER", "paymentProvider") || "manual",

  // Lanzamientos nativos de la app. Se publican por variable de entorno para
  // no acoplar el backend a un proveedor particular de archivos (S3, R2,
  // GitHub Releases, sitio web, etc.). El enlace es intencionalmente público:
  // se muestra antes de que una persona inicie sesión en la app.
  mobileAndroidLatestVersion: firstEnv("MOBILE_ANDROID_LATEST_VERSION"),
  mobileAndroidMinimumVersion: firstEnv("MOBILE_ANDROID_MINIMUM_VERSION"),
  mobileAndroidDownloadUrl: normalizeUrl(firstEnv("MOBILE_ANDROID_DOWNLOAD_URL")),
  mobileAndroidReleaseNotes: firstEnv("MOBILE_ANDROID_RELEASE_NOTES"),
  mobileAndroidReleaseEnabled: firstEnv("MOBILE_ANDROID_RELEASE_ENABLED") === "true",
  mobileIosLatestVersion: firstEnv("MOBILE_IOS_LATEST_VERSION"),
  mobileIosMinimumVersion: firstEnv("MOBILE_IOS_MINIMUM_VERSION"),
  mobileIosDownloadUrl: normalizeUrl(firstEnv("MOBILE_IOS_DOWNLOAD_URL")),
  mobileIosReleaseNotes: firstEnv("MOBILE_IOS_RELEASE_NOTES"),
  mobileIosReleaseEnabled: firstEnv("MOBILE_IOS_RELEASE_ENABLED") === "true",
};

const required = ["DATABASE_URL", "jwtSecret"];

for (const key of required) {
  if (!env[key]) {
    throw new Error(
      `Falta variable de entorno: ${key}`
    );
  }
}

if (env.nodeEnv === "production") {
  const unsafeJwtSecrets = new Set(["change_me_local", "secret", "jwt_secret", "dev", "password"]);
  if (unsafeJwtSecrets.has(String(env.jwtSecret || "").trim()) || String(env.jwtSecret || "").length < 32) {
    throw new Error("JWT_SECRET de producción debe tener al menos 32 caracteres y no usar valores demo.");
  }

  if (!env.frontendOrigin || env.frontendOrigin === "*") {
    throw new Error("FRONTEND_ORIGIN debe apuntar al dominio real en producción.");
  }

  // El fallback demo sirve para desarrollo local. Solo advertimos si alguien
  // configuró explícitamente un tenant demo en producción.
  if (configuredDefaultTenantSlug && String(configuredDefaultTenantSlug).startsWith("demo")) {
    console.warn("[ENV_WARNING] DEFAULT_TENANT_SLUG apunta a un tenant demo. Revisa configuración productiva.");
  }
}

if (env.nodeEnv !== "production" && firstEnv("ENABLE_DEV_TOOLS", "enableDevTools") === undefined) {
  env.enableDevTools = true;
}
