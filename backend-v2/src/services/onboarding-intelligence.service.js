import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";
import { env } from "../lib/env.js";
import { chatComplete } from "../lib/openai.js";

const MAX_TEXT_CHARS = 28000;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function splitLines(text = "") {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function simpleCsvParse(text = "") {
  const lines = splitLines(text);
  if (!lines.length) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map((h) => compact(h).toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(separator);
    return Object.fromEntries(headers.map((header, index) => [header, compact(cells[index] ?? "")]));
  });
}

function normalizeProduct(row = {}) {
  const keys = Object.keys(row);
  const find = (...names) => {
    const key = keys.find((k) => names.some((name) => k.toLowerCase().includes(name)));
    return key ? row[key] : undefined;
  };
  const name = compact(find("nombre", "producto", "name", "title"));
  if (!name) return null;
  return {
    name,
    description: compact(find("descripcion", "descripción", "description", "detalle")) || null,
    price: toNumber(find("precio", "price", "valor")),
    stock: Math.max(0, Math.round(toNumber(find("stock", "cantidad", "qty")))) || 0,
    category: compact(find("categoria", "categoría", "category", "tipo")) || null,
    location: compact(find("ubicacion", "ubicación", "location", "sucursal")) || null,
    attributes: { source: "onboarding_import" }
  };
}

async function extractTextFromFile(file) {
  const originalname = file.originalname || "archivo";
  const mime = file.mimetype || "";
  const lower = originalname.toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet")) {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const parts = [];
    const rows = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      rows.push(...jsonRows);
      parts.push(`Hoja: ${sheetName}`);
      parts.push(XLSX.utils.sheet_to_csv(sheet));
    }
    return { text: parts.join("\n"), rows };
  }

  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    const data = await pdfParse(file.buffer);
    return { text: data.text || "", rows: [] };
  }

  const text = file.buffer.toString("utf8");
  const rows = lower.endsWith(".csv") ? simpleCsvParse(text) : [];
  return { text, rows };
}

function heuristicExtract(text = "", rows = [], manual = {}) {
  const normalizedRows = rows.map(normalizeProduct).filter(Boolean).slice(0, 200);
  const lines = splitLines(text);

  const products = [...normalizedRows];
  if (!products.length) {
    for (const line of lines) {
      const priceMatch = line.match(/(?:\$|clp|precio\s*:?\s*)\s*([0-9][0-9.,]*)/i);
      if (!priceMatch) continue;
      const name = compact(line.replace(priceMatch[0], "").replace(/[-–|;]/g, " ")).slice(0, 120);
      if (name.length < 3) continue;
      products.push({ name, description: null, price: toNumber(priceMatch[1]), stock: 0, category: null, location: null, attributes: { source: "heuristic_text" } });
      if (products.length >= 80) break;
    }
  }

  const faqs = [];
  const questionLines = lines.filter((line) => line.includes("?")).slice(0, 60);
  for (const q of questionLines) {
    const idx = lines.indexOf(q);
    const answer = compact(lines[idx + 1] || "");
    faqs.push({ question: q, answer: answer && !answer.includes("?") ? answer : "Responder según políticas del negocio." });
  }

  const policyKeywords = ["envío", "envio", "devolución", "devolucion", "cambio", "garantía", "garantia", "pago", "despacho", "retiro", "stock", "horario"];
  const policies = lines.filter((line) => policyKeywords.some((kw) => line.toLowerCase().includes(kw))).slice(0, 50);

  return {
    business: {
      name: manual.businessName || null,
      industry: manual.industry || null,
      tone: manual.tone || null,
      objective: manual.objective || null,
      description: manual.description || null
    },
    products,
    faqs,
    policies,
    suggestedTone: manual.tone || "cercano, claro y orientado a la venta",
    summary: "Extracción heurística generada sin IA o como respaldo.",
    warnings: []
  };
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {}
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

export async function extractOnboardingKnowledge({ files = [], manual = {} }) {
  const fileResults = [];
  let allText = "";
  let allRows = [];

  for (const file of files) {
    const result = await extractTextFromFile(file);
    fileResults.push({ name: file.originalname, size: file.size, textChars: result.text.length });
    allText += `\n\n### Archivo: ${file.originalname}\n${result.text}`;
    allRows.push(...result.rows);
  }

  const fallback = heuristicExtract(allText, allRows, manual);
  const textForAi = allText.slice(0, MAX_TEXT_CHARS);

  if (!env.openAiApiKey || !textForAi.trim()) {
    return { ...fallback, fileResults, usedAI: false, rawText: allText.slice(0, MAX_TEXT_CHARS) };
  }

  try {
    const content = await chatComplete({
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 2500,
      messages: [
        {
          role: "system",
          content: `Eres un analista de onboarding para un SaaS omnicanal con IA. Extrae datos comerciales del negocio. Devuelve SOLO JSON válido con esta forma: {"business":{"name":string|null,"industry":string|null,"tone":string|null,"objective":string|null,"description":string|null},"products":[{"name":string,"description":string|null,"price":number,"stock":number,"category":string|null,"location":string|null,"attributes":object}],"faqs":[{"question":string,"answer":string}],"policies":[string],"suggestedTone":string,"summary":string,"warnings":[string]}. No inventes precios; si no hay precio usa 0. No inventes stock; si no hay stock usa 0.`
        },
        {
          role: "user",
          content: JSON.stringify({ manual, text: textForAi })
        }
      ]
    });
    const parsed = safeJsonParse(content);
    if (!parsed) throw new Error("La IA no devolvió JSON válido");

    return {
      business: { ...fallback.business, ...(parsed.business || {}) },
      products: Array.isArray(parsed.products) ? parsed.products.map(normalizeProduct).filter(Boolean).slice(0, 200) : fallback.products,
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs.filter((x) => x?.question).slice(0, 100) : fallback.faqs,
      policies: Array.isArray(parsed.policies) ? parsed.policies.map(compact).filter(Boolean).slice(0, 100) : fallback.policies,
      suggestedTone: compact(parsed.suggestedTone) || fallback.suggestedTone,
      summary: compact(parsed.summary) || fallback.summary,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      fileResults,
      usedAI: true,
      rawText: allText.slice(0, MAX_TEXT_CHARS)
    };
  } catch (error) {
    return {
      ...fallback,
      fileResults,
      usedAI: false,
      rawText: allText.slice(0, MAX_TEXT_CHARS),
      warnings: [`No se pudo usar IA para extraer datos: ${error.message}`]
    };
  }
}
