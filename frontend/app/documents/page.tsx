import { redirect } from "next/navigation";

// La gestión de documentos forma parte de Configuración de Agente. Mantener
// esta ruta evita enlaces rotos antiguos y lleva a una pantalla que conserva
// carga, descarga autenticada y eliminación de archivos del tenant.
export default function DocumentsPage() {
  redirect("/onboarding#documentos");
}
