require('dotenv').config({ path: '../../.env' });
const express = require('express');
const axios = require('axios');
const { createLogger, createProducer, createConsumer, createRedisClient, TOPICS, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'recovery-service';
const PORT = process.env.PORT_RECOVERY || 3007;
const INCIDENT_PORT = process.env.PORT_INCIDENT || 3006;
const GATEWAY_PORT = process.env.PORT_GATEWAY || 3009;
const logger = createLogger(SERVICE_NAME);
const redis = createRedisClient(logger);

let kafkaProducer = null;

const SERVICE_PORTS = {
  'user-service': process.env.PORT_USER || 3001,
  'order-service': process.env.PORT_ORDER || 3002,
  'payment-service': process.env.PORT_PAYMENT || 3003,
  'inventory-service': process.env.PORT_INVENTORY || 3004
};

const activeRecoveries = new Set();

const executeRecoveryProcedure = async (serviceName, incidentId) => {
  if (activeRecoveries.has(serviceName)) {
    logger.info(`Recovery already in progress for ${serviceName}, skipping duplicate recovery trigger.`);
    return;
  }
  activeRecoveries.add(serviceName);

  try {
    const targetPort = SERVICE_PORTS[serviceName];
    if (!targetPort) {
      logger.error(`Unknown service for recovery: ${serviceName}`);
      return;
    }

    const recoveryUrl = `http://localhost:${targetPort}/admin/recovery`;
    const maxAttempts = 5;
    let success = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s, 32s
      logger.info(`Recovery attempt ${attempt}/${maxAttempts} for ${serviceName} (Delaying ${delay}ms)`);

      // Emit RECOVERY_ATTEMPT_STARTED event
      const attemptPayload = {
        eventType: 'RECOVERY_ATTEMPT_STARTED',
        service: serviceName,
        incidentId,
        attempt,
        maxAttempts,
        delayMs: delay,
        timestamp: new Date().toISOString()
      };

      if (kafkaProducer) {
        try {
          await kafkaProducer.send(TOPICS.RECOVERY_EVENTS, attemptPayload);
        } catch (e) {}
      }

      // Also notify incident service to record recovery attempt in incident timeline
      try {
        await axios.post(`http://localhost:${INCIDENT_PORT}/incidents/trigger`, {
          eventType: 'RECOVERY_ATTEMPT',
          service: serviceName,
          incidentId,
          attempt,
          maxAttempts,
          delayMs: delay,
          timestamp: new Date().toISOString()
        }, { timeout: 2000 });
      } catch (e) {}

      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 2000))); // Cap delay to 2s for snappy interactive demo!

      try {
        const res = await axios.post(recoveryUrl, {}, { timeout: 5000 });
        if (res.status === 200) {
          success = true;
          logger.info(`RECOVERY SUCCESSFUL for ${serviceName} on attempt ${attempt}`);

          // Update Redis status
          try {
            await redis.set(`recovery:${incidentId}:status`, 'SUCCESS', 'EX', 86400);
          } catch (e) {}

          let kafkaSent = false;
          if (kafkaProducer) {
            try {
              await kafkaProducer.send(TOPICS.RECOVERY_EVENTS, {
                eventType: 'RECOVERY_SUCCESS',
                service: serviceName,
                incidentId,
                attempt,
                timestamp: new Date().toISOString()
              });
              kafkaSent = true;
            } catch (e) {}
          }
          if (!kafkaSent) {
            try {
              await axios.post(`http://localhost:${INCIDENT_PORT}/incidents/trigger`, {
                eventType: 'SERVICE_RECOVERED',
                service: serviceName,
                timestamp: new Date().toISOString()
              }, { timeout: 3000 });
            } catch (e) {}
            try {
              await axios.post(`http://localhost:${GATEWAY_PORT}/internal/push`, {
                eventType: 'RECOVERY_SUCCESS',
                payload: { service: serviceName, incidentId, attempt, timestamp: new Date().toISOString() }
              }, { timeout: 2000 });
            } catch (e) {}
          }
          break;
        }
      } catch (err) {
        logger.warn(`Recovery attempt ${attempt} failed for ${serviceName}: ${err.message}`);
      }
    }

    if (!success) {
      logger.error(`RECOVERY FAILED for ${serviceName} after ${maxAttempts} attempts`);
      try {
        await redis.set(`recovery:${incidentId}:status`, 'FAILED', 'EX', 86400);
      } catch (e) {}

      let kafkaSent = false;
      if (kafkaProducer) {
        try {
          await kafkaProducer.send(TOPICS.RECOVERY_EVENTS, {
            eventType: 'RECOVERY_FAILED',
            service: serviceName,
            incidentId,
            maxAttempts,
            timestamp: new Date().toISOString()
          });
          kafkaSent = true;
        } catch (e) {}
      }
      if (!kafkaSent) {
        try {
          await axios.post(`http://localhost:${GATEWAY_PORT}/internal/push`, {
            eventType: 'RECOVERY_FAILED',
            payload: { service: serviceName, incidentId, timestamp: new Date().toISOString() }
          }, { timeout: 2000 });
        } catch (e) {}
      }
    }
  } finally {
    activeRecoveries.delete(serviceName);
  }
};

const handleIncidentEvent = async (topic, message) => {
  if (topic === TOPICS.INCIDENT_EVENTS && message.eventType === 'INCIDENT_CREATED') {
    const { incident } = message;
    if (incident && ['CRITICAL', 'HIGH'].includes(incident.severity)) {
      logger.info(`Received CRITICAL incident for ${incident.serviceName}. Initiating recovery sequence...`);
      // Run recovery in background
      executeRecoveryProcedure(incident.serviceName, incident.id);
    }
  }
};

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.post('/api/recovery/trigger', async (req, res) => {
  const { service, incidentId } = req.body;
  if (!service) return res.status(400).json({ error: 'Service name required' });
  
  logger.info(`Manual recovery triggered for ${service}`);
  executeRecoveryProcedure(service, incidentId || `manual-${Date.now()}`);
  res.json({ message: `Recovery sequence initiated for ${service}` });
});

const start = async () => {
  try {
    kafkaProducer = await createProducer(logger);
    await createConsumer('recovery-service-group', [TOPICS.INCIDENT_EVENTS], handleIncidentEvent, logger);
  } catch (err) {
    logger.warn(`Kafka consumer/producer init in recovery service error: ${err.message}`);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} running on port ${PORT}`);
  });
};

start();
