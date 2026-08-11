"use client";

import { useEffect, useState } from "react";
import { getOfflineQueueCount, syncOfflineQueue } from "@/lib/offline-queue";

export function OfflineSyncButton({ className = "crm-main-ops-button" }: { className?: string }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    function refresh() {
      setOnline(navigator.onLine);
      setPending(getOfflineQueueCount());
    }
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("evolum-offline-queue-change", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("evolum-offline-queue-change", refresh);
    };
  }, []);

  async function synchronize() {
    if (!online || syncing) return;
    setSyncing(true);
    try {
      const result = await syncOfflineQueue();
      setPending(result.pending);
    } finally {
      setSyncing(false);
    }
  }

  const label = !online ? "Sin conexión" : syncing ? "Subiendo..." : pending ? `Subir trabajo (${pending})` : "Respaldo";
  return <button type="button" className={className} onClick={synchronize} disabled={!online || syncing} title={!online ? "Se sincronizará al recuperar conexión" : "Sube el trabajo guardado sin conexión"}>{label}</button>;
}
