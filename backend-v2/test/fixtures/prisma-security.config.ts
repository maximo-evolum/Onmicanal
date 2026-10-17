/** Archivo: Verifica mediante pruebas automatizadas el comportamiento de prisma security.config. */
export default {
  schema: "./schema.prisma",
  migrations: { path: "./migrations", seed: "node seed.js" }
};
