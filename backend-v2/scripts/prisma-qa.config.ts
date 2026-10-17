/** Archivo: Automatiza una tarea operativa, de calidad o mantenimiento relacionada con prisma qa.config. */
// La configuración explícita desactiva la carga implícita del .env del proyecto por Prisma CLI.
// El ejecutor protegido entrega la URL de base aislada, nunca una URL de producción.
export default {
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' }
};
