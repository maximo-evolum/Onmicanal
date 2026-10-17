/** Archivo: Crea y comparte el cliente Prisma para acceder a la base de datos PostgreSQL. */
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: ["warn", "error"]
});
