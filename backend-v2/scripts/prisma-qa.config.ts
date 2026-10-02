// Explicit config disables Prisma CLI's implicit loading of the project's .env.
// The guarded runner supplies the isolated database URL, never a production URL.
export default {
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' }
};
