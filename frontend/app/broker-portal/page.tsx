"use client";

import { BrokerPortalPageContent, RealtyShell } from "@/components/realty-workspace";

export default function BrokerPortalPage() {
  return (
    <RealtyShell active="Portal corredor" moduleKey="broker_portal">
      <BrokerPortalPageContent />
    </RealtyShell>
  );
}
