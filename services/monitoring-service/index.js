require('dotenv').config({ path: '../../.env' });
const express = require('express');
const axios = require('axios');
const { createLogger, createProducer, TOPICS, initTopics, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'monitoring-service';
const PORT = process.env.PORT_MONITORING || 3005;
const INCIDENT_PORT = process.env.PORT_INCIDENT || 3006;
const GATEWAY_PORT = process.env.PORT_GATEWAY || 3009;
const logger = createLogger(SERVICE_NAME);

const TARGET_SERVICES = [
  { name: 'user-service', url: `http://localhost:${process.env.PORT_USER || 3001}/health` },
  { name: 'order-service', url: `http://localhost:${process.env.PORT_ORDER || 3002}/health` },
  { name: 'payment-service', url: `http://localhost:${process.env.PORT_PAYMENT || 3003}/health` },
  { name: 'inventory-service', url: `http://localhost:${process.env.PORT_INVENTORY || 3004}/health` }
];

const FAILURE_THRESHOLD = 2;
const RECOVERY_THRESHOLD = 2;
const POLL_INTERVAL_MS = 2000;

// Service status tracking
const serviceStatuses = {};
TARGET_SERVICES.forEach(s => {
  serviceStatuses[s.name] = {
    name: s.name,
    url: s.url,
    status: 'HEALTHY',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastLatencyMs: 0,
    lastCheckTime: null,
    failureType: null
  };
});

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

  if (kafkaProducer) {
    try {
      await kafkaProducer.send(TOPICS.SERVICE_EVENTS, eventData);
      kafkaSent = true;
      logger.info(`Published to Kafka: ${eventData.eventType} for ${eventData.service}`);
    } catch (err) {
      logger.warn(`Kafka send failed: ${err.message}. Using HTTP fallback.`);
    }
  }

  // Only call incident service via HTTP if Kafka send failed
  if (!kafkaSent) {
    try {
      await axios.post(
        `http://localhost:${INCIDENT_PORT}/incidents/trigger`,
        eventData,
        { timeout: 3000 }
      );
    } catch (err) {
      logger.warn(`Incident service HTTP call failed: ${err.message}`);
    }
  }

  // Always push raw service event to gateway for the UI service status indicators
  await pushToGateway(eventData.eventType, eventData);
};

const checkServiceHealth = async (target) => {
  const state = serviceStatuses[target.name];
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
      }
    } else {
      success = false;
      errorMsg = `HTTP Status ${res.status}`;
      state.failureType = res.status >= 500 ? 'HIGH_ERROR_RATE' : 'SERVICE_DOWN';
    }
  } catch (err) {
    latencyMs = Date.now() - startTime;
    success = false;
    errorMsg = err.message;
    state.failureType = 'SERVICE_DOWN';
  }

  state.lastLatencyMs = latencyMs;
  state.lastCheckTime = new Date().toISOString();

  if (!success) {
    if (state.consecutiveFailures === 0) {
      state.firstFailureTime = new Date().toISOString();
    }
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;
    logger.warn(`Health check failed for ${target.name} (${state.consecutiveFailures}/${FAILURE_THRESHOLD}): ${errorMsg}`);

    if (state.consecutiveFailures >= FAILURE_THRESHOLD && state.status !== 'DOWN') {
      state.status = 'DOWN';
      const eventType = state.failureType || 'SERVICE_DOWN';
      const severity = eventType === 'SERVICE_DOWN' ? 'CRITICAL' : 'HIGH';

      logger.error(`SERVICE FAILURE DETECTED: ${target.name} is now ${state.status} (${eventType})`);

      await dispatchServiceEvent({
        eventType,
        service: target.name,
        severity,
        consecutiveFailures: state.consecutiveFailures,
        latencyMs,
        error: errorMsg,
        firstFailureTimestamp: state.firstFailureTime || new Date().toISOString(),
        timestamp: new Date().toISOString()
      });
    } else if (state.consecutiveFailures < FAILURE_THRESHOLD && state.status !== 'DOWN') {
      // Still accumulating failures — push status to gateway so UI shows DEGRADED
      state.status = 'DEGRADED';
      await pushToGateway('SERVICE_DEGRADED', {
        service: target.name,
        status: 'DEGRADED',
        consecutiveFailures: state.consecutiveFailures,
        threshold: FAILURE_THRESHOLD,
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
        logger.info(`SERVICE RECOVERED: ${target.name} is back to HEALTHY after ${state.consecutiveSuccesses} consecutive successes`);

        if (wasDown) {
          await dispatchServiceEvent({
            eventType: 'SERVICE_RECOVERED',
            service: target.name,
            status: 'HEALTHY',
            severity: 'LOW',
            latencyMs,
            timestamp: new Date().toISOString()
          });
        } else {
          // Was DEGRADED, just push status update
          await pushToGateway('SERVICE_RECOVERED', {
            service: target.name,
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

app.get('/api/monitors', (req, res) => {
  res.json({ services: Object.values(serviceStatuses) });
});

const start = async () => {
  // Kafka is optional
  try {
    await initTopics(logger);
    kafkaProducer = await createProducer(logger);
    logger.info('Kafka producer connected — events will also be published to Kafka');
  } catch (err) {
    logger.warn(`Kafka not available: ${err.message}. Using HTTP-only mode for event dispatch.`);
  }

  // Start polling
  // Run first check immediately after 1s so UI updates fast on startup
  setTimeout(() => {
    runHealthChecks();
    setInterval(runHealthChecks, POLL_INTERVAL_MS);
  }, 1000);

  logger.info(`Monitoring service started, polling every ${POLL_INTERVAL_MS}ms (Threshold: ${FAILURE_THRESHOLD} failures)`);

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} running on port ${PORT}`);
  });
};

start();
