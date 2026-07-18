"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type HelpContent = { title: string; description: string; steps: string[] };

const moduleHelp: Record<string, HelpContent> = {
  "/crm-principal": { title: "Inicio", description: "es el resumen de tu operación. Aquí puedes ver lo importante y entrar rápidamente a cada área.", steps: ["Revisa los avisos principales.", "Identifica tareas o oportunidades pendientes.", "Entra al módulo que necesites desde el menú EV."] },
  "/inbox": { title: "Chat's", description: "reúne las conversaciones con tus clientes para que tu equipo responda y haga seguimiento desde un solo lugar.", steps: ["Elige una conversación.", "Revisa el contexto del cliente.", "Responde, asigna o deja una tarea de seguimiento."] },
  "/agenda": { title: "Agenda", description: "te permite ordenar citas, visitas, reservas y la disponibilidad de tu equipo.", steps: ["Revisa el calendario.", "Crea o confirma una reserva.", "Asigna al responsable y da seguimiento."] },
  "/pipeline": { title: "Pipeline", description: "muestra el avance de clientes y oportunidades para que sepas qué hacer primero.", steps: ["Revisa las etapas de cada oportunidad.", "Actualiza el avance cuando haya novedades.", "Prioriza las que requieren una acción."] },
  "/campaigns": { title: "Campañas", description: "te ayuda a organizar acciones de marketing y comunicaciones con tus clientes.", steps: ["Crea una campaña.", "Define a quién quieres llegar.", "Revisa sus resultados y ajusta la siguiente acción."] },
  "/payments": { title: "Pagos", description: "centraliza cobros, estados de pago y enlaces para mantener tus ingresos ordenados.", steps: ["Revisa pagos pendientes.", "Envía o comparte un enlace de cobro.", "Confirma el estado cuando se realice el pago."] },
  "/connections": { title: "Centro de Conexiones", description: "muestra los servicios vinculados a tu operación, como correo, mensajería, pagos y almacenamiento.", steps: ["Revisa qué cuentas están conectadas.", "Vincula una cuenta cuando la necesites.", "Confirma que el estado de la conexión sea correcto."] },
  "/onboarding": { title: "Configuración de Agente", description: "te ayuda a preparar la información que usará tu asistente de IA para atender mejor a tus clientes.", steps: ["Completa la información de tu negocio.", "Agrega documentos y preguntas frecuentes.", "Define cómo quieres que responda el asistente."] },
  "/workflows": { title: "Automatizaciones", description: "te permite dejar tareas repetitivas preparadas para que EVOLUM las realice en el momento indicado.", steps: ["Elige cuándo quieres que ocurra algo.", "Define la tarea que EVOLUM debe realizar.", "Guárdala y revísala cuando quieras."] },
  "/settings/metadata": { title: "Datos y formularios", description: "te ayuda a decidir qué información debe completar tu equipo en cada tipo de ficha.", steps: ["Elige una plantilla parecida a tu operación.", "Agrega o cambia los datos que necesitas pedir.", "Activa la ficha cuando estés conforme."] },
  "/saas": { title: "Planes y módulos", description: "permite revisar el plan de la cuenta, los módulos disponibles y el acceso del equipo.", steps: ["Revisa el plan actual.", "Activa los módulos que necesita la operación.", "Controla usuarios y límites de uso."] },
  "/dashboard": { title: "Dashboard", description: "presenta los indicadores principales de tu operación para que puedas tomar decisiones rápidas.", steps: ["Revisa los indicadores destacados.", "Filtra la información según lo que necesites analizar.", "Usa los datos para priorizar acciones."] },
  "/ai-ops": { title: "AI Ops", description: "te muestra alertas, propuestas y cierres que la inteligencia artificial puede ayudar a preparar.", steps: ["Revisa las alertas importantes.", "Valida las propuestas sugeridas.", "Usa los hallazgos para definir la siguiente acción."] },
  "/settings/ai": { title: "Control de IA", description: "te permite decidir qué tareas puede preparar la IA y en cuáles debe esperar tu aprobación.", steps: ["Elige las tareas que quieres revisar.", "Define límites para usar la IA con tranquilidad.", "Aprueba solo las propuestas con las que estés de acuerdo."] },
  "/realty-loads": { title: "Cargas inmobiliarias", description: "sirve para incorporar propiedades y ordenar la información necesaria para publicarlas o trabajarlas.", steps: ["Carga una propiedad o importa varias.", "Revisa que sus datos estén completos.", "Asigna responsable y continúa el seguimiento."] },
  "/properties": { title: "Propiedades", description: "mantiene ordenado el catálogo de propiedades de tu inmobiliaria.", steps: ["Busca o filtra una propiedad.", "Actualiza sus características y disponibilidad.", "Revisa su actividad y oportunidades asociadas."] },
  "/realty-activity": { title: "Actividad inmobiliaria", description: "concentra visitas, propietarios y alertas relacionadas con tus propiedades.", steps: ["Revisa las visitas próximas.", "Registra novedades importantes.", "Da seguimiento a propietarios y clientes."] },
  "/broker-portal": { title: "Portal corredor", description: "permite a los corredores revisar sus propiedades asignadas y avanzar sus gestiones.", steps: ["Revisa las propiedades asignadas.", "Actualiza el seguimiento de cada una.", "Registra avances y próximos pasos."] },
  "/brokers": { title: "Corredores", description: "te ayuda a organizar perfiles, asignaciones y desempeño de tu equipo comercial inmobiliario.", steps: ["Revisa los corredores activos.", "Asigna propiedades u oportunidades.", "Da seguimiento a sus avances."] },
  "/customers": { title: "Clientes y pacientes", description: "reúne las fichas y el historial de las personas atendidas por tu operación.", steps: ["Busca o crea una ficha.", "Completa la información importante.", "Revisa su historial y próximos seguimientos."] },
  "/exams": { title: "Exámenes y presupuestos", description: "permite ordenar órdenes, resultados, presupuestos y sus avances.", steps: ["Crea o encuentra un registro.", "Actualiza su estado y la información relevante.", "Da seguimiento hasta su cierre."] },
  "/workshop": { title: "Taller", description: "ayuda a organizar vehículos, trabajos, repuestos y la atención del taller.", steps: ["Registra el vehículo y su necesidad.", "Asigna el trabajo y responsable.", "Actualiza el avance hasta la entrega."] },
  "/admin": { title: "Desarrollador", description: "es el área de administración para gestionar cuentas, planes, módulos y permisos del sistema.", steps: ["Busca la cuenta que quieres revisar.", "Ajusta módulos y permisos según corresponda.", "Guarda y verifica el acceso de la cuenta."] },
  "/dev/bot-lab": { title: "Bot Lab", description: "es un espacio de prueba para revisar cómo responderá el asistente antes de usarlo con clientes.", steps: ["Escribe una situación de prueba.", "Revisa la respuesta sugerida.", "Ajusta las reglas si necesitas mejorarla."] },
  "/reports": { title: "Reportes", description: "permite consultar y descargar un resumen ejecutivo de la operación.", steps: ["Elige el período que quieres revisar.", "Analiza los indicadores principales.", "Descarga el informe cuando lo necesites."] },
  "/revenue": { title: "Ingresos", description: "muestra el estado de ingresos, cobros y resultados económicos de la operación.", steps: ["Revisa el resumen del período.", "Identifica pagos pendientes o variaciones.", "Usa los datos para planificar acciones."] },
  "/sales-queue": { title: "Cola de ventas", description: "organiza las oportunidades que requieren atención comercial.", steps: ["Revisa quién necesita respuesta.", "Prioriza las oportunidades más urgentes.", "Registra el avance de cada gestión."] },
  "/team": { title: "Equipo", description: "permite administrar a las personas que trabajan en la cuenta y sus responsabilidades.", steps: ["Revisa a los integrantes del equipo.", "Invita o actualiza a una persona.", "Asigna el acceso que necesita para trabajar."] },
  "/saas-analytics": { title: "Analítica", description: "muestra indicadores de uso y crecimiento de las cuentas de la plataforma.", steps: ["Elige el período de análisis.", "Revisa los indicadores más relevantes.", "Usa la información para detectar oportunidades."] },
};

function findHelp(pathname: string): HelpContent | null {
  const route = Object.keys(moduleHelp).sort((a, b) => b.length - a.length).find((item) => pathname === item || pathname.startsWith(`${item}/`));
  return route ? moduleHelp[route] : null;
}

export function ContextualModuleHelp() {
  const pathname = usePathname();
  const help = useMemo(() => findHelp(pathname), [pathname]);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (!help) return;
    setIsOpen(window.sessionStorage.getItem(`evolum-module-help:${pathname}`) !== "minimized");
  }, [help, pathname]);

  if (!help) return null;

  function minimize() {
    window.sessionStorage.setItem(`evolum-module-help:${pathname}`, "minimized");
    setIsOpen(false);
  }

  function open() {
    window.sessionStorage.removeItem(`evolum-module-help:${pathname}`);
    setIsOpen(true);
  }

  if (!isOpen) return <button type="button" className="context-help-icon" onClick={open} aria-label={`Ver ayuda de ${help.title}`} title={`¿Para qué sirve ${help.title}?`}>?</button>;

  return (
    <aside className="context-help-card" aria-label={`Ayuda sobre ${help.title}`}>
      <div className="context-help-heading"><span aria-hidden="true">?</span><div><p>GUÍA RÁPIDA</p><h2>¿Para qué sirve {help.title}?</h2></div><button type="button" onClick={minimize} aria-label="Minimizar ayuda" title="Minimizar ayuda">−</button></div>
      <p><strong>{help.title}:</strong> {help.description}</p>
      <ol>{help.steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </aside>
  );
}
