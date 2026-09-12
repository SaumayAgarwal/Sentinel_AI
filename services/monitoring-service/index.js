require('dotenv').config({ path: '../../.env' });
const express = require('express');
const axios = require('axios');
const { createLogger, createProducer, TOPICS, initTopics, metrics, registry } = require('@sentinelflow/shared');

const SERVICE_NAME = 'monitoring-service';
const PORT = process.env.PORT_MONITORING || 3005;
const INCIDENT_PORT = process.env.PORT_INCIDENT || 3006;
const GATEWAY_PORT = process.env.PORT_GATEWAY || 3009;
const DEFAULT_PROJECT_ID = registry.DEFAULT_PROJECT_ID || 'ecommerce-001';
const logger = createLogger(SERVICE_NAME);

// Pull monitored services dynamically across ALL registered projects
const allProjects = registry.getProjects();
const registeredServices = allProjects.flatMap(p => registry.getServices(p.id));
const TARGET_SERVICES = registeredServices.map(s => ({
  projectId: s.projectId,
  serviceId: s.serviceId,
  name: s.serviceId,
  url: s.healthUrl,
  metricsUrl: s.metricsUrl,
  dependencies: s.dependencies || []
}));

const FAILURE_THRESHOLD = 2;
const RECOVERY_THRESHOLD = 2;
const POLL_INTERVAL_MS = 2000;

// Helper to get compound or simple status key
const getStatusKey = (projectId, serviceId) => `${projectId || DEFAULT_PROJECT_ID}:${serviceId}`;

// Service status tracking map (compound keyed for isolation, plus alias keyed)
const serviceStatuses = {};
TARGET_SERVICES.forEach(s => {
  const initialRecord = {
    projectId: s.projectId,
    serviceId: s.serviceId,
    name: s.serviceId,
    url: s.url,
    metricsUrl: s.metricsUrl,
    status: 'HEALTHY',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastLatencyMs: 0,
    lastCheckTime: null,
    failureType: null,
    dependencies: s.dependencies
  };
  serviceStatuses[getStatusKey(s.projectId, s.serviceId)] = initialRecord;
  // Also preserve top-level serviceId key for backwards compatibility
  if (!serviceStatuses[s.serviceId] || s.projectId === DEFAULT_PROJECT_ID) {
    serviceStatuses[s.serviceId] = initialRecord;
  }
});

const getServiceState = (projectId, serviceId) => {
  return serviceStatuses[getStatusKey(projectId, serviceId)] || serviceStatuses[serviceId] || null;
};

let kafkaProducer = null;

// Push to gateway directly (HTTP) — always called so the UI always gets events
const pushToGateway = async (eventType, payload) => {
  try {
    await axios.post(
      `http://localhost:${GATEWAY_PORT}/internal/push`,
      { eventType, payload },
      { timeout: 2000 }
    );
  } catch (err) {
    // Gateway may not be up yet, that's OK
  }
};

const dispatchServiceEvent = async (eventData) => {
  let kafkaSent = false;

  const payload = {
    projectId: eventData.projectId || DEFAULT_PROJECT_ID,
    serviceId: eventData.serviceId || eventData.service,
    service: eventData.service || eventData.serviceId,
    ...eventData
  };

  if (kafkaProducer) {
    try {
      await kafkaProducer.send(TOPICS.SERVICE_EVENTS, payload);
      kafkaSent = true;
      logger.info(`Published to Kafka: ${payload.eventType} for ${payload.serviceId}`);
    } catch (err) {
      logger.warn(`Kafka send failed: ${err.message}. Using HTTP fallback.`);
    }
  }

  // Only call incident service via HTTP if Kafka send failed
  if (!kafkaSent) {
    try {
      await axios.post(
        `http://localhost:${INCIDENT_PORT}/incidents/trigger`,
        payload,
        { timeout: 3000 }
      );
    } catch (err) {
      logger.warn(`Incident service HTTP call failed: ${err.message}`);
    }
  }

  // Always push raw service event to gateway for the UI service status indicators
  await pushToGateway(payload.eventType, payload);
};

const checkServiceHealth = async (target) => {
  const state = getServiceState(target.projectId, target.serviceId);
  if (!state) return;

  const startTime = Date.now();
  let success = false;
  let errorMsg = null;
  let latencyMs = 0;

  try {
    const res = await axios.get(target.url, { timeout: 4000 });
    latencyMs = Date.now() - startTime;

    if (res.status === 200) {
      if (latencyMs > 2000) {
        success = false;
        errorMsg = `High latency detected: ${latencyMs}ms`;
        state.failureType = 'HIGH_LATENCY';
      } else {
        success = true;
        state.failureType = null;
      }
    } else {
      success = false;
      errorMsg = `Non-200 status: ${res.status}`;
      state.failureType = 'SERVICE_DOWN';
    }
  } catch (err) {
    latencyMs = Date.now() - startTime;
    success = false;
    errorMsg = err.message;
    if (err.response && err.response.status >= 500) {
      state.failureType = 'HIGH_ERROR_RATE';
    } else {
      state.failureType = 'SERVICE_DOWN';
    }
  }

  state.lastLatencyMs = latencyMs;
  state.lastCheckTime = new Date().toISOString();

  if (!success) {
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;

    if (!state.firstFailureTime) {
      state.firstFailureTime = new Date().toISOString();
    }

    if (state.consecutiveFailures === 1 && state.status === 'HEALTHY') {
      state.status = 'DEGRADED';
      logger.warn(`Service ${target.serviceId} is DEGRADED (1 failure): ${errorMsg}`);
      await pushToGateway('SERVICE_DEGRADED', {
        projectId: target.projectId,
        serviceId: target.serviceId,
        service: target.serviceId,
        status: 'DEGRADED',
        latencyMs,
        error: errorMsg,
        timestamp: new Date().toISOString()
      });
    } else if (state.consecutiveFailures >= FAILURE_THRESHOLD && state.status !== 'DOWN') {
      state.status = 'DOWN';
      const eventType = state.failureType || 'SERVICE_DOWN';
      const severity = eventType === 'SERVICE_DOWN' ? 'CRITICAL' : 'HIGH';

      logger.error(`SERVICE DOWN: ${target.serviceId} failed ${state.consecutiveFailures} consecutive checks. Triggering incident.`);

      await dispatchServiceEvent({
        projectId: target.projectId,
        serviceId: target.serviceId,
        service: target.serviceId,
        eventType,
        severity,
        status: 'DOWN',
        latencyMs,
        consecutiveFailures: state.consecutiveFailures,
        firstFailureTimestamp: state.firstFailureTime,
        error: errorMsg,
        timestamp: new Date().toISOString()
      });
    }
  } else {
    state.consecutiveSuccesses += 1;

    if (state.status === 'DOWN' || state.status === 'DEGRADED') {
      if (state.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
        const wasDown = state.status === 'DOWN';
        state.status = 'HEALTHY';
        state.consecutiveFailures = 0;
        state.firstFailureTime = null;
        state.failureType = null;
        logger.info(`SERVICE RECOVERED: ${target.serviceId} is back to HEALTHY after ${state.consecutiveSuccesses} consecutive successes`);

        if (wasDown) {
          await dispatchServiceEvent({
            projectId: target.projectId,
            serviceId: target.serviceId,
            service: target.serviceId,
            eventType: 'SERVICE_RECOVERED',
            status: 'HEALTHY',
            severity: 'LOW',
            latencyMs,
            timestamp: new Date().toISOString()
          });
        } else {
          // Was DEGRADED, just push status update
          await pushToGateway('SERVICE_RECOVERED', {
            projectId: target.projectId,
            serviceId: target.serviceId,
            service: target.serviceId,
            status: 'HEALTHY',
            latencyMs,
            timestamp: new Date().toISOString()
          });
        }
      }
    } else {
      state.status = 'HEALTHY';
      state.consecutiveFailures = 0;
      state.failureType = null;
    }
  }
};

const runHealthChecks = async () => {
  for (const target of TARGET_SERVICES) {
    await checkServiceHealth(target);
  }
};

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// Existing aggregate endpoint for dashboard backward compatibility
app.get('/api/monitors', (req, res) => {
  const { projectId } = req.query;
  // Deduplicate records from serviceStatuses
  const uniqueRecords = new Map();
  Object.values(serviceStatuses).forEach(s => {
    const key = `${s.projectId}:${s.serviceId}`;
    if (!uniqueRecords.has(key)) {
      uniqueRecords.set(key, s);
    }
  });
  let list = Array.from(uniqueRecords.values());
  if (projectId) {
    list = list.filter(s => s.projectId === projectId);
  }
  res.json({ services: list });
});

// ─── Clean AI-Facing Tool APIs ───────────────────────────────────────────────

// 1. Service Health (with resolved dependencies status)
app.get('/projects/:projectId/services/:serviceId/health', async (req, res) => {
  const { projectId, serviceId } = req.params;
  const project = registry.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: `Project '${projectId}' not found` });
  }

  const registeredService = registry.getService(projectId, serviceId);
  if (!registeredService) {
    return res.status(404).json({ error: `Service '${serviceId}' not found in project '${projectId}'` });
  }

  const liveState = getServiceState(projectId, serviceId) || {
    status: 'UNKNOWN',
    lastLatencyMs: 0,
    lastCheckTime: null
  };

  // Inspect status of declared dependencies
  const resolvedDependencies = {};
  for (const dep of (registeredService.dependencies || [])) {
    if (dep.type === 'INTERNAL_SERVICE') {
      const depState = getServiceState(projectId, dep.serviceId);
      resolvedDependencies[dep.serviceId] = depState ? depState.status : 'UNKNOWN';
    } else {
      // Infrastructure: check via TCP probe or assumed UP if system is running
      resolvedDependencies[dep.serviceId] = 'UP';
    }
  }

  res.json({
    projectId,
    serviceId,
    name: registeredService.name,
    status: liveState.status,
    responseTime: liveState.lastLatencyMs,
    timestamp: liveState.lastCheckTime || new Date().toISOString(),
    failureType: liveState.failureType || null,
    consecutiveFailures: liveState.consecutiveFailures || 0,
    dependencies: resolvedDependencies
  });
});

// 2. Explicit Dependencies Tree API
app.get('/projects/:projectId/services/:serviceId/dependencies', (req, res) => {
  const { projectId, serviceId } = req.params;
  const project = registry.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: `Project '${projectId}' not found` });
  }

  const depConfig = registry.getDependencies(projectId, serviceId);
  if (!depConfig) {
    return res.status(404).json({ error: `Service '${serviceId}' not found in project '${projectId}'` });
  }

  const detailedDependencies = depConfig.dependencies.map(d => {
    let currentStatus = 'UP';
    if (d.type === 'INTERNAL_SERVICE') {
      const depLive = getServiceState(projectId, d.serviceId);
      currentStatus = depLive ? depLive.status : 'UNKNOWN';
    }
    return {
      serviceId: d.serviceId,
      type: d.type,
      role: d.role,
      status: currentStatus
    };
  });

  res.json({
    projectId,
    serviceId,
    dependencies: detailedDependencies
  });
});

// 3. Service Metrics API (Queries service /metrics directly or local Prometheus registry)
app.get('/projects/:projectId/services/:serviceId/metrics', async (req, res) => {
  const { projectId, serviceId } = req.params;
  const project = registry.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: `Project '${projectId}' not found` });
  }

  const registeredService = registry.getService(projectId, serviceId);
  if (!registeredService) {
    return res.status(404).json({ error: `Service '${serviceId}' not found in project '${projectId}'` });
  }

  const liveState = getServiceState(projectId, serviceId) || {};

  try {
    // Query target service Prometheus metrics endpoint
    let rawMetrics = '';
    try {
      const metricRes = await axios.get(registeredService.metricsUrl, { timeout: 2000 });
      rawMetrics = typeof metricRes.data === 'string' ? metricRes.data : JSON.stringify(metricRes.data);
    } catch (e) {
      // Service might be down
    }

    res.json({
      projectId,
      serviceId,
      status: liveState.status || 'HEALTHY',
      currentLatencyMs: liveState.lastLatencyMs || 0,
      timestamp: new Date().toISOString(),
      metrics: {
        errorRatePercent: liveState.status === 'DOWN' ? 100 : (liveState.failureType === 'HIGH_ERROR_RATE' ? 80 : 0),
        p95LatencyMs: liveState.lastLatencyMs ? Math.round(liveState.lastLatencyMs * 1.2) : 15,
        p99LatencyMs: liveState.lastLatencyMs ? Math.round(liveState.lastLatencyMs * 1.5) : 25,
        serviceUp: liveState.status === 'DOWN' ? 0 : 1,
        consecutiveFailures: liveState.consecutiveFailures || 0
      },
      hasRawPrometheusData: Boolean(rawMetrics && rawMetrics.length > 0)
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to retrieve metrics: ${err.message}` });
  }
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});

(async () => {
  // Kafka is optional
  try {
    await initTopics(logger);
    kafkaProducer = await createProducer(logger);
    logger.info('Kafka producer connected — events will also be published to Kafka');
  } catch (err) {
    logger.warn(`Kafka not available: ${err.message}. Using HTTP-only mode for event dispatch.`);
  }

  // Start polling
  setTimeout(() => {
    runHealthChecks();
    setInterval(runHealthChecks, POLL_INTERVAL_MS);
  }, 1000);

  logger.info(`Monitoring service started, polling every ${POLL_INTERVAL_MS}ms (Threshold: ${FAILURE_THRESHOLD} failures)`);
})();
