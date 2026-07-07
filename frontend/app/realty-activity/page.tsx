"use client";

import { RealtyActivityPageContent, RealtyShell } from "@/components/realty-workspace";

export default function RealtyActivityPage() {
  return (
    <RealtyShell active="Actividad inmobiliaria" moduleKey="realty_activity">
      <RealtyActivityPageContent />
    </RealtyShell>
  );
}
