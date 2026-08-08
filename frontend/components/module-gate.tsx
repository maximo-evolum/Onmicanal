"use client";

import type { ReactNode } from "react";
import { useModuleAccess, type ModuleAccessKey } from "@/lib/module-access";

export function ModuleGate({ moduleKey, children }: { moduleKey: ModuleAccessKey; children: ReactNode }) {
  const { allowed, loading } = useModuleAccess(moduleKey);

  if (loading) {
    return (
      <div className="module-access-state module-access-loading" role="status" aria-live="polite">
        <i aria-hidden="true" />
        <span>Preparando módulo…</span>
      </div>
    );
  }

  if (!allowed) {
    // No redirigir automáticamente al CRM: conserva el contexto y evita que
    // el menú parezca volver al inicio por una validación de módulo.
    return <div className="module-access-state">Este módulo no está habilitado para esta cuenta.</div>;
  }

  return <>{children}</>;
}
