import { SESSION_ACCESS_STORAGE_KEY } from "./constants";
import type { AgentSession } from "./types";

export type TenantAccessSnapshot = {
  userId: string;
  tenantId: string | null;
  role: string | null;
  jobTitle: string | null;
  industry: string | null;
  modules: string[];
};

function accessKey(session?: Pick<AgentSession, "id" | "tenantId"> | null) {
  if (!session?.id) return null;
  return `${SESSION_ACCESS_STORAGE_KEY}:${session.id}:${session.tenantId || "default"}`;
}

export function getStoredTenantAccess(session?: Pick<AgentSession, "id" | "tenantId"> | null): TenantAccessSnapshot | null {
  if (typeof window === "undefined") return null;
  const key = accessKey(session);
  if (!key) return null;

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || "null") as TenantAccessSnapshot | null;
    if (!parsed || parsed.userId !== session?.id || parsed.tenantId !== (session?.tenantId || null) || !Array.isArray(parsed.modules)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storeTenantAccess(snapshot: TenantAccessSnapshot) {
  if (typeof window === "undefined" || !snapshot.userId) return;
  const key = `${SESSION_ACCESS_STORAGE_KEY}:${snapshot.userId}:${snapshot.tenantId || "default"}`;
  window.sessionStorage.setItem(key, JSON.stringify({ ...snapshot, modules: [...new Set(snapshot.modules || [])] }));
  window.dispatchEvent(new Event("evolum-module-access-updated"));
}

export function clearStoredTenantAccess(session?: Pick<AgentSession, "id" | "tenantId"> | null) {
  if (typeof window === "undefined") return;
  const key = accessKey(session);
  if (key) window.sessionStorage.removeItem(key);
}
