require('dotenv').config({ path: '../../.env', override: true });
const express = require('express');
const axios = require('axios');
const { createLogger, createConsumer, TOPICS, metrics } = require('@sentinelflow/shared');
const SentinelAIAgent = require('./src/agent');

const SERVICE_NAME = 'sentinel-ai';
const PORT = process.env.PORT_AI || 3011;
const GATEWAY_PORT = process.env.PORT_GATEWAY || 3009;
const logger = createLogger(SERVICE_NAME);

const agent = new SentinelAIAgent({
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
  model: process.env.GROQ_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-oss-120b',
  baseURL: process.env.GROQ_BASE_URL || process.env.OPENAI_BASE_URL
});

const app = express();
app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-sentinel-auth');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Push investigation updates to websocket gateway for frontend visualization
const pushInvestigationToGateway = async (investigation) => {
  try {
    await axios.post(
      `http://localhost:${GATEWAY_PORT}/internal/push`,
      {
        eventType: 'AI_INVESTIGATION_UPDATED',
        payload: investigation
      },
      { timeout: 2000 }
    );
  } catch (e) {
    // Gateway might be restarting, non-critical
  }
};

// Health & Metrics
app.get('/health', (req, res) => {
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const hasKey = !!process.env.OPENAI_API_KEY;
  let llmProvider = 'deterministic-engine';
  if (hasKey) {
    if (baseURL.includes('groq.com')) llmProvider = 'groq';
    else if (baseURL.includes('openai.com')) llmProvider = 'openai';
    else llmProvider = 'openai-compatible';
  }
  res.json({
    status: 'UP',
    service: SERVICE_NAME,
    llmProvider,
    llmBaseURL: baseURL,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    autoRecoveryEnabled: process.env.AI_AUTO_RECOVERY_ENABLED === 'true'
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ─── Investigation Query Endpoints ───────────────────────────────────────────

// 1. Get single investigation by incidentId
app.get('/api/ai/investigations/:incidentId', (req, res) => {
  const investigation = agent.getInvestigation(req.params.incidentId);
  if (!investigation) {
    return res.status(404).json({ error: `No AI investigation found for incident '${req.params.incidentId}'` });
  }
  res.json(investigation);
});

// 2. List investigations for a project
app.get('/api/ai/projects/:projectId/investigations', (req, res) => {
  const list = agent.getAllInvestigations(req.params.projectId);
  res.json({
    projectId: req.params.projectId,
    count: list.length,
    investigations: list
  });
});

// 3. List all investigations
app.get('/api/ai/investigations', (req, res) => {
  const list = agent.getAllInvestigations();
  res.json({ count: list.length, investigations: list });
});

// 4. Trigger manual investigation for an incident
app.post('/api/ai/investigate/:incidentId', async (req, res) => {
  const { incidentId } = req.params;
  const { serviceId, type, severity, projectId = 'ecommerce-001' } = req.body;

  logger.info(`[API] Manual investigation triggered for incident: ${incidentId}`);

  const incidentPayload = {
    incidentId,
    id: incidentId,
    projectId,
    serviceId: serviceId || 'payment-service',
    type: type || 'SERVICE_DOWN',
    severity: severity || 'CRITICAL',
    createdAt: new Date().toISOString()
  };

  // Run asynchronously and return 202 Accepted
  agent.investigate(incidentPayload).then(async (result) => {
    await pushInvestigationToGateway(result);
  }).catch((err) => {
    logger.error(`Investigation error: ${err.message}`);
  });

  res.status(202).json({
    status: 'ACCEPTED',
    message: `AI investigation initiated for incident '${incidentId}'`,
    incidentId,
    timestamp: new Date().toISOString()
  });
});

// ─── Kafka Event Consumer ────────────────────────────────────────────────────
const handleKafkaMessage = async (topic, message) => {
  if (topic === TOPICS.INCIDENT_EVENTS) {
    if (message.eventType === 'INCIDENT_CREATED') {
      const inc = message.incident || message;
      logger.info(`[Kafka] 🚨 Received INCIDENT_CREATED for ${inc.serviceId || inc.serviceName || inc.service}. Triggering AI investigation.`);

      try {
        const result = await agent.investigate({
          incidentId: inc.incidentId || inc.id,
          id: inc.id || inc.incidentId,
          projectId: inc.projectId || 'ecommerce-001',
          serviceId: inc.serviceId || inc.serviceName || inc.service,
          type: inc.type || inc.reason || 'SERVICE_DOWN',
          severity: inc.severity || 'CRITICAL',
          createdAt: inc.createdAt || new Date().toISOString()
        });

        // Broadcast AI result to gateway for real-time dashboard display
        await pushInvestigationToGateway(result);
      } catch (err) {
        logger.error(`[Kafka] Failed to process investigation for incident: ${err.message}`);
      }
    }
  }
};

const start = async () => {
  // Connect Kafka consumer
  try {
    await createConsumer(
      'sentinel-ai-consumer-group',
      [TOPICS.INCIDENT_EVENTS],
      handleKafkaMessage,
      logger
    );
    logger.info('Kafka consumer connected — SentinelAI listening for INCIDENT_CREATED events');
  } catch (err) {
    logger.warn(`Kafka not available for SentinelAI: ${err.message}. Manual investigation API remains fully active.`);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} running on port ${PORT} (Port: ${PORT}, AutoRecovery: ${process.env.AI_AUTO_RECOVERY_ENABLED === 'true'})`);
  });
};

start();
