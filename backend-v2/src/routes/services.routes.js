import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const servicesRouter = Router();

function cleanPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    basePrice: Number(body.basePrice || 0),
    pricePerGuest: Number(body.pricePerGuest || 0),
    minGuests: body.minGuests !== undefined ? Number(body.minGuests) : 20,
    includes: Array.isArray(body.includes) ? body.includes : [],
    zones: Array.isArray(body.zones) ? body.zones : [],
    notes: body.notes ? String(body.notes).trim() : null,
    priority: body.priority !== undefined ? Number(body.priority) : 100,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true
  };
}

servicesRouter.get("/services", async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }]
    });
    res.json(services);
  } catch (error) {
    console.error("List services error:", error);
    res.status(500).json({ error: "No se pudieron obtener servicios" });
  }
});

servicesRouter.post("/services", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const payload = cleanPayload(req.body);
    if (!payload.name) return res.status(400).json({ error: "name es requerido" });
    const service = await prisma.service.create({ data: { tenantId: req.tenantId, ...payload } });
    res.json(service);
  } catch (error) {
    console.error("Create service error:", error);
    res.status(500).json({ error: "No se pudo crear servicio" });
  }
});

servicesRouter.patch("/services/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.service.findFirst({ where: { id: req.params.id, tenantId: req.tenantId } });
    if (!existing) return res.status(404).json({ error: "Servicio no encontrado" });
    const service = await prisma.service.update({ where: { id: req.params.id }, data: cleanPayload({ ...existing, ...req.body }) });
    res.json(service);
  } catch (error) {
    console.error("Update service error:", error);
    res.status(500).json({ error: "No se pudo actualizar servicio" });
  }
});
