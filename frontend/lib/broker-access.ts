/** Archivo: Proporciona lógica cliente compartida para broker access en la aplicación web. */
import type { BrokerAccessProfile } from "./api";

export function canBroker(access: BrokerAccessProfile | null, area: string, action = "VIEW") {
  if (!access) return false;
  if (access.technicalRole === "SUPER_ADMIN") return true;
  if (access.technicalRole === "VIEWER" && action !== "VIEW") return false;
  return (access.policy.actions[area] || access.policy.actions["*"] || []).includes(action);
}

export function brokerTabArea(tab: string) {
  return ({ agents: "ai", training: "ai", administration_preview: "administration", guides: "overview", compliance: "documents", governance: "access" } as Record<string, string>)[tab] || tab;
}

export function canBrokerTab(access: BrokerAccessProfile | null, tab: string) {
  return canBroker(access, brokerTabArea(tab), ["access", "governance"].includes(tab) ? "CONFIGURE" : "VIEW");
}

export function canBrokerLink(access: BrokerAccessProfile | null, href: string) {
  if (!href.startsWith("/realty")) return true;
  const query = new URLSearchParams(href.split("?")[1] || "");
  const view = query.get("view") || "overview";
  if (view === "brokers") return canBroker(access, "access", "CONFIGURE") || canBroker(access, "commercial", "ASSIGN");
  if (view === "broker_os") return canBrokerTab(access, query.get("area") || query.get("tab") || "operations");
  const area = ({ overview: "overview", brokers: "access", training: "ai" } as Record<string, string>)[view] || "commercial";
  return canBroker(access, area, view === "brokers" ? "CONFIGURE" : "VIEW");
}
