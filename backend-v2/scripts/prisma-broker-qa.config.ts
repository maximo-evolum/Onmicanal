/** Archivo: Declara Prisma para la base local aislada de QA de Broker OS. */
// La URL se inyecta exclusivamente desde broker-qa-environment.mjs.
// Esta configuración evita que Prisma CLI cargue el .env del desarrollador.
export default {
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' }
};
