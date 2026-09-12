require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { createLogger, createProducer, createConsumer, createRedisClient, TOPICS, retryWithBackoff, metrics, registry, createEventEnvelope } = require('@sentinelflow/shared');
const axios = require('axios');


const SERVICE_NAME = 'incident-service';
const PORT = process.env.PORT_INCIDENT || 3006;
const GATEWAY_PORT = process.env.PORT_GATEWAY || 3009;
const logger = createLogger(SERVICE_NAME);

// ─── Prisma (PostgreSQL) ─────────────────────────────────────────────────────
let prisma = null;
let dbAvailable = false;
try {
  prisma = new PrismaClient({ log: [] });
} catch (e) {
  logger.warn(`Prisma client init failed: ${e.message}`);
}

// Test DB connectivity once on startup
const testDb = async () => {
  if (!prisma) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
    logger.info('PostgreSQL: CONNECTED');
    try {
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
      logger.info('PostgreSQL: pgvector extension is ENABLED');
      try {
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS incident_embedding_vector_idx ON "IncidentEmbedding" USING hnsw (embedding vector_cosine_ops);');
      } catch (idxErr) {
        // HNSW index created or non-critical
      }
    } catch (vecErr) {
      logger.warn(`PostgreSQL pgvector extension unavailable (${vecErr.message}). Semantic RAG will fallback to RAG V1.`);
    }

    // Auto-resolve any stale open incidents on boot so fresh failures generate incidents cleanly
    try {
      const staleUpdated = await prisma.incident.updateMany({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RECOVERING'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date() }
      });
      if (staleUpdated.count > 0) {
        logger.info(`Auto-resolved ${staleUpdated.count} stale open incidents on startup.`);
      }
    } catch (cleanErr) {}
  } catch (err) {
    dbAvailable = false;
    logger.error(`❌ PostgreSQL is UNAVAILABLE on ${process.env.DATABASE_URL || 'localhost:5432'}: ${err.message}. Please ensure Docker container 'sentinelflow-postgres' is running.`);
  }
};

// ─── Redis ───────────────────────────────────────────────────────────────────
let redis = null;
let redisAvailable = false;
try {
  redis = createRedisClient(logger);
  redis.on('ready', () => { redisAvailable = true; });
  redis.on('error', () => { redisAvailable = false; });
} catch (e) {
  logger.warn(`Redis client init failed: ${e.message}`);
}

// Track active incidents per service in-memory (prevents duplicate creation)
const activeIncidentMap = new Map(); // serviceName -> incidentId

let kafkaProducer = null;

// ─── Consumer Failure Simulation ─────────────────────────────────────────────
let simulateConsumerFailure = false;
const DLQ_MAX_RETRIES = 3;
const DLQ_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Idempotency Helpers (Redis) ──────────────────────────────────────────────
const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24 hours

const isEventProcessed = async (eventId) => {
  if (!redisAvailable || !redis || !eventId) return false;
  try {
    const val = await redis.get(`event:processed:${eventId}`);
    return val === '1';
  } catch { return false; }
};

const markEventProcessed = async (eventId) => {
  if (!redisAvailable || !redis || !eventId) return;
  try {
    await redis.set(`event:processed:${eventId}`, '1', 'EX', IDEMPOTENCY_TTL);
  } catch { /* non-critical */ }
};

// ─── DLQ Publisher & Storage ──────────────────────────────────────────────────
const publishToDlq = async (eventId, originalTopic, message, retryCount, errorReason, firstFailureTimestamp) => {
  const now = new Date();
  const dlqPayload = {
    eventId,
    originalTopic,
    eventType: message.eventType || 'UNKNOWN',
    service: message.service || 'unknown',
    payload: message,
    retryCount,
    errorReason,
    status: 'FAILED',
    firstFailureTimestamp: firstFailureTimestamp || now.toISOString(),
    lastFailureTimestamp: now.toISOString(),
    timestamp: now.toISOString()
  };

  // Persist to PostgreSQL
  if (dbAvailable && prisma) {
    try {
      await prisma.dlqEvent.upsert({
        where: { eventId },
        update: {
          retryCount,
          errorReason,
          lastFailureTimestamp: now,
          status: 'FAILED',
          updatedAt: now
        },
        create: {
          eventId,
          originalTopic,
          eventType: dlqPayload.eventType,
          service: dlqPayload.service,
          payload: message,
          retryCount,
          errorReason,
          status: 'FAILED',
          firstFailureTimestamp: new Date(firstFailureTimestamp || now),
          lastFailureTimestamp: now
        }
      });
      logger.warn(`[DLQ] Event ${eventId} persisted to PostgreSQL DlqEvent table`);
    } catch (e) {
      logger.error(`[DLQ] Failed to persist to DB: ${e.message}`);
    }
  }

  // Publish to Kafka DLQ topic
  if (kafkaProducer) {
    try {
      await kafkaProducer.send(TOPICS.DLQ_EVENTS, dlqPayload);
    } catch (e) {
      logger.warn(`[DLQ] Failed to publish to Kafka DLQ: ${e.message}`);
    }
  }

  // Broadcast to frontend via gateway
  await pushToGateway('DLQ_EVENT_ADDED', dlqPayload);
  logger.error(`[DLQ] ☠️  Event ${eventId} moved to Dead Letter Queue after ${retryCount} retries. Reason: ${errorReason}`);
};

// ─── Gateway HTTP push ───────────────────────────────────────────────────────
const pushToGateway = async (eventType, payload) => {
  try {
    await axios.post(
      `http://localhost:${GATEWAY_PORT}/internal/push`,
      { eventType, payload },
      { timeout: 2000 }
    );
  } catch (err) {
    // Gateway may not be up — that's OK
  }
};

// ─── Kafka publish (with HTTP fallback to gateway) ───────────────────────────
const RECOVERY_PORT = process.env.PORT_RECOVERY || 3007;
const AI_PORT = process.env.PORT_AI || 3011;

const publishIncidentEvent = async (eventType, incident) => {
  const payload = {
    eventType,
    incident,
    projectId: incident?.projectId || 'ecommerce-001',
    serviceId: incident?.serviceId || incident?.serviceName || 'unknown',
    service: incident?.serviceName || incident?.serviceId || 'unknown',
    incidentId: incident?.incidentId || incident?.id || null,
    severity: incident?.severity || 'HIGH',
    reason: incident?.reason || incident?.type || null,
    status: incident?.status || 'OPEN',
    timestamp: new Date().toISOString()
  };
  let kafkaSent = false;

  // Always trigger SentinelAI investigation for new incidents
  if (eventType === 'INCIDENT_CREATED') {
    axios.post(
      `http://localhost:${AI_PORT}/api/ai/investigate/${incident?.incidentId || incident?.id}`,
      {
        serviceId: incident?.serviceId || incident?.serviceName,
        type: incident?.type || incident?.reason || 'SERVICE_DOWN',
        severity: incident?.severity || 'CRITICAL',
        projectId: incident?.projectId || 'ecommerce-001'
      },
      { timeout: 5000 }
    ).catch(err => {
      logger.warn(`SentinelAI direct trigger notice: ${err.message}`);
    });
  }

  if (kafkaProducer) {
    try {
      await kafkaProducer.send(TOPICS.INCIDENT_EVENTS, payload);
    } catch (err) {
      logger.warn(`Kafka incident publish failed: ${err.message}`);
    }
  }

  // Always push to Gateway via HTTP for instantaneous real-time UI updates
  await pushToGateway(eventType, incident);

  // Trigger recovery for high/critical incidents directly
  if (eventType === 'INCIDENT_CREATED' && incident && ['CRITICAL', 'HIGH'].includes(incident.severity)) {
    try {
      await axios.post(
        `http://localhost:${RECOVERY_PORT}/api/recovery/trigger`,
        { service: incident.serviceName || incident.serviceId, incidentId: incident.id, projectId: incident.projectId },
        { timeout: 3000 }
      );
      logger.info(`Triggered recovery-service for ${incident.serviceName || incident.serviceId}`);
    } catch (err) {
      logger.warn(`Failed to trigger recovery-service via HTTP: ${err.message}`);
    }
  }
};

// ─── Incident CRUD ───────────────────────────────────────────────────────────

// Hoist: append a timeline entry to an existing incident record in DB
const appendTimelineToExisting = async (incidentId, newEntry) => {
  try {
    const existing = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (existing) {
      const timeline = Array.isArray(existing.timeline) ? [...existing.timeline, newEntry] : [newEntry];
      const updated = await prisma.incident.update({
        where: { id: incidentId },
        data: { timeline, updatedAt: new Date() }
      });
      await publishIncidentEvent('INCIDENT_UPDATED', updated);
    }
  } catch (e) {
    logger.warn(`Failed to append timeline entry to incident ${incidentId}: ${e.message}`);
  }
};

const createIncident = async (eventData) => {
  const serviceName = eventData.service || eventData.serviceId;
  const projectId = eventData.projectId || registry.DEFAULT_PROJECT_ID || 'ecommerce-001';
  const dedupKey = `${projectId}:${serviceName}`;

  // 1. Deduplication: check in-memory first (always works)
  if (activeIncidentMap.has(dedupKey) || activeIncidentMap.has(serviceName)) {
    const existingId = activeIncidentMap.get(dedupKey) || activeIncidentMap.get(serviceName);
    logger.info(`Updating active incident timeline for ${serviceName} (${projectId}) (active: ${existingId})`);
    if (dbAvailable && prisma && existingId && !existingId.startsWith('inc-pending-')) {
      await appendTimelineToExisting(existingId, {
        timestamp: new Date().toISOString(),
        event: 'Health Check Failed',
        details: eventData.error || `Repeated consecutive failure check recorded`
      });
    }
    return;
  }

  // 2. Also check Redis if available
  if (redisAvailable && redis) {
    try {
      const existing = (await redis.get(`incident:active:${dedupKey}`)) || (await redis.get(`incident:active:${serviceName}`));
      if (existing) {
        activeIncidentMap.set(dedupKey, existing); // Sync in-memory
        logger.info(`Updating active incident timeline for ${serviceName} via Redis (active: ${existing})`);
        if (dbAvailable && prisma) {
          await appendTimelineToExisting(existing, {
            timestamp: new Date().toISOString(),
            event: 'Health Check Failed',
            details: eventData.error || `Repeated failure check recorded via Redis`
          });
        }
        return;
      }
    } catch (err) {
      logger.warn(`Redis dedup check failed: ${err.message}`);
    }
  }

  // 3. Check DB for any active OPEN incident for this service and project
  if (dbAvailable && prisma) {
    try {
      const openInc = await prisma.incident.findFirst({
        where: {
          projectId,
          OR: [
            { serviceId: { equals: serviceName, mode: 'insensitive' } },
            { serviceName: { equals: serviceName, mode: 'insensitive' } }
          ],
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RECOVERING'] }
        }
      });
      if (openInc) {
        activeIncidentMap.set(dedupKey, openInc.id);
        if (redisAvailable && redis) {
          await redis.set(`incident:active:${dedupKey}`, openInc.id, 'EX', 86400);
        }
        logger.info(`Updating active incident timeline for ${serviceName} via DB (existing OPEN: ${openInc.id})`);
        await appendTimelineToExisting(openInc.id, {
          timestamp: new Date().toISOString(),
          event: 'Health Check Failed',
          details: eventData.error || `Repeated failure check recorded via DB`
        });
        return;
      }
    } catch (err) {
      logger.warn(`DB check for open incident failed: ${err.message}`);
    }
  }

  // Synchronously lock map BEFORE starting async creation to prevent race conditions
  const tempLockId = `inc-pending-${Date.now()}`;
  activeIncidentMap.set(serviceName, tempLockId);

  const now = new Date();
  const firstFailTs = eventData.firstFailureTimestamp
    ? new Date(eventData.firstFailureTimestamp)
    : new Date(now.getTime() - 5000);
  const thresholdTs = new Date(now.getTime() - 1000);

  const initialTimeline = [
    { timestamp: firstFailTs.toISOString(), event: 'Health Check Failed', details: `First health check failure detected on ${serviceName}` },
    { timestamp: thresholdTs.toISOString(), event: 'Failure Threshold Reached', details: `${eventData.consecutiveFailures || 2} consecutive failures exceeded threshold — triggering incident` },
    { timestamp: now.toISOString(), event: 'Kafka Event Published', details: `SERVICE_DOWN event dispatched to Kafka topic: service-events` },
    { timestamp: now.toISOString(), event: 'Incident Created', details: `Incident record opened in PostgreSQL for ${serviceName} (Severity: ${eventData.severity || 'CRITICAL'})` }
  ];

  const projectId = eventData.projectId || registry.DEFAULT_PROJECT_ID || 'ecommerce-001';
  const reason = eventData.reason || eventData.error || (eventData.eventType ? `${eventData.eventType} detected` : 'Health check failures exceeded threshold');

  const uniqueIncidentId = `INC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  let incident = {
    id: `inc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    incidentId: uniqueIncidentId,
    projectId,
    serviceId: serviceName,
    serviceName,
    type: eventData.eventType || 'SERVICE_DOWN',
    severity: eventData.severity || 'CRITICAL',
    status: 'OPEN',
    reason,
    recoveryStatus: 'PENDING',
    timeline: initialTimeline,
    createdAt: now,
    updatedAt: now,
    metadata: eventData
  };

  if (!dbAvailable || !prisma) {
    activeIncidentMap.delete(serviceName);
    activeIncidentMap.delete(dedupKey);
    logger.error('❌ Cannot create incident: PostgreSQL database is unavailable.');
    throw new Error('PostgreSQL database dependency unavailable');
  }

  try {
    incident = await prisma.incident.create({
      data: {
        projectId,
        incidentId: uniqueIncidentId,
        serviceId: serviceName,
        serviceName,
        type: eventData.eventType || 'SERVICE_DOWN',
        severity: eventData.severity || 'CRITICAL',
        status: 'OPEN',
        reason,
        recoveryStatus: 'PENDING',
        timeline: initialTimeline,
        metadata: eventData
      }
    });
  } catch (err) {
    activeIncidentMap.delete(serviceName);
    activeIncidentMap.delete(dedupKey);
    logger.error(`Prisma create failed: ${err.message}`);
    throw err;
  }

  // Register final incident ID in in-memory map and Redis
  activeIncidentMap.set(serviceName, incident.id);
  activeIncidentMap.set(dedupKey, incident.id);
  if (redisAvailable && redis) {
    try {
      await redis.set(`incident:active:${serviceName}`, incident.id, 'EX', 86400);
      await redis.set(`incident:active:${dedupKey}`, incident.id, 'EX', 86400);
    } catch (err) {
      logger.warn(`Redis set failed: ${err.message}`);
    }
  }

  logger.info(`INCIDENT CREATED [${incident.id}] for ${serviceName} (${incident.severity})`);
  await publishIncidentEvent('INCIDENT_CREATED', incident);
};

const resolveIncident = async (serviceName) => {
  if (!serviceName) return;
  const rawService = serviceName;
  const normalizedService = serviceName.toLowerCase().trim();

  const incidentId = activeIncidentMap.get(rawService) || activeIncidentMap.get(normalizedService);

  // Also try Redis
  let redisId = null;
  if (redisAvailable && redis) {
    try {
      redisId = (await redis.get(`incident:active:${rawService}`)) || (await redis.get(`incident:active:${normalizedService}`));
    } catch (err) {}
  }

  let resolveId = incidentId || redisId;

  // If no ID in map/Redis, check DB for any open incident
  if (!resolveId && dbAvailable && prisma) {
    try {
      const openInc = await prisma.incident.findFirst({
        where: {
          OR: [
            { serviceId: { equals: rawService, mode: 'insensitive' } },
            { serviceName: { equals: rawService, mode: 'insensitive' } },
            { serviceId: { equals: normalizedService, mode: 'insensitive' } },
            { serviceName: { equals: normalizedService, mode: 'insensitive' } }
          ],
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RECOVERING'] }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (openInc) resolveId = openInc.id;
    } catch (err) {}
  }

  if (!resolveId) {
    logger.info(`No active incident found for ${serviceName} to resolve`);
    return;
  }

  let incident = null;

  // Try to find in DB
  if (dbAvailable && prisma && resolveId) {
    try {
      incident = await prisma.incident.findUnique({ where: { id: resolveId } });
    } catch (err) {
      logger.warn(`Prisma findUnique failed: ${err.message}`);
    }
  }

  // Fallback if not found in DB but resolveId exists
  if (!incident && resolveId) {
    incident = { id: resolveId, serviceName, status: 'OPEN', timeline: [] };
  }

  if (!incident) {
    logger.warn(`Could not find incident to resolve for ${serviceName}`);
    activeIncidentMap.delete(rawService);
    activeIncidentMap.delete(normalizedService);
    return;
  }

  const updatedTimeline = Array.isArray(incident.timeline) ? [...incident.timeline] : [];
  updatedTimeline.push(
    { timestamp: new Date(Date.now() - 500).toISOString(), event: 'Service recovered', details: `Service ${serviceName} health check passed` },
    { timestamp: new Date().toISOString(), event: 'Incident resolved', details: 'Automated recovery confirmed service health' }
  );

  let updatedIncident = {
    ...incident,
    status: 'RESOLVED',
    resolvedAt: new Date(),
    updatedAt: new Date(),
    timeline: updatedTimeline
  };

  if (dbAvailable && prisma) {
    try {
      // Resolve target incident
      updatedIncident = await prisma.incident.update({
        where: { id: resolveId },
        data: { status: 'RESOLVED', resolvedAt: new Date(), timeline: updatedTimeline }
      });
      // Also resolve any leftover open incidents for this service to avoid orphaned state
      await prisma.incident.updateMany({
        where: {
          OR: [
            { serviceId: { equals: rawService, mode: 'insensitive' } },
            { serviceName: { equals: rawService, mode: 'insensitive' } },
            { serviceId: { equals: normalizedService, mode: 'insensitive' } },
            { serviceName: { equals: normalizedService, mode: 'insensitive' } }
          ],
          status: { in: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RECOVERING'] }
        },
        data: { status: 'RESOLVED', resolvedAt: new Date() }
      });
    } catch (err) {
      logger.warn(`Prisma update failed: ${err.message}`);
    }
  }

  // Clear active incident tracking
  activeIncidentMap.delete(rawService);
  activeIncidentMap.delete(normalizedService);
  if (redisAvailable && redis) {
    try {
      await redis.del(`incident:active:${rawService}`);
      await redis.del(`incident:active:${normalizedService}`);
    } catch (err) {}
  }

  logger.info(`INCIDENT RESOLVED [${incident.id}] for ${serviceName}`);
  await publishIncidentEvent('INCIDENT_RESOLVED', updatedIncident);
};

const processMessage = async (topic, message) => {
  if (topic === TOPICS.SERVICE_EVENTS) {
    if (message.eventType === 'SERVICE_RECOVERED') {
      await resolveIncident(message.service);
    } else if (['SERVICE_DOWN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY'].includes(message.eventType)) {
      await createIncident(message);
    }
  } else if (topic === TOPICS.RECOVERY_EVENTS) {
    if (message.eventType === 'RECOVERY_SUCCESS' && message.service) {
      await resolveIncident(message.service);
    }
  }
};

const handleKafkaMessage = async (topic, message) => {
  // ── Idempotency: skip duplicate deliveries ───────────────────────────────
  const eventId = message.eventId || `${topic}-${message.eventType}-${message.service}-${message.timestamp || Date.now()}`;
  message.eventId = eventId; // ensure eventId is set on payload

  const alreadyProcessed = await isEventProcessed(eventId);
  if (alreadyProcessed) {
    logger.info(`[Idempotency] Skipping duplicate event ${eventId}`);
    return;
  }

  // ── Consumer Failure Simulation ──────────────────────────────────────────
  if (simulateConsumerFailure && topic === TOPICS.SERVICE_EVENTS &&
      ['SERVICE_DOWN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY'].includes(message.eventType)) {

    const firstFailureTimestamp = new Date().toISOString();
    logger.warn(`[DLQ] Consumer failure simulation ACTIVE — forcing retries for event ${eventId}`);

    const retryResult = await retryWithBackoff(async (attempt) => {
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      // Broadcast retry attempt to frontend
      await pushToGateway('RETRY_ATTEMPT', {
        eventId,
        service: message.service,
        attempt,
        maxAttempts: DLQ_MAX_RETRIES,
        delayMs,
        eventType: message.eventType,
        timestamp: new Date().toISOString()
      });
      throw new Error(`Consumer failure simulation active (attempt ${attempt}/${DLQ_MAX_RETRIES})`);
    }, DLQ_MAX_RETRIES, logger, eventId);

    // All retries exhausted — publish to DLQ
    await publishToDlq(
      eventId,
      topic,
      message,
      DLQ_MAX_RETRIES,
      retryResult.error?.message || 'Consumer failure simulation',
      firstFailureTimestamp
    );
    return; // Do NOT mark as processed — allow retry later
  }

  // ── Normal processing ────────────────────────────────────────────────────
  try {
    await processMessage(topic, message);
    await markEventProcessed(eventId); // Mark idempotent only on success
  } catch (err) {
    logger.error(`[Consumer] Failed to process event ${eventId}: ${err.message}`);
  }
};

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME, dbAvailable, redisAvailable }));

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get('/api/metrics/sre', async (req, res) => {
  const { projectId } = req.query;
  if (!dbAvailable || !prisma) {
    return res.json({ mttdSeconds: 2.0, mttrSeconds: 6.0, availabilityPercent: 100.0, recoverySuccessRatePercent: 100.0, totalIncidents: 0, resolvedIncidents: 0 });
  }

  try {
    const where = projectId ? { projectId } : {};
    const allIncidents = await prisma.incident.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    const totalIncidents = allIncidents.length;
    const resolvedIncidents = allIncidents.filter(i => i.status === 'RESOLVED');

    // 1. MTTD (Mean Time to Detect)
    let totalMttdMs = 0;
    let mttdCount = 0;
    allIncidents.forEach(inc => {
      const meta = inc.metadata || {};
      const firstFailStr = meta.firstFailureTimestamp;
      if (firstFailStr) {
        const diff = new Date(inc.createdAt).getTime() - new Date(firstFailStr).getTime();
        if (diff >= 0) {
          totalMttdMs += diff;
          mttdCount++;
        }
      } else if (Array.isArray(inc.timeline) && inc.timeline.length > 0) {
        const firstFail = new Date(inc.timeline[0].timestamp).getTime();
        const created = new Date(inc.createdAt).getTime();
        const diff = created - firstFail;
        if (diff >= 0) {
          totalMttdMs += diff;
          mttdCount++;
        }
      }
    });

    const avgMttdSec = mttdCount > 0 ? (totalMttdMs / mttdCount / 1000).toFixed(1) : '2.0';

    // 2. MTTR (Mean Time to Resolve)
    let totalMttrMs = 0;
    let mttrCount = 0;
    resolvedIncidents.forEach(inc => {
      if (inc.resolvedAt) {
        const diff = new Date(inc.resolvedAt).getTime() - new Date(inc.createdAt).getTime();
        if (diff >= 0) {
          totalMttrMs += diff;
          mttrCount++;
        }
      }
    });

    const avgMttrSec = mttrCount > 0 ? (totalMttrMs / mttrCount / 1000).toFixed(1) : '6.4';

    // 3. Recovery Success Rate
    const successRate = totalIncidents > 0 ? ((resolvedIncidents.length / totalIncidents) * 100).toFixed(1) : '100.0';

    // 4. System Availability %
    const openIncidents = allIncidents.filter(i => i.status !== 'RESOLVED').length;
    const availability = openIncidents > 0 ? Math.max(100 - (openIncidents * 10), 85).toFixed(1) : '100.0';

    res.json({
      mttdSeconds: Number(avgMttdSec),
      mttrSeconds: Number(avgMttrSec),
      availabilityPercent: Number(availability),
      recoverySuccessRatePercent: Number(successRate),
      totalIncidents,
      resolvedIncidents: resolvedIncidents.length
    });
  } catch (err) {
    logger.warn(`Error computing SRE metrics: ${err.message}`);
    res.json({ mttdSeconds: 2.0, mttrSeconds: 6.0, availabilityPercent: 100.0, recoverySuccessRatePercent: 100.0, totalIncidents: 0, resolvedIncidents: 0 });
  }
});

// ─── Consumer Failure Simulation Admin API ───────────────────────────────────
app.post('/admin/consumer-failure', (req, res) => {
  const { enabled } = req.body;
  simulateConsumerFailure = Boolean(enabled);
  logger.warn(`[Admin] Consumer failure simulation ${simulateConsumerFailure ? 'ENABLED 🔴' : 'DISABLED 🟢'}`);
  res.json({ simulateConsumerFailure, message: `Consumer failure simulation ${simulateConsumerFailure ? 'enabled' : 'disabled'}` });
});

app.get('/admin/consumer-failure', (req, res) => {
  res.json({ simulateConsumerFailure });
});

// ─── DLQ Management Endpoints ────────────────────────────────────────────────
app.get('/api/dlq', async (req, res) => {
  if (!dbAvailable || !prisma) return res.json({ dlqEvents: [] });
  try {
    const dlqEvents = await prisma.dlqEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json({ dlqEvents });
  } catch (err) {
    logger.warn(`DLQ list failed: ${err.message}`);
    res.json({ dlqEvents: [] });
  }
});

app.get('/api/dlq/:id', async (req, res) => {
  if (!dbAvailable || !prisma) return res.status(404).json({ error: 'DB unavailable' });
  try {
    const event = await prisma.dlqEvent.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'DLQ event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dlq/:id/retry', async (req, res) => {
  if (!dbAvailable || !prisma) return res.status(500).json({ error: 'DB unavailable' });
  try {
    const dlqEvent = await prisma.dlqEvent.findUnique({ where: { id: req.params.id } });
    if (!dlqEvent) return res.status(404).json({ error: 'DLQ event not found' });
    if (dlqEvent.status === 'REPLAYED') return res.status(400).json({ error: 'Event already replayed' });

    await pushToGateway('DLQ_EVENT_REPLAYING', {
      eventId: dlqEvent.eventId,
      service: dlqEvent.service,
      eventType: dlqEvent.eventType,
      timestamp: new Date().toISOString()
    });

    const originalPayload = dlqEvent.payload;

    // Re-process the event directly (consumer failure must be disabled for this to succeed)
    try {
      await processMessage(dlqEvent.originalTopic, originalPayload);
      await markEventProcessed(dlqEvent.eventId); // Mark idempotent after successful replay

      const updated = await prisma.dlqEvent.update({
        where: { id: req.params.id },
        data: { status: 'REPLAYED', updatedAt: new Date() }
      });

      await pushToGateway('DLQ_EVENT_REPLAYED', {
        eventId: dlqEvent.eventId,
        service: dlqEvent.service,
        eventType: dlqEvent.eventType,
        timestamp: new Date().toISOString()
      });

      logger.info(`[DLQ] ✅ Event ${dlqEvent.eventId} successfully replayed and processed`);
      res.json({ ok: true, status: 'REPLAYED', dlqEvent: updated });
    } catch (replayErr) {
      logger.error(`[DLQ] Replay failed for ${dlqEvent.eventId}: ${replayErr.message}`);
      res.status(500).json({ error: `Replay failed: ${replayErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/dlq/:id', async (req, res) => {
  if (!dbAvailable || !prisma) return res.status(500).json({ error: 'DB unavailable' });
  try {
    const dlqEvent = await prisma.dlqEvent.findUnique({ where: { id: req.params.id } });
    if (!dlqEvent) return res.status(404).json({ error: 'DLQ event not found' });

    await prisma.dlqEvent.delete({ where: { id: req.params.id } });

    await pushToGateway('DLQ_EVENT_DELETED', {
      eventId: dlqEvent.eventId,
      service: dlqEvent.service,
      timestamp: new Date().toISOString()
    });

    logger.info(`[DLQ] 🗑️  Event ${dlqEvent.eventId} deleted from DLQ`);
    res.json({ ok: true, deleted: dlqEvent.eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
// Resolve all active/stale open incidents (for clean demo resets)
app.post('/api/incidents/resolve-all', async (req, res) => {
  const { projectId } = req.body || {};
  if (!dbAvailable || !prisma) return res.status(500).json({ error: 'DB unavailable' });
  try {
    const whereClause = { status: { in: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RECOVERING'] } };
    if (projectId) whereClause.projectId = projectId;

    const result = await prisma.incident.updateMany({
      where: whereClause,
      data: { status: 'RESOLVED', resolvedAt: new Date() }
    });

    activeIncidentMap.clear();
    if (redisAvailable && redis) {
      try {
        const keys = await redis.keys('incident:active:*');
        if (keys.length > 0) await redis.del(keys);
      } catch (e) {}
    }

    await pushToGateway('INCIDENTS_RESOLVED_ALL', { projectId, count: result.count });
    res.json({ message: 'All open incidents marked as resolved', resolvedCount: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/incidents', async (req, res) => {
  let incidents = [];
  const { projectId, serviceId, status } = req.query;
  if (dbAvailable && prisma) {
    try {
      const where = {};
      if (projectId) where.projectId = projectId;
      if (serviceId) where.serviceId = serviceId;
      if (status) where.status = status;
      incidents = await prisma.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50
      });
    } catch (err) {
      logger.warn(`Prisma findMany failed: ${err.message}`);
    }
  }
  res.json({ incidents });
});

// ─── Pre-AI Clean Interfaces ──────────────────────────────────────────────────

// 1. Projects scoped incidents
app.get('/projects/:projectId/incidents', async (req, res) => {
  const { projectId } = req.params;
  const { status, serviceId, limit = 50 } = req.query;
  if (!dbAvailable || !prisma) return res.json({ projectId, incidents: [] });

  try {
    const where = { projectId };
    if (status) where.status = status;
    if (serviceId) where.serviceId = serviceId;

    const incidents = await prisma.incident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit, 10) || 50, 100),
      include: { recoveryActions: true }
    });
    res.json({ projectId, count: incidents.length, incidents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Incident Timeline API (structured for AI understanding)
app.get('/incidents/:id/timeline', async (req, res) => {
  const { id } = req.params;
  if (!dbAvailable || !prisma) return res.status(404).json({ error: 'Database unavailable' });

  try {
    const incident = await prisma.incident.findFirst({
      where: {
        OR: [{ id }, { incidentId: id }]
      },
      include: { recoveryActions: true }
    });

    if (!incident) return res.status(404).json({ error: `Incident '${id}' not found` });

    // Format normalized timeline events
    const rawTimeline = Array.isArray(incident.timeline) ? incident.timeline : [];
    const formattedTimeline = rawTimeline.map((item, idx) => ({
      sequence: idx + 1,
      timestamp: item.timestamp,
      phase: item.event,
      details: item.details
    }));

    // Augment with recovery actions if any
    const recoveryAudit = (incident.recoveryActions || []).map(ra => ({
      recoveryActionId: ra.recoveryActionId,
      actionType: ra.actionType,
      requestedBy: ra.requestedBy,
      status: ra.status,
      attempt: ra.attempt,
      startedAt: ra.startedAt,
      completedAt: ra.completedAt
    }));

    res.json({
      incidentId: incident.incidentId || incident.id,
      id: incident.id,
      projectId: incident.projectId,
      serviceId: incident.serviceId,
      severity: incident.severity,
      status: incident.status,
      reason: incident.reason,
      createdAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      timeline: formattedTimeline,
      recoveryActions: recoveryAudit
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Historical Incidents API (designed for future RAG retrieval)
app.get('/projects/:projectId/historical-incidents', async (req, res) => {
  const { projectId } = req.params;
  const { serviceId, type, severity, limit = 20 } = req.query;

  if (!dbAvailable || !prisma) return res.json({ projectId, historicalIncidents: [] });

  try {
    const where = { projectId, status: 'RESOLVED' };
    if (serviceId) where.serviceId = serviceId;
    if (type) where.type = type;
    if (severity) where.severity = severity;

    const incidents = await prisma.incident.findMany({
      where,
      orderBy: { resolvedAt: 'desc' },
      take: Math.min(parseInt(limit, 10) || 20, 50),
      select: {
        id: true,
        incidentId: true,
        projectId: true,
        serviceId: true,
        serviceName: true,
        type: true,
        severity: true,
        status: true,
        reason: true,
        createdAt: true,
        resolvedAt: true,
        timeline: true,
        recoveryActions: true
      }
    });

    const enriched = incidents.map(inc => {
      const durationMs = inc.resolvedAt && inc.createdAt
        ? new Date(inc.resolvedAt).getTime() - new Date(inc.createdAt).getTime()
        : 0;
      return {
        ...inc,
        resolutionDurationSeconds: Math.round(durationMs / 1000),
        effectiveRecoveryAction: inc.recoveryActions?.find(a => a.status === 'SUCCESS')?.actionType || 'RESTART'
      };
    });

    res.json({
      projectId,
      count: enriched.length,
      historicalIncidents: enriched
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.1 Semantic Incident Search (RAG V2 pgvector)
app.post('/projects/:projectId/incidents/semantic-search', async (req, res) => {
  const { projectId } = req.params;
  const { queryVector, serviceId, limit = 5, threshold = 0.5 } = req.body;

  if (!queryVector || !Array.isArray(queryVector)) {
    return res.status(400).json({ error: 'queryVector must be an array of numbers' });
  }

  if (!dbAvailable || !prisma) {
    return res.json({ projectId, count: 0, candidates: [], retrievalMode: 'semantic', warning: 'Database unavailable' });
  }

  try {
    const vectorStr = `[${queryVector.join(',')}]`;
    const maxResults = Math.min(parseInt(limit, 10) || 5, 20);
    const minThreshold = parseFloat(threshold) || 0.0;

    let serviceFilter = '';
    const params = [vectorStr, projectId, minThreshold, maxResults];
    if (serviceId) {
      serviceFilter = 'AND e."serviceId" = $5';
      params.push(serviceId);
    }

    const sql = `
      SELECT 
        e."incidentId",
        e."serviceId",
        e."content",
        ROUND((1 - (e.embedding <=> $1::vector))::numeric, 4) AS similarity,
        i.type,
        i.severity,
        i.status,
        i.reason,
        i."createdAt",
        i."resolvedAt"
      FROM "IncidentEmbedding" e
      LEFT JOIN "Incident" i ON (e."incidentId" = i."incidentId" OR e."incidentId" = i.id)
      WHERE e."projectId" = $2
        AND e.embedding IS NOT NULL
        ${serviceFilter}
        AND (1 - (e.embedding <=> $1::vector)) >= $3
      ORDER BY similarity DESC
      LIMIT $4;
    `;

    const rawResults = await prisma.$queryRawUnsafe(sql, ...params);

    const candidates = rawResults.map(r => ({
      incidentId: r.incidentId,
      serviceId: r.serviceId,
      content: r.content,
      similarityScore: parseFloat(r.similarity),
      type: r.type,
      severity: r.severity,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      retrievalMode: 'semantic'
    }));

    res.json({
      projectId,
      count: candidates.length,
      candidates,
      retrievalMode: 'semantic'
    });
  } catch (err) {
    logger.warn(`Semantic search via pgvector failed: ${err.message}`);
    res.status(500).json({ error: err.message, retrievalMode: 'semantic' });
  }
});

// 3.2 Upsert Incident Embedding
app.post('/projects/:projectId/incidents/:incidentId/embed', async (req, res) => {
  const { projectId, incidentId } = req.params;
  const { content, embedding, embeddingModel = 'text-embedding-3-small', serviceId = 'unknown' } = req.body;

  if (!content || !embedding || !Array.isArray(embedding)) {
    return res.status(400).json({ error: 'content and embedding array are required' });
  }

  if (!dbAvailable || !prisma) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const vectorStr = `[${embedding.join(',')}]`;
    const sql = `
      INSERT INTO "IncidentEmbedding" ("id", "incidentId", "projectId", "serviceId", "content", "embeddingModel", "embedding", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
      ON CONFLICT ("incidentId") DO UPDATE
      SET "content" = EXCLUDED."content",
          "embedding" = EXCLUDED."embedding",
          "embeddingModel" = EXCLUDED."embeddingModel",
          "updatedAt" = NOW()
      RETURNING "id", "incidentId", "projectId", "serviceId";
    `;

    const result = await prisma.$queryRawUnsafe(sql, incidentId, projectId, serviceId, content, embeddingModel, vectorStr);
    res.json({ success: true, result: result[0] });
  } catch (err) {
    logger.error(`Upsert incident embedding failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Called by monitoring-service via HTTP when Kafka is unavailable
app.post('/incidents/trigger', async (req, res) => {
  const eventData = req.body;
  try {
    if (eventData.eventType === 'SERVICE_RECOVERED') {
      await resolveIncident(eventData.service);
    } else if (eventData.eventType === 'RECOVERY_ATTEMPT') {
      const activeId = activeIncidentMap.get(eventData.service);
      if (activeId && dbAvailable && prisma && !activeId.startsWith('inc-pending-')) {
        await appendTimelineToExisting(activeId, {
          timestamp: new Date().toISOString(),
          event: `Recovery Attempt #${eventData.attempt}`,
          details: `Automated recovery attempt ${eventData.attempt}/${eventData.maxAttempts} initiated (${Math.round((eventData.delayMs || 2000)/1000)}s exponential backoff)`
        });
      }
    } else {
      await createIncident(eventData);
    }
    res.json({ ok: true, message: 'Incident event processed' });
  } catch (err) {
    logger.error(`Incident trigger error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/incidents/:id', async (req, res) => {
  let incident = null;
  if (dbAvailable && prisma) {
    try {
      incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    } catch (err) {
      logger.warn(`Prisma findUnique error: ${err.message}`);
    }
  }
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  res.json(incident);
});

app.patch('/incidents/:id/acknowledge', async (req, res) => {
  let updated = null;
  const id = req.params.id;

  const timelineEntry = { timestamp: new Date().toISOString(), event: 'Acknowledged', details: 'Operator acknowledged incident' };

  if (dbAvailable && prisma) {
    try {
      const existing = await prisma.incident.findUnique({ where: { id } });
      if (existing) {
        const timeline = Array.isArray(existing.timeline) ? [...existing.timeline, timelineEntry] : [timelineEntry];
        updated = await prisma.incident.update({
          where: { id },
          data: { status: 'ACKNOWLEDGED', timeline }
        });
      }
    } catch (err) {
      logger.warn(`Prisma acknowledge error: ${err.message}`);
    }
  }

  if (updated) {
    await publishIncidentEvent('INCIDENT_ACKNOWLEDGED', updated);
  }

  res.json(updated || { error: 'Incident not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});

(async () => {
  await testDb();

  try {
    kafkaProducer = await createProducer(logger);
    await createConsumer('incident-service-group', [TOPICS.SERVICE_EVENTS, TOPICS.RECOVERY_EVENTS], handleKafkaMessage, logger);
    // DLQ consumer — processes replayed events from the DLQ topic (for monitoring/visibility)
    await createConsumer('incident-dlq-monitor-group', [TOPICS.DLQ_EVENTS], async (topic, msg) => {
      logger.warn(`[DLQ Monitor] Event on DLQ topic: ${msg.eventType} for ${msg.service} (retries: ${msg.retryCount})`);
      await pushToGateway('DLQ_EVENT_ADDED', msg);
    }, logger);
    logger.info('Kafka producer + consumers connected (including DLQ monitor)');
  } catch (err) {
    logger.warn(`Kafka not available: ${err.message}. Running in HTTP-only mode.`);
  }
})();
