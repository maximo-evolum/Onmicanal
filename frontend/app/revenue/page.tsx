"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RevenueRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/payments");
  }, [router]);

  return <main className="main dashboard-page"><div className="empty-state">Redirigiendo a Pagos...</div></main>;
}
