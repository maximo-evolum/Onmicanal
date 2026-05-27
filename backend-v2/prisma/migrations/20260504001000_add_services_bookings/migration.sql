-- Services and bookings for event/service-based businesses
CREATE TABLE IF NOT EXISTS "Service" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pricePerGuest" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minGuests" INTEGER,
  "includes" JSONB,
  "zones" JSONB,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Service_tenantId_isActive_priority_idx" ON "Service"("tenantId", "isActive", "priority");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Service_tenantId_fkey') THEN
    ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Booking" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT,
  "name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "guests" INTEGER NOT NULL,
  "location" TEXT,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Booking_tenantId_status_idx" ON "Booking"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Booking_tenantId_date_idx" ON "Booking"("tenantId", "date");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_tenantId_fkey') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_conversationId_fkey') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
