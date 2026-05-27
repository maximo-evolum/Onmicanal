import { Router } from "express";
import { prisma } from "../lib/db.js";
import { searchProducts } from "../services/product.service.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

const router = Router();

function cleanProductPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    description: body.description ? String(body.description).trim() : null,
    price: Number(body.price || 0),
    stock: Number.isFinite(Number(body.stock)) ? Number(body.stock) : 0,
    category: body.category ? String(body.category).trim() : null,
    location: body.location ? String(body.location).trim() : null,
    attributes: body.attributes && typeof body.attributes === "object" ? body.attributes : undefined
  };
}

router.get("/products", async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const products = query
      ? await searchProducts({ tenantId: req.tenantId, query, take: 20 })
      : await prisma.product.findMany({
          where: { tenantId: req.tenantId },
          orderBy: { updatedAt: "desc" },
          take: 100
        });

    res.json(products);
  } catch (error) {
    console.error("List products error:", error);
    res.status(500).json({ error: "No se pudieron obtener productos" });
  }
});

router.post("/products", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const payload = cleanProductPayload(req.body);
    if (!payload.name) return res.status(400).json({ error: "name es requerido" });
    if (payload.price < 0) return res.status(400).json({ error: "price no puede ser negativo" });
    if (payload.stock < 0) return res.status(400).json({ error: "stock no puede ser negativo" });

    const product = await prisma.product.create({
      data: {
        tenantId: req.tenantId,
        ...payload
      }
    });

    res.json(product);
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ error: "Error creando producto" });
  }
});

router.patch("/products/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Producto no encontrado" });

    const payload = cleanProductPayload({ ...existing, ...req.body });
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: payload
    });

    res.json(product);
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ error: "Error actualizando producto" });
  }
});

router.delete("/products/:id", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId }
    });
    if (!existing) return res.status(404).json({ error: "Producto no encontrado" });

    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ error: "Error eliminando producto" });
  }
});

export default router;
