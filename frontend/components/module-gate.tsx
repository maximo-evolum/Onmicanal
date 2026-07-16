"use client";

import type { ReactNode } from "react";
import { useModuleAccess, type ModuleAccessKey } from "@/lib/module-access";

export function ModuleGate({ moduleKey, children }: { moduleKey: ModuleAccessKey; children: ReactNode }) {
  const { allowed, loading } = useModuleAccess(moduleKey);

  if (loading) {
    return <div className="module-access-state">Validando acceso...</div>;
  }

  if (!allowed) {
    // No redirigir automáticamente al CRM: conserva el contexto y evita que
    // el menú parezca volver al inicio por una validación de módulo.
    return <div className="module-access-state">Módulo no habilitado para esta cuenta.</div>;
  }

  return <>{children}</>;
}
