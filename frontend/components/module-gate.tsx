"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useModuleAccess, type ModuleAccessKey } from "@/lib/module-access";

export function ModuleGate({ moduleKey, children }: { moduleKey: ModuleAccessKey; children: ReactNode }) {
  const router = useRouter();
  const { allowed, loading } = useModuleAccess(moduleKey);

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace("/crm-principal?blocked=module");
    }
  }, [allowed, loading, router]);

  if (loading) {
    return <div className="module-access-state">Validando acceso...</div>;
  }

  if (!allowed) {
    return <div className="module-access-state">Modulo no habilitado para esta cuenta.</div>;
  }

  return <>{children}</>;
}
