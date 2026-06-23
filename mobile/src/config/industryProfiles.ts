export type IndustryProfile = {
  code: string;
  label: string;
  dashboardTitle: string;
  primaryEntity: string;
  pipelineStages: string[];
  bookingLabel: string;
  serviceLabel: string;
  accent: string;
  modules: string[];
};

export const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  real_estate: {
    code: "real_estate",
    label: "Inmobiliario",
    dashboardTitle: "Operacion inmobiliaria",
    primaryEntity: "Propiedad",
    pipelineStages: ["Prospeccion", "Calificacion", "Visita", "Oferta", "Cierre"],
    bookingLabel: "Visita",
    serviceLabel: "Propiedad",
    accent: "#20d3ee",
    modules: ["dashboard", "inbox", "agenda", "pipeline", "payments", "campaigns"]
  },
  automotive: {
    code: "automotive",
    label: "Automotriz",
    dashboardTitle: "Operacion automotriz",
    primaryEntity: "Vehiculo",
    pipelineStages: ["Consulta", "Cotizacion", "Test drive", "Negociacion", "Entrega"],
    bookingLabel: "Test drive",
    serviceLabel: "Vehiculo",
    accent: "#ff8a1f",
    modules: ["dashboard", "inbox", "agenda", "pipeline", "payments", "campaigns"]
  },
  dental: {
    code: "dental",
    label: "Clinica dental",
    dashboardTitle: "Operacion dental",
    primaryEntity: "Paciente",
    pipelineStages: ["Consulta", "Evaluacion", "Tratamiento", "Control", "Alta"],
    bookingLabel: "Cita",
    serviceLabel: "Tratamiento",
    accent: "#20d3ee",
    modules: ["dashboard", "inbox", "agenda", "pipeline", "payments"]
  },
  veterinary: {
    code: "veterinary",
    label: "Clinica veterinaria",
    dashboardTitle: "Operacion veterinaria",
    primaryEntity: "Mascota",
    pipelineStages: ["Consulta", "Agenda", "Atencion", "Tratamiento", "Seguimiento"],
    bookingLabel: "Consulta",
    serviceLabel: "Servicio",
    accent: "#00e5a8",
    modules: ["dashboard", "inbox", "agenda", "pipeline", "payments"]
  },
  default: {
    code: "default",
    label: "General",
    dashboardTitle: "Operacion comercial",
    primaryEntity: "Cliente",
    pipelineStages: ["Contacto", "Propuesta", "Negociacion", "Cierre"],
    bookingLabel: "Reserva",
    serviceLabel: "Servicio",
    accent: "#8b3ff4",
    modules: ["dashboard", "inbox", "agenda", "pipeline", "payments", "campaigns"]
  }
};

export function normalizeIndustry(industry?: string | null) {
  const value = String(industry || "").trim().toLowerCase();
  if (["realty", "inmobiliaria", "inmobiliario", "real_estate", "real estate"].includes(value)) return "real_estate";
  if (["automotriz", "automotive", "autos", "vehiculos"].includes(value)) return "automotive";
  if (["dental", "dentista", "clinica dental", "odontologia"].includes(value)) return "dental";
  if (["veterinaria", "veterinary", "animales", "clinica animal"].includes(value)) return "veterinary";
  return "default";
}

export function getIndustryProfile(industry?: string | null) {
  return INDUSTRY_PROFILES[normalizeIndustry(industry)] || INDUSTRY_PROFILES.default;
}
