"use client";

import { RealtyPropertiesPageContent, RealtyShell } from "@/components/realty-workspace";

export default function PropertiesPage() {
  return (
    <RealtyShell active="Propiedades" moduleKey="properties">
      <RealtyPropertiesPageContent />
    </RealtyShell>
  );
}
