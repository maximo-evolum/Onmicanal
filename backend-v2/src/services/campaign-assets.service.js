import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../lib/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "../../public/campaign-assets");

function publicBaseUrl() {
  const raw = String(env.publicBaseUrl || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

function extensionForMime(mime = "") {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function safeSlug(value = "campaign") {
  return String(value || "campaign")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "campaign";
}

export function isDataImageUrl(value = "") {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ""));
}

export function isPublicHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || ""));
}

export async function ensurePublicCampaignImage(imageUrl, { title = "campaign", requirePublicUrl = false } = {}) {
  const value = String(imageUrl || "").trim();
  if (!value) return value;
  if (isPublicHttpUrl(value)) return value;

  if (!isDataImageUrl(value)) {
    if (requirePublicUrl) throw new Error("La imagen de campaña debe ser una URL pública http(s).");
    return value;
  }

  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    if (requirePublicUrl) throw new Error("Imagen base64 inválida para publicar.");
    return value;
  }

  const base = publicBaseUrl();
  if (!base) {
    if (requirePublicUrl) {
      throw new Error("Configura PUBLIC_BASE_URL/BACKEND_PUBLIC_URL para publicar imágenes generadas.");
    }
    return value;
  }

  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const ext = extensionForMime(match[1]);
  const filename = `${Date.now()}-${safeSlug(title)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const target = path.join(ASSETS_DIR, filename);
  await fs.writeFile(target, Buffer.from(match[2], "base64"));
  return `${base}/campaign-assets/${filename}`;
}
