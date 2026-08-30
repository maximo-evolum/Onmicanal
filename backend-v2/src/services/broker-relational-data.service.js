const PROPERTY_TYPES = new Set(["CASA", "DEPARTAMENTO", "OFICINA", "LOCAL", "TERRENO", "BODEGA", "PARCELA", "OTRA"]);

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = null) {
  const parsed = number(value, fallback);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function propertyType(value) {
  const normalized = text(value, "OTRA").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const aliases = { DEPTO: "DEPARTAMENTO", APARTAMENTO: "DEPARTAMENTO", HOUSE: "CASA", OFFICE: "OFICINA", LOT: "TERRENO" };
  const resolved = aliases[normalized] || normalized;
  return PROPERTY_TYPES.has(resolved) ? resolved : "OTRA";
}

export function normalizeLegacyBrokerProperty(record) {
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : {};
  const totalSquareMeters = number(data.totalSquareMeters ?? data.totalM2 ?? data.meters ?? data.builtM2 ?? data.landM2);
  const usableSquareMeters = number(data.usableSquareMeters ?? data.builtM2 ?? data.meters ?? data.usableM2);
  const errors = [];
  if (!text(data.address ?? data.direccion ?? record?.title)) errors.push("La propiedad no tiene dirección.");
  if (!text(data.comuna ?? data.commune)) errors.push("La propiedad no tiene comuna.");
  if (totalSquareMeters !== null && usableSquareMeters !== null && usableSquareMeters > totalSquareMeters) {
    errors.push("Los metros útiles no pueden superar los metros totales.");
  }
  return {
    errors,
    owner: {
      name: text(data.ownerName ?? data.owner ?? data.propietario, "Propietario por regularizar"),
      phone: text(data.ownerPhone ?? data.telefonoPropietario),
      email: text(data.ownerEmail ?? data.correoPropietario),
      rut: text(data.ownerRut ?? data.rutPropietario) || null,
    },
    property: {
      address: text(data.address ?? data.direccion ?? record?.title),
      comuna: text(data.comuna ?? data.commune, "Sin comuna"),
      region: text(data.region, "Metropolitana"),
      propertyType: propertyType(data.propertyType ?? data.type),
      bedrooms: integer(data.bedrooms ?? data.dormitorios, 0),
      bathrooms: integer(data.bathrooms ?? data.banos, 0),
      parkingSpaces: integer(data.parking ?? data.estacionamientos, 0),
      storageRooms: integer(data.storageRooms ?? data.bodegas, 0),
      totalSquareMeters,
      usableSquareMeters,
      askingPrice: number(data.price ?? data.salePrice ?? data.rentPrice ?? data.arriendo),
      currency: text(data.currency, "CLP").toUpperCase(),
      operationalStatus: text(record?.status ?? data.status, "CAPTACION").toUpperCase(),
      coverImageUrl: Array.isArray(data.gallery) ? data.gallery[0] : (data.photoUrl || null),
      metadata: {
        operationType: text(data.operation ?? data.operationType, "VENTA").toUpperCase(),
        landSquareMeters: number(data.landM2 ?? data.terrainM2),
        commonExpenses: number(data.commonExpenses ?? data.gastosComunes),
        description: text(data.observations ?? data.description),
        features: Array.isArray(data.features) ? data.features : [],
        imageUrls: Array.isArray(data.gallery) ? data.gallery : (data.photoUrl ? [data.photoUrl] : []),
      },
      assignedBrokerId: record?.assignedToId || null,
    },
  };
}

export function brokerRelationalCoverage({ legacyProperties = 0, strictProperties = 0, owners = 0 } = {}) {
  const pendingProperties = Math.max(0, legacyProperties - strictProperties);
  return {
    legacyProperties,
    strictProperties,
    owners,
    pendingProperties,
    completionPercent: legacyProperties ? Math.round((strictProperties / legacyProperties) * 100) : 100,
  };
}
