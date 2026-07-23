import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/db.js";
import { recordAuditLog } from "../lib/audit.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";

export const documentsRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const documentsRoot = path.resolve(__dirname, "../../public/tenant-documents");

function safeFileName(value) {
  return String(value || "document")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120) || "document";
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const tenantId = req.tenantId || "unknown";
      const destination = path.join(documentsRoot, tenantId);
      fs.mkdirSync(destination, { recursive: true });
      cb(null, destination);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "");
      const base = safeFileName(path.basename(file.originalname || "document", ext));
      cb(null, `${Date.now()}-${base}${ext.toLowerCase()}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.DOCUMENT_UPLOAD_MAX_BYTES || 25 * 1024 * 1024),
    files: 10
  }
});

function publicFileUrl(req, tenantId, filename) {
  const host = process.env.PUBLIC_BASE_URL || process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${String(host).replace(/\/$/, "")}/tenant-documents/${tenantId}/${encodeURIComponent(filename)}`;
}

documentsRouter.get("/documents", async (req, res) => {
  try {
    const documents = await prisma.industryRecord.findMany({
      where: {
        tenantId: req.tenantId,
        recordType: "document",
        ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {})
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ documents });
  } catch (error) {
    console.error("List documents error:", error);
    res.status(500).json({ error: "No se pudieron cargar documentos" });
  }
});

documentsRouter.post("/documents", requireRole(ROLE_GROUPS.STAFF), upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Debes subir al menos un archivo" });

    const category = String(req.body?.category || "general").trim().toLowerCase();
    const records = [];

    for (const file of files) {
      const record = await prisma.industryRecord.create({
        data: {
          tenantId: req.tenantId,
          recordType: "document",
          title: String(req.body?.title || file.originalname || "Documento").trim(),
          status: "ACTIVE",
          data: normalizeMetadata({
            category,
            description: req.body?.description || null,
            originalName: file.originalname,
            fileName: file.filename,
            mimeType: file.mimetype,
            size: file.size,
            url: publicFileUrl(req, req.tenantId, file.filename),
            source: "upload",
            uploadedByUserId: req.user?.id || null
          }, {})
        }
      });
      records.push(record);
      await recordAuditLog(req, "DOCUMENT_UPLOADED", "document", record.id, { category, fileName: file.filename });
    }

    res.status(201).json({ documents: records });
  } catch (error) {
    console.error("Create document error:", error);
    res.status(500).json({ error: "No se pudieron guardar documentos" });
  }
});

documentsRouter.patch("/documents/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, recordType: "document" }
    });
    if (!existing) return res.status(404).json({ error: "Documento no encontrado" });

    const document = await prisma.industryRecord.update({
      where: { id: existing.id },
      data: {
        title: req.body?.title ? String(req.body.title).trim() : existing.title,
        status: req.body?.status ? String(req.body.status).trim().toUpperCase() : existing.status,
        data: normalizeMetadata({ ...(existing.data || {}), ...(req.body?.metadata || req.body?.data || {}) }, {})
      }
    });
    await recordAuditLog(req, "DOCUMENT_UPDATED", "document", document.id);
    res.json({ document });
  } catch (error) {
    console.error("Update document error:", error);
    res.status(500).json({ error: "No se pudo actualizar documento" });
  }
});

// Los documentos se guardan como un registro para conservar trazabilidad, pero
// el archivo vive en el disco del tenant. Al eliminarlo debemos retirar ambos;
// dejar solo el registro produciria enlaces rotos y dejar solo el archivo
// ocuparia almacenamiento sin que nadie pueda administrarlo desde EVOLUM.
documentsRouter.delete("/documents/:id", requireRole(ROLE_GROUPS.STAFF), async (req, res) => {
  try {
    const existing = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, recordType: "document" }
    });
    if (!existing) return res.status(404).json({ error: "Documento no encontrado" });

    const metadata = existing.data && typeof existing.data === "object" ? existing.data : {};
    const fileName = path.basename(String(metadata.fileName || ""));
    const tenantDirectory = path.join(documentsRoot, req.tenantId);
    const filePath = fileName ? path.join(tenantDirectory, fileName) : null;

    // path.basename evita que metadata manipulada pueda apuntar fuera de la
    // carpeta del tenant. Si el archivo ya no existe, igualmente eliminamos el
    // registro para que el usuario pueda limpiar referencias antiguas.
    if (filePath && filePath.startsWith(tenantDirectory) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.industryRecord.delete({ where: { id: existing.id } });
    await recordAuditLog(req, "DOCUMENT_DELETED", "document", existing.id, {
      originalName: metadata.originalName || existing.title,
      category: metadata.category || "general"
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({ error: "No se pudo eliminar el documento" });
  }
});
