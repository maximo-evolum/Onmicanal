"use client";

import { BrokersPageContent, RealtyShell } from "@/components/realty-workspace";

export default function BrokersPage() {
  return (
    <RealtyShell active="Corredores" moduleKey="brokers">
      <BrokersPageContent />
    </RealtyShell>
  );
}
