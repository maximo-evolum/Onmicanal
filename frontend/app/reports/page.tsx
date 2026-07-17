import { redirect } from "next/navigation";

// Ruta de compatibilidad para marcadores o enlaces antiguos. El reporte
// ejecutivo y su PDF ahora viven dentro del Dashboard.
export default function ReportsPage() {
  redirect("/dashboard");
}
