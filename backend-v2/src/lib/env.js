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

export const env = {
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
    firstEnv("DEFAULT_TENANT_SLUG", "defaultTenantSlug") ||
    "demo-inmobiliaria",

  jwtSecret: firstEnv("JWT_SECRET", "jwtSecret"),

  frontendOrigin:
    firstEnv("FRONTEND_ORIGIN", "frontendOrigin") || "*",

  enableAutomation:
    firstEnv("ENABLE_AUTOMATION", "enableAutomation") === "true",

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
};

const required = ["DATABASE_URL", "jwtSecret"];

for (const key of required) {
  if (!env[key]) {
    throw new Error(
      `Falta variable de entorno: ${key}`
    );
  }
}