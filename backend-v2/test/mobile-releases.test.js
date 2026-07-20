import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createMobileReleasesRouter } from "../src/routes/mobile-releases.routes.js";

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      http.get({ host: "127.0.0.1", port: address.port, path }, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
        });
      }).on("error", (error) => { server.close(); reject(error); });
    });
  });
}

function appFor(config) {
  const app = express();
  app.use("/api", createMobileReleasesRouter(config));
  return app;
}

const androidConfig = {
  mobileAndroidReleaseEnabled: true,
  mobileAndroidLatestVersion: "1.2.0",
  mobileAndroidMinimumVersion: "1.1.0",
  mobileAndroidDownloadUrl: "https://downloads.evolum.cl/evolum.apk",
  mobileAndroidReleaseNotes: "Mejoras de estabilidad"
};

test("lanzamientos móviles: no anuncia una descarga hasta habilitarla expresamente", async () => {
  const response = await request(appFor({ ...androidConfig, mobileAndroidReleaseEnabled: false }), "/api/mobile/releases/latest?platform=android");
  assert.equal(response.status, 204);
});

test("lanzamientos móviles: publica solo un enlace habilitado y válido", async () => {
  const response = await request(appFor(androidConfig), "/api/mobile/releases/latest?platform=android");
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.latestVersion, "1.2.0");
  assert.equal(response.body.downloadUrl, androidConfig.mobileAndroidDownloadUrl);
});

test("lanzamientos móviles: rechaza plataformas desconocidas", async () => {
  const response = await request(appFor(androidConfig), "/api/mobile/releases/latest?platform=windows");
  assert.equal(response.status, 400);
});
