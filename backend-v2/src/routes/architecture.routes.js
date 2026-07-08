import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { MODULES } from "../lib/modules.js";
import { normalizeMetadata } from "../lib/metadata.js";
import { recordAuditLog } from "../lib/audit.js";
import { requireRole, ROLE_GROUPS } from "../middleware/tenant-access.js";
import { getTenantModules } from "../services/tenant-modules.service.js";

export const architectureRouter = Router();

const INTEGRATION_PROVIDERS = [
  { channel: "gmail", label: "Gmail / Google Workspace", module: MODULES.GMAIL },
  { channel: "email_imap", label: "Correo IMAP / SMTP", module: MODULES.EMAIL_IMAP },
  { channel: "google_drive", label: "Google Drive", module: MODULES.GOOGLE_DRIVE },
  { channel: "sharepoint", label: "SharePoint / OneDrive", module: MODULES.SHAREPOINT }
];

const BACKUP_PROVIDERS = ["azure_backup", "aws_backup", "backblaze_b2", "wasabi", "custom"];

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanChannel(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "_");
}

function publicChannelConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    channel: config.channel,
    label: config.label,
    externalAccountId: config.externalAccountId,
    businessAccountId: config.businessAccountId,
    metadata: config.metadata || {},
    isActive: config.isActive,
    hasAccessToken: Boolean(config.accessToken),
    hasVerifyToken: Boolean(config.verifyToken),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function publicRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    type: record.recordType,
    title: record.title,
    status: record.status,
    data: record.data || {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function findSingleton(tenantId, recordType, title) {
  return prisma.industryRecord.findFirst({
    where: { tenantId, recordType, title },
    orderBy: { updatedAt: "desc" }
  });
}

async function upsertSingleton({ tenantId, recordType, title, status = "ACTIVE", data = {} }) {
  const existing = await findSingleton(tenantId, recordType, title);
  if (existing) {
    return prisma.industryRecord.update({
      where: { id: existing.id },
      data: {
        status,
        data: normalizeMetadata({ ...(existing.data || {}), ...data }, {})
      }
    });
  }

  return prisma.industryRecord.create({
    data: {
      tenantId,
      recordType,
      title,
      status,
      data: normalizeMetadata(data, {})
    }
  });
}

async function tenantCounts(tenantId) {
  const [
    users,
    contacts,
    conversations,
    messages,
    leads,
    bookings,
    payments,
    campaigns,
    records,
    auditLogs
  ] = await Promise.all([
    prisma.workspaceUser.count({ where: { tenantId } }),
    prisma.contact.count({ where: { tenantId } }),
    prisma.conversation.count({ where: { tenantId } }),
    prisma.message.count({ where: { tenantId } }),
    prisma.lead.count({ where: { tenantId } }),
    prisma.booking.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.campaign.count({ where: { tenantId } }),
    prisma.industryRecord.count({ where: { tenantId } }),
    prisma.tenantAuditLog.count({ where: { tenantId } })
  ]);

  return { users, contacts, conversations, messages, leads, bookings, payments, campaigns, records, auditLogs };
}

architectureRouter.get("/architecture/summary", async (req, res) => {
  try {
    const [modules, channelConfigs, backupConfig, replicaConfig, offlinePending, offlineFailed, auditCount, counts] = await Promise.all([
      getTenantModules(req.tenantId),
      prisma.tenantChannelConfig.findMany({ where: { tenantId: req.tenantId } }),
      findSingleton(req.tenantId, "backup_config", "tenant_backup_policy"),
      findSingleton(req.tenantId, "replica_config", "tenant_replica_policy"),
      prisma.industryRecord.count({ where: { tenantId: req.tenantId, recordType: "offline_mutation", status: "PENDING" } }),
      prisma.industryRecord.count({ where: { tenantId: req.tenantId, recordType: "offline_mutation", status: "FAILED" } }),
      prisma.tenantAuditLog.count({ where: { tenantId: req.tenantId } }),
      tenantCounts(req.tenantId)
    ]);

    const moduleSet = new Set(modules);
    const configuredChannels = new Set(channelConfigs.filter((item) => item.isActive).map((item) => item.channel));
    const integrations = INTEGRATION_PROVIDERS.map((provider) => ({
      ...provider,
      enabled: moduleSet.has(provider.module),
      configured: configuredChannels.has(provider.channel),
      config: publicChannelConfig(channelConfigs.find((item) => item.channel === provider.channel))
    }));

    res.json({
      tenantId: req.tenantId,
      generatedAt: new Date().toISOString(),
      principles: {
        metadataDriven: true,
        immutableCore: true,
        tenantScoped: true,
        audited: auditCount > 0
      },
      layers: {
        experience: {
          status: "partial",
          modules,
          note: "Web y app comparten API; las vistas verticales dependen de modulos habilitados por tenant."
        },
        businessCapabilities: {
          status: "active",
          modules
        },
        core: {
          metadataEngine: "active",
          workflowEngine: moduleSet.has(MODULES.WORKFLOWS) ? "enabled" : "disabled",
          documentEngine: moduleSet.has(MODULES.DOCUMENTS) ? "enabled" : "disabled",
          aiEngine: "active",
          securityIdentity: "jwt_roles_permissions",
          auditLogging: "active"
        }
      },
      integrations,
      continuity: {
        backup: {
          enabled: moduleSet.has(MODULES.BACKUP_PROVIDER),
          configured: Boolean(backupConfig),
          config: publicRecord(backupConfig)
        },
        replica: {
          enabled: moduleSet.has(MODULES.SECURITY_REPLICA),
          configured: Boolean(replicaConfig),
          config: publicRecord(replicaConfig)
        },
        offlineSync: {
          enabled: moduleSet.has(MODULES.OFFLINE_SYNC),
          pending: offlinePending,
          failed: offlineFailed
        }
      },
      counts
    });
  } catch (error) {
    console.error("Architecture summary error:", error);
    res.status(500).json({ error: "No se pudo cargar la arquitectura del tenant" });
  }
});

architectureRouter.get("/architecture/integrations", async (req, res) => {
  try {
    const configs = await prisma.tenantChannelConfig.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ channel: "asc" }, { updatedAt: "desc" }]
    });

    res.json({
      providers: INTEGRATION_PROVIDERS,
      integrations: configs.map(publicChannelConfig)
    });
  } catch (error) {
    console.error("Architecture integrations error:", error);
    res.status(500).json({ error: "No se pudieron cargar integraciones de arquitectura" });
  }
});

architectureRouter.put("/architecture/integrations/:channel", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const channel = cleanChannel(req.params.channel);
    const supported = INTEGRATION_PROVIDERS.some((item) => item.channel === channel);
    if (!supported) return res.status(400).json({ error: "Proveedor de integracion no soportado" });

    const previous = await prisma.tenantChannelConfig.findUnique({
      where: { tenantId_channel: { tenantId: req.tenantId, channel } }
    });

    const config = await prisma.tenantChannelConfig.upsert({
      where: { tenantId_channel: { tenantId: req.tenantId, channel } },
      update: {
        label: cleanText(req.body?.label, previous?.label || channel),
        externalAccountId: cleanText(req.body?.externalAccountId, previous?.externalAccountId || "") || null,
        businessAccountId: cleanText(req.body?.businessAccountId, previous?.businessAccountId || "") || null,
        accessToken: req.body?.accessToken === undefined ? previous?.accessToken || null : cleanText(req.body.accessToken) || null,
        verifyToken: req.body?.verifyToken === undefined ? previous?.verifyToken || null : cleanText(req.body.verifyToken) || null,
        metadata: normalizeMetadata({ ...(previous?.metadata || {}), ...(req.body?.metadata || {}) }, {}),
        isActive: req.body?.isActive === undefined ? previous?.isActive ?? true : Boolean(req.body.isActive)
      },
      create: {
        tenantId: req.tenantId,
        channel,
        label: cleanText(req.body?.label, channel),
        externalAccountId: cleanText(req.body?.externalAccountId) || null,
        businessAccountId: cleanText(req.body?.businessAccountId) || null,
        accessToken: cleanText(req.body?.accessToken) || null,
        verifyToken: cleanText(req.body?.verifyToken) || null,
        metadata: normalizeMetadata(req.body?.metadata, {}),
        isActive: req.body?.isActive === undefined ? true : Boolean(req.body.isActive)
      }
    });

    await recordAuditLog(req, "ARCHITECTURE_INTEGRATION_CONFIGURED", "integration", config.id, {
      channel,
      isActive: config.isActive
    });

    res.json({ integration: publicChannelConfig(config) });
  } catch (error) {
    console.error("Architecture integration configure error:", error);
    res.status(500).json({ error: "No se pudo configurar el proveedor" });
  }
});

architectureRouter.get("/architecture/backups/config", async (req, res) => {
  try {
    const [backup, replica] = await Promise.all([
      findSingleton(req.tenantId, "backup_config", "tenant_backup_policy"),
      findSingleton(req.tenantId, "replica_config", "tenant_replica_policy")
    ]);

    res.json({
      providers: BACKUP_PROVIDERS,
      backup: publicRecord(backup),
      replica: publicRecord(replica)
    });
  } catch (error) {
    console.error("Backup config read error:", error);
    res.status(500).json({ error: "No se pudo cargar configuracion de respaldo" });
  }
});

architectureRouter.put("/architecture/backups/config", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const provider = cleanChannel(req.body?.provider || "custom");
    if (!BACKUP_PROVIDERS.includes(provider)) return res.status(400).json({ error: "Proveedor de respaldo no soportado" });

    const backup = await upsertSingleton({
      tenantId: req.tenantId,
      recordType: "backup_config",
      title: "tenant_backup_policy",
      data: {
        provider,
        schedule: cleanText(req.body?.schedule, "daily"),
        retentionDays: Number(req.body?.retentionDays || 30),
        encryptedAtRest: req.body?.encryptedAtRest === undefined ? true : Boolean(req.body.encryptedAtRest),
        encryptedInTransit: req.body?.encryptedInTransit === undefined ? true : Boolean(req.body.encryptedInTransit),
        bucketOrVault: cleanText(req.body?.bucketOrVault),
        region: cleanText(req.body?.region),
        lastConfiguredAt: new Date().toISOString()
      }
    });

    const replica = await upsertSingleton({
      tenantId: req.tenantId,
      recordType: "replica_config",
      title: "tenant_replica_policy",
      data: {
        provider: cleanChannel(req.body?.replicaProvider || provider),
        mode: cleanText(req.body?.replicaMode, "warm_standby"),
        recoveryPointObjectiveMinutes: Number(req.body?.rpoMinutes || 60),
        recoveryTimeObjectiveMinutes: Number(req.body?.rtoMinutes || 240),
        monitoringEnabled: req.body?.monitoringEnabled === undefined ? true : Boolean(req.body.monitoringEnabled),
        lastConfiguredAt: new Date().toISOString()
      }
    });

    await recordAuditLog(req, "BACKUP_POLICY_CONFIGURED", "backup_config", backup.id, {
      provider,
      replicaId: replica.id
    });

    res.json({ backup: publicRecord(backup), replica: publicRecord(replica) });
  } catch (error) {
    console.error("Backup config save error:", error);
    res.status(500).json({ error: "No se pudo guardar configuracion de respaldo" });
  }
});

architectureRouter.get("/architecture/backups/snapshots", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const snapshots = await prisma.industryRecord.findMany({
      where: { tenantId: req.tenantId, recordType: "backup_snapshot" },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit || 20), 100)
    });
    res.json({ snapshots: snapshots.map(publicRecord) });
  } catch (error) {
    console.error("Backup snapshots error:", error);
    res.status(500).json({ error: "No se pudieron cargar snapshots" });
  }
});

architectureRouter.post("/architecture/backups/snapshots", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const counts = await tenantCounts(req.tenantId);
    const config = await findSingleton(req.tenantId, "backup_config", "tenant_backup_policy");
    const snapshotId = randomUUID();

    const snapshot = await prisma.industryRecord.create({
      data: {
        tenantId: req.tenantId,
        recordType: "backup_snapshot",
        title: `snapshot-${snapshotId}`,
        status: "COMPLETED",
        data: normalizeMetadata({
          snapshotId,
          provider: config?.data?.provider || "manual_export",
          counts,
          exportEndpoint: "/api/backups/export",
          encryptedAtRest: config?.data?.encryptedAtRest ?? true,
          generatedAt: new Date().toISOString()
        }, {})
      }
    });

    await recordAuditLog(req, "BACKUP_SNAPSHOT_CREATED", "backup_snapshot", snapshot.id, {
      snapshotId,
      counts
    });

    res.status(201).json({ snapshot: publicRecord(snapshot) });
  } catch (error) {
    console.error("Backup snapshot create error:", error);
    res.status(500).json({ error: "No se pudo crear snapshot" });
  }
});

architectureRouter.get("/architecture/offline/mutations", async (req, res) => {
  try {
    const status = req.query.status ? cleanText(req.query.status).toUpperCase() : null;
    const mutations = await prisma.industryRecord.findMany({
      where: {
        tenantId: req.tenantId,
        recordType: "offline_mutation",
        ...(status ? { status } : {})
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit || 100), 300)
    });
    res.json({ mutations: mutations.map(publicRecord) });
  } catch (error) {
    console.error("Offline mutations error:", error);
    res.status(500).json({ error: "No se pudo cargar cola offline" });
  }
});

architectureRouter.post("/architecture/offline/sync", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.mutations) ? req.body.mutations : [];
    if (!incoming.length) return res.json({ accepted: 0, mutations: [] });

    const results = [];
    for (const item of incoming.slice(0, 200)) {
      const mutationId = cleanText(item?.mutationId || item?.id, randomUUID());
      const operation = cleanText(item?.operation || item?.op, "upsert").toLowerCase();
      const entity = cleanText(item?.entity || item?.recordType, "metadata").toLowerCase();
      const hasPayload = item?.payload !== undefined || item?.data !== undefined;
      const status = hasPayload ? "PENDING" : "FAILED";

      const existing = await prisma.industryRecord.findFirst({
        where: { tenantId: req.tenantId, recordType: "offline_mutation", title: mutationId }
      });

      const data = normalizeMetadata({
        mutationId,
        entity,
        operation,
        payload: item?.payload ?? item?.data ?? null,
        clientTimestamp: item?.clientTimestamp || item?.createdAt || null,
        receivedAt: new Date().toISOString(),
        error: hasPayload ? null : "Payload requerido para sincronizar"
      }, {});

      const record = existing
        ? await prisma.industryRecord.update({ where: { id: existing.id }, data: { status, data } })
        : await prisma.industryRecord.create({
            data: { tenantId: req.tenantId, recordType: "offline_mutation", title: mutationId, status, data }
          });

      results.push(publicRecord(record));
    }

    await recordAuditLog(req, "OFFLINE_SYNC_RECEIVED", "offline_mutation", null, {
      count: results.length,
      pending: results.filter((item) => item.status === "PENDING").length,
      failed: results.filter((item) => item.status === "FAILED").length
    });

    res.status(202).json({ accepted: results.length, mutations: results });
  } catch (error) {
    console.error("Offline sync error:", error);
    res.status(500).json({ error: "No se pudo sincronizar cola offline" });
  }
});

architectureRouter.patch("/architecture/offline/mutations/:id/status", requireRole(ROLE_GROUPS.MANAGERS), async (req, res) => {
  try {
    const current = await prisma.industryRecord.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, recordType: "offline_mutation" }
    });
    if (!current) return res.status(404).json({ error: "Mutacion offline no encontrada" });

    const status = cleanText(req.body?.status, current.status).toUpperCase();
    const mutation = await prisma.industryRecord.update({
      where: { id: current.id },
      data: {
        status,
        data: normalizeMetadata({
          ...(current.data || {}),
          statusReason: cleanText(req.body?.reason),
          resolvedAt: ["APPLIED", "FAILED", "CONFLICT"].includes(status) ? new Date().toISOString() : null
        }, {})
      }
    });

    await recordAuditLog(req, "OFFLINE_MUTATION_STATUS_UPDATED", "offline_mutation", mutation.id, { status });
    res.json({ mutation: publicRecord(mutation) });
  } catch (error) {
    console.error("Offline mutation status error:", error);
    res.status(500).json({ error: "No se pudo actualizar mutacion offline" });
  }
});
