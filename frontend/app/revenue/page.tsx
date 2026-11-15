/** Archivo: Renderiza la página web de EVOLUM OS correspondiente a page. */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RevenueRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/payments");
  }, [router]);

  // Mantiene el mismo lienzo ejecutivo mientras la redirección de
  // compatibilidad se hidrata. De esta forma un enlace antiguo no muestra la
  // composición anterior ni deja una pantalla vacía si la navegación tarda.
  return <main className="main dashboard-page model-a-page-canvas"><section className="module-app-header model-a-page-header"><div><span>INGRESOS</span><h1>Abriendo pagos</h1><p>Redirigiendo al módulo que concentra cobros, estados y enlaces de pago.</p></div></section></main>;
}
