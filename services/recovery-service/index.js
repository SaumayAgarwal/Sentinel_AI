require('dotenv').config({ path: '../../.env' });
const express = require('express');
const axios = require('axios');
const { createLogger, createProducer, createConsumer, createRedisClient, TOPICS, metrics, registry, createEventEnvelope } = require('@sentinelflow/shared');


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

const executeRecoveryProcedure = async (serviceName, incidentId, options = {}) => {
  const projectId = options.projectId || registry.DEFAULT_PROJECT_ID || 'ecommerce-001';
  const actionType = (options.actionType || 'RESTART').toUpperCase();
  const requestedBy = options.requestedBy || 'SYSTEM';
  const recoveryActionId = `REC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  // Capability validation
  const capInfo = registry.getRecoveryCapabilities(projectId, serviceName);
  const allowedCaps = (capInfo?.recoveryCapabilities || ['restart']).map(c => c.toUpperCase());
  if (!allowedCaps.includes(actionType.toLowerCase()) && !allowedCaps.includes(actionType)) {
    logger.error(`Recovery capability check failed: Service ${serviceName} does not support action ${actionType}. Allowed: ${allowedCaps.join(', ')}`);
    return {
      success: false,
      recoveryActionId,
      error: `Action '${actionType}' not supported for service '${serviceName}'`
    };
  }

  if (activeRecoveries.has(serviceName)) {
    logger.info(`Recovery already in progress for ${serviceName}, skipping duplicate recovery trigger.`);
    return { success: false, recoveryActionId, error: `Recovery already active for ${serviceName}` };
  }
  activeRecoveries.add(serviceName);

  try {
    const registeredSvc = registry.getService(projectId, serviceName);
    const targetPort = registeredSvc?.port || SERVICE_PORTS[serviceName];
    if (!targetPort) {
      logger.error(`Unknown service for recovery: ${serviceName} (projectId: ${projectId})`);
      return { success: false, recoveryActionId, error: `Unknown service: ${serviceName}` };
    }

    const recoveryUrl = `http://localhost:${targetPort}/admin/recovery`;
    const maxAttempts = 5;
    let success = false;

    // Emit RECOVERY_REQUESTED event
    if (kafkaProducer) {
      try {
        await kafkaProducer.send(TOPICS.RECOVERY_EVENTS, {
          eventType: 'RECOVERY_REQUESTED',
          projectId,
          serviceId: serviceName,
          service: serviceName,
          incidentId,
          recoveryActionId,
          actionType,
          requestedBy,
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s, 32s
      logger.info(`Recovery attempt ${attempt}/${maxAttempts} for ${serviceName} [Action: ${actionType}, ActionID: ${recoveryActionId}] (Delaying ${delay}ms)`);

      // Emit RECOVERY_ATTEMPT_STARTED event
      const attemptPayload = {
        eventType: 'RECOVERY_ATTEMPT_STARTED',
        projectId,
        serviceId: serviceName,
        service: serviceName,
        incidentId,
        recoveryActionId,
        actionType,
        requestedBy,
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
          projectId,
          serviceId: serviceName,
          service: serviceName,
          incidentId,
          recoveryActionId,
          actionType,
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
          logger.info(`RECOVERY SUCCESSFUL for ${serviceName} on attempt ${attempt} [Action: ${actionType}]`);

          // Update Redis status
          try {
            await redis.set(`recovery:${incidentId}:status`, 'SUCCESS', 'EX', 86400);
          } catch (e) {}

          let kafkaSent = false;
          if (kafkaProducer) {
            try {
              await kafkaProducer.send(TOPICS.RECOVERY_EVENTS, {
                eventType: 'RECOVERY_SUCCESS',
                projectId,
                serviceId: serviceName,
                service: serviceName,
                incidentId,
                recoveryActionId,
                actionType,
                requestedBy,
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
                projectId,
                serviceId: serviceName,
                service: serviceName,
                incidentId,
                timestamp: new Date().toISOString()
              }, { timeout: 3000 });
            } catch (e) {}
            try {
              await axios.post(`http://localhost:${GATEWAY_PORT}/internal/push`, {
                eventType: 'RECOVERY_SUCCESS',
                payload: {
                  projectId,
                  serviceId: serviceName,
                  service: serviceName,
                  incidentId,
                  recoveryActionId,
                  actionType,
                  attempt,
                  timestamp: new Date().toISOString()
                }
              }, { timeout: 2000 });
            } catch (e) {}
          }
          return { success: true, recoveryActionId, attempt, actionType };
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
            projectId,
            serviceId: serviceName,
            service: serviceName,
            incidentId,
            recoveryActionId,
            actionType,
            requestedBy,
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
            payload: {
              projectId,
              serviceId: serviceName,
              service: serviceName,
              incidentId,
              recoveryActionId,
              timestamp: new Date().toISOString()
            }
          }, { timeout: 2000 });
        } catch (e) {}
      }
      return { success: false, recoveryActionId, error: `Exhausted ${maxAttempts} recovery attempts` };
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
      executeRecoveryProcedure(incident.serviceName, incident.id, {
        projectId: incident.projectId || 'ecommerce-001',
        actionType: 'RESTART',
        requestedBy: 'SYSTEM'
      });
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

// Existing manual recovery trigger for dashboard backward compatibility
app.post('/api/recovery/trigger', async (req, res) => {
  const { service, incidentId, projectId, actionType } = req.body;
  if (!service) return res.status(400).json({ error: 'Service name required' });
  
  logger.info(`Manual recovery triggered for ${service}`);
  executeRecoveryProcedure(service, incidentId || `manual-${Date.now()}`, {
    projectId: projectId || 'ecommerce-001',
    actionType: actionType || 'RESTART',
    requestedBy: 'OPERATOR'
  });
  res.json({ message: `Recovery sequence initiated for ${service}` });
});

// ─── Pre-AI Controlled Recovery API ──────────────────────────────────────────
// POST /projects/:projectId/incidents/:incidentId/recovery
app.post('/projects/:projectId/incidents/:incidentId/recovery', async (req, res) => {
  const { projectId, incidentId } = req.params;
  const { serviceId, actionType = 'RESTART', requestedBy = 'AI_AGENT' } = req.body;

  if (!serviceId) {
    return res.status(400).json({ error: 'serviceId is required in request body' });
  }

  // 1. Project validation
  const project = registry.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: `Project '${projectId}' not found` });
  }

  // 2. Service & Capability validation
  const service = registry.getService(projectId, serviceId);
  if (!service) {
    return res.status(404).json({ error: `Service '${serviceId}' not found in project '${projectId}'` });
  }

  const normalizedAction = actionType.toUpperCase();
  const allowedCapabilities = (service.recoveryCapabilities || ['restart']).map(c => c.toUpperCase());
  if (!allowedCapabilities.includes(normalizedAction.toLowerCase()) && !allowedCapabilities.includes(normalizedAction)) {
    return res.status(400).json({
      error: `Action '${actionType}' is not supported for service '${serviceId}'. Supported capabilities: [${allowedCapabilities.join(', ')}]`,
      serviceId,
      allowedCapabilities
    });
  }

  // 3. Initiate controlled recovery asynchronously
  logger.info(`[Controlled Recovery] Request accepted for ${serviceId} (Action: ${normalizedAction}, RequestedBy: ${requestedBy})`);
  
  // Non-blocking execution so AI tool gets immediate structured response with tracking ID
  executeRecoveryProcedure(serviceId, incidentId, {
    projectId,
    actionType: normalizedAction,
    requestedBy
  }).catch(err => {
    logger.error(`Controlled recovery execution error for ${serviceId}: ${err.message}`);
  });

  const recoveryActionId = `REC-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  res.status(202).json({
    status: 'ACCEPTED',
    message: `Recovery action '${normalizedAction}' initiated for service '${serviceId}'`,
    recoveryActionId,
    projectId,
    incidentId,
    serviceId,
    actionType: normalizedAction,
    requestedBy,
    timestamp: new Date().toISOString()
  });
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
