export const SESSION_COOKIE = "inbox_session";
export const SESSION_STORAGE_KEY = "inbox_session";
// El snapshot de permisos vive por pestaña. Así una sesión ya validada no
// vuelve a mostrar una pantalla de comprobación al cambiar de módulo y dos
// cuentas de prueba pueden usarse en pestañas distintas sin cruzar permisos.
export const SESSION_ACCESS_STORAGE_KEY = "evolum_tenant_access";
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000/api";
