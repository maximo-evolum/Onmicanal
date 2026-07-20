import { Router } from "express";
import { env } from "../lib/env.js";

export function configuredRelease(platform, config = env) {
  const isAndroid = platform === "android";
  const enabled = isAndroid ? config.mobileAndroidReleaseEnabled : config.mobileIosReleaseEnabled;
  const latestVersion = isAndroid ? config.mobileAndroidLatestVersion : config.mobileIosLatestVersion;
  const downloadUrl = isAndroid ? config.mobileAndroidDownloadUrl : config.mobileIosDownloadUrl;
  const minimumVersion = isAndroid ? config.mobileAndroidMinimumVersion : config.mobileIosMinimumVersion;
  const releaseNotes = isAndroid ? config.mobileAndroidReleaseNotes : config.mobileIosReleaseNotes;

  // No publicamos un lanzamiento incompleto: así la app no muestra un aviso
  // que luego no pueda llevar a una descarga real.
  if (!enabled || !latestVersion || !downloadUrl) return null;

  return {
    platform,
    latestVersion: String(latestVersion).trim(),
    minimumVersion: minimumVersion ? String(minimumVersion).trim() : null,
    downloadUrl,
    releaseNotes: releaseNotes ? String(releaseNotes).trim() : null,
    publishedAt: new Date().toISOString()
  };
}

// Consulta pública y de solo lectura. La aplicación la utiliza antes del login
// para informar actualizaciones que sí requieren instalar una nueva APK/IPA.
export function createMobileReleasesRouter(config = env) {
  const router = Router();
  router.get("/mobile/releases/latest", (req, res) => {
    const platform = String(req.query.platform || "").toLowerCase();
    if (!['android', 'ios'].includes(platform)) {
      return res.status(400).json({ error: "platform debe ser android o ios" });
    }

    const release = configuredRelease(platform, config);
    if (!release) return res.status(204).end();

    res.setHeader("Cache-Control", "no-store");
    return res.json(release);
  });
  return router;
}

export const mobileReleasesRouter = createMobileReleasesRouter();
