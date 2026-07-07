"use client";

import { RealtyLoadsPageContent, RealtyShell } from "@/components/realty-workspace";

export default function RealtyLoadsPage() {
  return (
    <RealtyShell active="Cargas inmobiliarias" moduleKey="realty_loads">
      <RealtyLoadsPageContent />
    </RealtyShell>
  );
}
