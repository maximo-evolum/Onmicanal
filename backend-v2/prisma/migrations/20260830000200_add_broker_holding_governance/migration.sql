-- Gobierno multiempresa para el alcance HOLDING de Broker OS.
-- No concede acceso por defecto: cada usuario debe quedar autorizado de forma
-- explícita en BrokerHoldingAccess o ser SUPER_ADMIN de plataforma.

CREATE TABLE "BrokerHolding" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerHolding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerHoldingTenant" (
  "id" TEXT NOT NULL,
  "holdingId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerHoldingTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrokerHoldingAccess" (
  "id" TEXT NOT NULL,
  "holdingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrokerHoldingAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerHolding_code_key" ON "BrokerHolding"("code");
CREATE UNIQUE INDEX "BrokerHoldingTenant_tenantId_key" ON "BrokerHoldingTenant"("tenantId");
CREATE UNIQUE INDEX "BrokerHoldingTenant_holdingId_tenantId_key" ON "BrokerHoldingTenant"("holdingId", "tenantId");
CREATE INDEX "BrokerHoldingTenant_holdingId_idx" ON "BrokerHoldingTenant"("holdingId");
CREATE UNIQUE INDEX "BrokerHoldingAccess_holdingId_userId_key" ON "BrokerHoldingAccess"("holdingId", "userId");
CREATE INDEX "BrokerHoldingAccess_userId_isActive_idx" ON "BrokerHoldingAccess"("userId", "isActive");

ALTER TABLE "BrokerHoldingTenant" ADD CONSTRAINT "BrokerHoldingTenant_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "BrokerHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerHoldingTenant" ADD CONSTRAINT "BrokerHoldingTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerHoldingAccess" ADD CONSTRAINT "BrokerHoldingAccess_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "BrokerHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrokerHoldingAccess" ADD CONSTRAINT "BrokerHoldingAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WorkspaceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
