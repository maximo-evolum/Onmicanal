/**
 * Recorre Broker OS publicado sin crear ni modificar registros.
 * Requiere credenciales entregadas por el administrador mediante variables de entorno.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";

const baseUrl = String(process.env.BROKER_PROD_URL || "").replace(/\/$/, "");
const email = String(process.env.BROKER_PROD_EMAIL || "").trim();
const password = String(process.env.BROKER_PROD_PASSWORD || "");
const output = resolve(process.env.QA_OUTPUT || "E:/Entregables_EVOLUM_OS/QA_Broker_OS/produccion_v1");
const permittedOutput = resolve("E:/Entregables_EVOLUM_OS");
const tabs = [
  "operations", "commercial", "rentals", "maintenance", "projects", "post_sale", "documents",
  "financing", "commissions", "administration_preview", "guides", "configuration", "access",
  "governance", "compliance", "agents", "training"
];
const mobileTabs = new Set(["operations", "commercial", "rentals", "maintenance", "projects", "post_sale", "documents", "financing", "governance"]);
const recordAreas = new Set(["commercial", "rentals", "maintenance", "projects", "post_sale", "documents", "financing"]);
const darkTabs = ["operations", "commercial", "post_sale", "documents", "governance"];
const tabLabels = {
  operations: "Operaciones", commercial: "Comercial y cierre", rentals: "Arriendos y administracion",
  maintenance: "Mantencion y proveedores", projects: "Proyectos y publicacion", post_sale: "Postventa y garantias",
  documents: "Expediente y documentos", financing: "Financiamiento", commissions: "Comisiones",
  administration_preview: "Liquidacion mensual", guides: "Guias operativas", configuration: "Parametros",
  access: "Roles y accesos", governance: "Gobierno y alertas", compliance: "Cumplimiento", agents: "Agentes IA", training: "Entrenamiento IA"
};
const comparableLabel = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL");

if (!/^https:\/\//i.test(baseUrl)) throw new Error("BROKER_PROD_URL debe ser una URL HTTPS publicada.");
if (!email || !password) throw new Error("Define BROKER_PROD_EMAIL y BROKER_PROD_PASSWORD fuera del código.");
if (!output.startsWith(`${permittedOutput}${sep}`)) throw new Error("QA_OUTPUT debe estar dentro de E:/Entregables_EVOLUM_OS.");

mkdirSync(output, { recursive: true });

const browser = await chromium.launch(process.platform === "win32" ? { headless: true, channel: "msedge" } : { headless: true });
const results = { target: baseUrl, mode: "read-only", startedAt: new Date().toISOString(), desktop: [], mobile: [], dark: [], browserErrors: [], failedRequests: [], serverErrors: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "es-CL", timezoneId: "America/Santiago" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => results.browserErrors.push({ url: page.url(), message: error.message }));
  page.on("requestfailed", (request) => results.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText || "fallo sin detalle" }));
  page.on("response", (response) => {
    if (response.status() >= 500) results.serverErrors.push({ url: response.url(), status: response.status() });
  });

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Correo electrónico").fill(email);
  await page.getByPlaceholder("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: `${output}/01-login-y-entrada-escritorio.png`, fullPage: true });

  for (const tab of tabs) {
    const tabQuery = recordAreas.has(tab) ? `area=${encodeURIComponent(tab)}` : `tab=${encodeURIComponent(tab)}`;
    const response = await page.goto(`${baseUrl}/realty?view=broker_os&${tabQuery}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const visibleText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const layout = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      tallElements: Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return { tag: element.tagName, className: String(element.className || "").slice(0, 120), height: Math.round(bounds.height) };
        })
        .filter((item) => item.height > 1800)
        .slice(0, 12)
    }));
    const activeTab = (await page.locator(".broker-os-tabs button.active").allTextContents()).map((value) => value.trim()).filter(Boolean);
    const item = {
      tab,
      httpStatus: response?.status() || null,
      finalUrl: page.url(),
      hasBrokerWorkspace: visibleText.includes("Centro operativo inmobiliario") || visibleText.includes("Broker OS"),
      activeTab,
      expectedTab: tabLabels[tab],
      hasLoadFailure: /No se pudo (cargar|obtener)|Error interno|Something went wrong/i.test(visibleText),
      horizontalOverflow: scrollWidth > clientWidth + 2,
      layout,
      textPreview: visibleText.slice(0, 500)
    };
    results.desktop.push(item);
    await page.screenshot({ path: `${output}/desktop-${tab}.png`, fullPage: true });
    if (!item.hasBrokerWorkspace || comparableLabel(item.activeTab[0]) !== comparableLabel(item.expectedTab) || item.hasLoadFailure || item.horizontalOverflow || (item.httpStatus && item.httpStatus >= 400)) {
      throw new Error(`Fallo visible en pestaña ${tab}: ${JSON.stringify(item)}`);
    }

    if (mobileTabs.has(tab)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const mobileClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const mobileText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
      const mobileItem = { tab, horizontalOverflow: mobileScrollWidth > mobileClientWidth + 2, hasLoadFailure: /No se pudo (cargar|obtener)|Error interno|Something went wrong/i.test(mobileText) };
      results.mobile.push(mobileItem);
      await page.screenshot({ path: `${output}/mobile-${tab}.png`, fullPage: true });
      if (mobileItem.horizontalOverflow || mobileItem.hasLoadFailure) throw new Error(`Fallo móvil en pestaña ${tab}: ${JSON.stringify(mobileItem)}`);
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  }

  for (const tab of darkTabs) {
    const tabQuery = recordAreas.has(tab) ? `area=${encodeURIComponent(tab)}` : `tab=${encodeURIComponent(tab)}`;
    await page.goto(`${baseUrl}/realty?view=broker_os&${tabQuery}`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.setItem("evolum_theme", "purple");
      localStorage.setItem("evolum_background_theme", "nocturne");
      localStorage.setItem("evolum_color_mode", "dark");
      document.documentElement.dataset.theme = "purple";
      document.documentElement.dataset.bgTheme = "nocturne";
      document.documentElement.dataset.designSystem = "dark";
    });
    await page.waitForTimeout(350);
    const darkClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const darkScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const darkText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    const activeTab = (await page.locator(".broker-os-tabs button.active").allTextContents()).map((value) => value.trim()).filter(Boolean);
    const accessSummary = await page.locator(".broker-access-summary").evaluate((element) => {
      const styles = getComputedStyle(element);
      return { backgroundImage: styles.backgroundImage, color: styles.color };
    }).catch(() => null);
    const hasReadableDarkAccessSummary = Boolean(accessSummary?.backgroundImage?.includes("gradient") && accessSummary?.color === "rgb(247, 243, 255)");
    const item = { tab, activeTab, expectedTab: tabLabels[tab], horizontalOverflow: darkScrollWidth > darkClientWidth + 2, hasLoadFailure: /No se pudo (cargar|obtener)|Error interno|Something went wrong/i.test(darkText), hasReadableDarkAccessSummary };
    results.dark.push(item);
    await page.screenshot({ path: `${output}/dark-${tab}-desktop.png`, fullPage: false });
    if (comparableLabel(activeTab[0]) !== comparableLabel(tabLabels[tab]) || item.horizontalOverflow || item.hasLoadFailure || !item.hasReadableDarkAccessSummary) throw new Error(`Fallo oscuro en ${tab}: ${JSON.stringify(item)}`);
    await page.setViewportSize({ width: 390, height: 844 });
    const darkMobileClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const darkMobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const mobileWorkspace = await page.locator("main.realty-workspace").boundingBox();
    const usesMobileWidth = Boolean(mobileWorkspace && mobileWorkspace.x <= 1 && mobileWorkspace.width >= darkMobileClientWidth - 1);
    if (darkMobileScrollWidth > darkMobileClientWidth + 2 || !usesMobileWidth) throw new Error(`Desbordamiento o espacio lateral indebido en modo oscuro móvil (${tab}).`);
    await page.screenshot({ path: `${output}/dark-${tab}-mobile.png`, fullPage: false });
    await page.setViewportSize({ width: 1440, height: 960 });
  }

  if (results.browserErrors.length || results.serverErrors.length) {
    throw new Error(`Errores detectados: ${JSON.stringify({ browserErrors: results.browserErrors, serverErrors: results.serverErrors })}`);
  }
  results.result = "PASS";
} catch (error) {
  results.result = "FAIL";
  results.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  results.finishedAt = new Date().toISOString();
  writeFileSync(`${output}/resultado-produccion-v1.json`, JSON.stringify(results, null, 2), "utf8");
  await browser.close();
}

console.log(`QA productiva de Broker OS aprobada. Evidencia: ${output}`);
