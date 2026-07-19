import { Router } from "express";
import { env } from "../lib/env.js";

export const mobileReleasesRouter = Router();

function configuredRelease(platform) {
  const isAndroid = platform === "android";
  const latestVersion = isAndroid ? env.mobileAndroidLatestVersion : env.mobileIosLatestVersion;
  const downloadUrl = isAndroid ? env.mobileAndroidDownloadUrl : env.mobileIosDownloadUrl;
  const minimumVersion = isAndroid ? env.mobileAndroidMinimumVersion : env.mobileIosMinimumVersion;
  const releaseNotes = isAndroid ? env.mobileAndroidReleaseNotes : env.mobileIosReleaseNotes;

  // No publicamos un lanzamiento incompleto: así la app no muestra un aviso
  // que luego no pueda llevar a una descarga real.
  if (!latestVersion || !downloadUrl) return null;

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
mobileReleasesRouter.get("/mobile/releases/latest", (req, res) => {
  const platform = String(req.query.platform || "").toLowerCase();
  if (!['android', 'ios'].includes(platform)) {
    return res.status(400).json({ error: "platform debe ser android o ios" });
  }

  const release = configuredRelease(platform);
  if (!release) return res.status(204).end();

  res.setHeader("Cache-Control", "no-store");
  return res.json(release);
});
