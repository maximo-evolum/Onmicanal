/** Archivo: Cataloga capacidades transversales de Case Management sin duplicar expedientes ni procesos. */
import Link from "next/link";
import { canBrokerLink } from "@/lib/broker-access";
import type { BrokerAccessProfile } from "@/lib/api";

const CAPABILITIES = [
  { key: "people", title: "Expediente digital de personas", current: "Propietarios, compradores y antecedentes se consultan desde sus módulos y el expediente de la propiedad.", partial: "La solicitud automática de documentos, versionado formal y alertas de vigencia avanzadas requieren una integración documental específica.", href: "/realty?view=owners" },
  { key: "field-evidence", title: "Evidencia en terreno", current: "Visitas, inspecciones, entregas y casos postventa mantienen sus antecedentes dentro del expediente relacionado.", partial: "Carga multimedia enriquecida, geolocalización certificada, audio y firma externa no se deben presentar como evidencia automática sin su integración real.", href: "/realty?view=activity" },
  { key: "field-work", title: "Gestión de terreno", current: "Agenda, visitas y seguimiento comercial están disponibles desde los módulos operativos vinculados a la propiedad.", partial: "Rutas optimizadas, check-in/check-out GPS y firma presencial son capacidades futuras; no se simulan como activas.", href: "/realty?view=activity" },
  { key: "physical-inventory", title: "Inventario físico de entrega", current: "Inspecciones, inventario de entrega y postventa se gestionan como controles de la propiedad.", partial: "Es distinto al inventario comercial: no representa precio, publicación ni disponibilidad de venta/arriendo.", href: "/realty?view=broker_os&tab=post_sale" },
  { key: "commissions", title: "Motor de comisiones", current: "Las políticas y liquidaciones de comisión se consultan en Finanzas operativas Broker.", partial: "Los cálculos requieren aprobación humana y no generan pagos externos por sí solos.", href: "/realty?view=broker_os&tab=commissions" },
  { key: "timeline", title: "Cronología y expediente único", current: "Operation Tracker reúne hitos comerciales y su referencia a documentos y controles vinculados.", partial: "No reemplaza las fuentes originales ni crea una línea de tiempo paralela.", href: "/realty?view=broker_os&tab=operation_tracker" },
] as const;

export function BrokerCaseManagementPanel({ access }: { access: BrokerAccessProfile | null }) {
  return <section className="broker-case-management" aria-label="Case Management de Broker OS">
    <header className="broker-case-header"><div><span>Case Management</span><h2>Un catálogo de expedientes, no otro sistema paralelo</h2><p>Esta vista orienta al equipo hacia el módulo que conserva cada dato. No crea registros, no replica documentos y no cambia ninguna operación.</p></div><small>{access?.scopeDescription || "Consultando el alcance autorizado…"}</small></header>
    <section className="broker-case-note"><b>Distinción clave</b><p>El inventario comercial describe una propiedad para captación, venta, arriendo o publicación. El inventario físico corresponde a la entrega, llaves, medidores, mobiliario y condición del inmueble.</p></section>
    <div className="broker-case-grid">{CAPABILITIES.map((item, index) => {
      const allowed = canBrokerLink(access, item.href);
      return <article key={item.key}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><div><b>Disponible hoy</b><p>{item.current}</p></div><div><b>Alcance parcial o futuro</b><p>{item.partial}</p></div>{allowed ? <Link className="secondary-btn" href={item.href}>Abrir módulo de origen</Link> : <small className="broker-case-restricted">Este módulo no está habilitado para tu perfil.</small>}</article>;
    })}</div>
  </section>;
}
