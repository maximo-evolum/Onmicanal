import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { findIncompatibleTenantModules } from "../src/lib/tenant-module-normalization.js";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const confirmed = process.env.CONFIRM_NORMALIZE_MODULES === "YES";

async function main() {
  if (apply && !confirmed) {
    throw new Error("Para aplicar cambios define CONFIRM_NORMALIZE_MODULES=YES. Sin --apply el script solo audita.");
  }

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      tenantModules: { select: { id: true, module: true, enabled: true, source: true } }
    },
    orderBy: { slug: "asc" }
  });

  const incompatible = findIncompatibleTenantModules(tenants);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    tenantsScanned: tenants.length,
    incompatibleEnabledModules: incompatible.length,
    incompatible
  };

  if (!apply || !incompatible.length) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Railway puede cerrar las transacciones interactivas largas a trav\u00e9s del
  // proxy de conexi\u00f3n. Usamos lotes peque\u00f1os y una transacci\u00f3n declarativa
  // por lote: cada m\u00f3dulo y su auditor\u00eda siguen siendo at\u00f3micos y, si una
  // ejecuci\u00f3n se interrumpe, se puede reanudar sin duplicar cambios.
  const batchSize = 5;
  let applied = 0;
  for (let start = 0; start < incompatible.length; start += batchSize) {
    const batch = incompatible.slice(start, start + batchSize);
    const operations = batch.flatMap((item) => [
      prisma.tenantModule.update({
        where: { id: item.moduleId },
        data: { enabled: false, source: "MIGRATION" }
      }),
      prisma.tenantAuditLog.create({
        data: {
          tenantId: item.tenantId,
          action: "TENANT_MODULE_INCOMPATIBLE_DISABLED",
          entity: "tenant_module",
          entityId: item.moduleId,
          metadata: {
            module: item.module,
            industry: item.industry,
            source: item.source,
            reason: "module_not_compatible_with_tenant_industry"
          }
        }
      })
    ]);
    await prisma.$transaction(operations, { timeout: 20_000, maxWait: 10_000 });
    applied += batch.length;
  }

  console.log(JSON.stringify({ ...summary, applied }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
