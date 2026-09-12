require('dotenv').config({ path: '../../.env' });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { createLogger, createConsumer, TOPICS, metrics, registry, logStore } = require('@sentinelflow/shared');


const SERVICE_NAME = 'websocket-gateway';
const PORT = process.env.PORT || process.env.PORT_GATEWAY || 3009;
const logger = createLogger(SERVICE_NAME);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Event stream buffer (last 100 events)
const recentEvents = [];

const pushEvent = (type, data) => {
  const eventObj = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type,
    data,
    timestamp: new Date().toISOString()
  };
  recentEvents.unshift(eventObj);
  if (recentEvents.length > 100) recentEvents.pop();

  // Broadcast via Socket.IO
  io.emit('event:stream', eventObj);
  logger.info(`Pushed event [${type}] to ${io.engine.clientsCount} connected clients`);
  return eventObj;
};

// ─── Internal HTTP push endpoint (called by other services when Kafka is down) ───
app.post('/internal/push', (req, res) => {
  const { eventType, payload } = req.body;
  if (!eventType || !payload) {
    return res.status(400).json({ error: 'eventType and payload required' });
  }

  logger.info(`Received internal push: ${eventType}`);

  switch (eventType) {
    case 'SERVICE_DOWN':
    case 'SERVICE_RECOVERED':
    case 'HIGH_ERROR_RATE':
    case 'HIGH_LATENCY': {
      pushEvent('SERVICE_EVENT', payload);
      io.emit('service:update', payload);
      break;
    }
    case 'INCIDENT_CREATED': {
      pushEvent('INCIDENT_EVENT', { eventType, incident: payload });
      io.emit('incident:created', payload);
      break;
    }
    case 'INCIDENT_UPDATED':
    case 'INCIDENT_ACKNOWLEDGED': {
      pushEvent('INCIDENT_EVENT', { eventType, incident: payload });
      io.emit('incident:updated', payload);
      break;
    }
    case 'INCIDENT_RESOLVED': {
      pushEvent('INCIDENT_EVENT', { eventType, incident: payload });
      io.emit('incident:updated', payload);
      break;
    }
    case 'RECOVERY_ATTEMPT':
    case 'RECOVERY_SUCCESS':
    case 'RECOVERY_FAILED': {
      pushEvent('RECOVERY_EVENT', payload);
      io.emit('recovery:attempt', payload);
      break;
    }
    case 'RETRY_ATTEMPT': {
      pushEvent('RETRY_EVENT', { ...payload, eventType: 'RETRY_ATTEMPT' });
      io.emit('dlq:retry', payload);
      break;
    }
    case 'DLQ_EVENT_ADDED': {
      pushEvent('DLQ_EVENT', { ...payload, eventType: 'DLQ_EVENT_ADDED' });
      io.emit('dlq:event_added', payload);
      break;
    }
    case 'DLQ_EVENT_REPLAYING': {
      pushEvent('DLQ_EVENT', { ...payload, eventType: 'DLQ_EVENT_REPLAYING' });
      io.emit('dlq:replaying', payload);
      break;
    }
    case 'DLQ_EVENT_REPLAYED': {
      pushEvent('DLQ_EVENT', { ...payload, eventType: 'DLQ_EVENT_REPLAYED' });
      io.emit('dlq:event_replayed', payload);
      break;
    }
    case 'DLQ_EVENT_DELETED': {
      pushEvent('DLQ_EVENT', { ...payload, eventType: 'DLQ_EVENT_DELETED' });
      io.emit('dlq:event_deleted', payload);
      break;
    }
    case 'AI_INVESTIGATION_UPDATED': {
      pushEvent('AI_INVESTIGATION', payload);
      io.emit('ai:investigation', payload);
      break;
    }
    default: {
      pushEvent(eventType, payload);
      break;
    }

  }

  res.json({ ok: true, clients: io.engine.clientsCount });
});

const handleKafkaMessage = async (topic, message) => {
  logger.info(`Gateway received event from Kafka topic [${topic}]: ${message.eventType || message.title || 'event'}`);

  if (topic === TOPICS.SERVICE_EVENTS) {
    pushEvent('SERVICE_EVENT', message);
    io.emit('service:update', message);
  } else if (topic === TOPICS.INCIDENT_EVENTS) {
    pushEvent('INCIDENT_EVENT', message);
    if (message.eventType === 'INCIDENT_CREATED') {
      io.emit('incident:created', message.incident);
    } else {
      io.emit('incident:updated', message.incident);
    }
  } else if (topic === TOPICS.RECOVERY_EVENTS) {
    pushEvent('RECOVERY_EVENT', message);
    io.emit('recovery:attempt', message);
  } else if (topic === TOPICS.NOTIFICATION_EVENTS) {
    pushEvent('NOTIFICATION_EVENT', message);
    io.emit('notification:new', message);
  } else if (topic === TOPICS.DLQ_EVENTS) {
    pushEvent('DLQ_EVENT', { ...message, eventType: 'DLQ_EVENT_ADDED' });
    io.emit('dlq:event_added', message);
  }
};

io.on('connection', (socket) => {
  logger.info(`Client connected to WebSocket: ${socket.id}`);
  socket.emit('gateway:connected', { socketId: socket.id, time: new Date().toISOString() });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

app.get('/', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME, message: 'SentinelAI Gateway is running' }));
app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get('/api/events', (req, res) => {
  const { projectId } = req.query;
  if (projectId) {
    const filtered = recentEvents.filter(e => {
      const pId = e.data?.projectId || e.projectId;
      return pId === projectId;
    });
    return res.json({ events: filtered });
  }
  res.json({ events: recentEvents });
});

// Proxy endpoint to aggregate service status (optionally scoped by projectId)
app.get('/api/services', async (req, res) => {
  const { projectId } = req.query;
  try {
    const monitorPort = process.env.PORT_MONITORING || 3005;
    const response = await axios.get(`http://localhost:${monitorPort}/api/monitors`, { timeout: 3000 });
    let servicesList = response.data?.services || [];
    if (projectId) {
      servicesList = servicesList.filter(s => (s.projectId || 'ecommerce-001') === projectId);
    }
    return res.json({ services: servicesList });
  } catch (err) {
    let fallbackServices = [
      { name: 'user-service', status: 'UNKNOWN', lastLatencyMs: 0, projectId: 'ecommerce-001' },
      { name: 'order-service', status: 'UNKNOWN', lastLatencyMs: 0, projectId: 'ecommerce-001' },
      { name: 'payment-service', status: 'UNKNOWN', lastLatencyMs: 0, projectId: 'ecommerce-001' },
      { name: 'inventory-service', status: 'UNKNOWN', lastLatencyMs: 0, projectId: 'ecommerce-001' }
    ];
    if (projectId) {
      fallbackServices = fallbackServices.filter(s => s.projectId === projectId);
    }
    return res.json({ services: fallbackServices });
  }
});

// Proxy endpoint to fetch incidents (supports optional projectId query param)
app.get('/api/incidents', async (req, res) => {
  try {
    const incidentPort = process.env.PORT_INCIDENT || 3006;
    const response = await axios.get(`http://localhost:${incidentPort}/incidents`, {
      params: req.query,
      timeout: 3000
    });
    return res.json(response.data);
  } catch (err) {
    return res.json({ incidents: [] });
  }
});

// Proxy endpoint to acknowledge an incident
app.patch('/api/incidents/:id/acknowledge', async (req, res) => {
  try {
    const incidentPort = process.env.PORT_INCIDENT || 3006;
    const response = await axios.patch(`http://localhost:${incidentPort}/incidents/${req.params.id}/acknowledge`, req.body, {
      timeout: 3000
    });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Proxy SRE metrics from incident service (supports optional projectId query param)
app.get('/api/metrics/sre', async (req, res) => {
  try {
    const incidentPort = process.env.PORT_INCIDENT || 3006;
    const response = await axios.get(`http://localhost:${incidentPort}/api/metrics/sre`, {
      params: req.query,
      timeout: 3000
    });
    return res.json(response.data);
  } catch (err) {
    return res.json({ mttdSeconds: 2.0, mttrSeconds: 6.0, availabilityPercent: 100.0, recoverySuccessRatePercent: 100.0 });
  }
});

// Infrastructure health check
app.get('/api/infra/status', async (req, res) => {
  const net = require('net');
  const checkPort = (host, port, timeoutMs = 1500) => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
  };

  const [postgres, redis, kafka] = await Promise.all([
    checkPort('127.0.0.1', 5433),
    checkPort('127.0.0.1', 6379),
    checkPort('127.0.0.1', 9092)
  ]);

  res.json({
    postgres: postgres ? 'CONNECTED' : 'DISCONNECTED',
    redis: redis ? 'CONNECTED' : 'DISCONNECTED',
    kafka: kafka ? 'CONNECTED' : 'DISCONNECTED'
  });
});

// Admin proxy routes
const SERVICE_PORTS = {
  'user-service': process.env.PORT_USER || 3001,
  'order-service': process.env.PORT_ORDER || 3002,
  'payment-service': process.env.PORT_PAYMENT || 3003,
  'inventory-service': process.env.PORT_INVENTORY || 3004,
  'auth-service': process.env.PORT_BANKING_AUTH || 3021,
  'account-service': process.env.PORT_BANKING_ACCOUNT || 3022,
  'transaction-service': process.env.PORT_BANKING_TRANSACTION || 3023,
  'fraud-detection-service': process.env.PORT_BANKING_FRAUD || 3024,
  'notification-service': process.env.PORT_BANKING_NOTIFICATION || 3025
};

const resolveTargetPort = (serviceName, projectId) => {
  if (projectId) {
    const svc = registry.getService(projectId, serviceName);
    if (svc?.port) return svc.port;
  }
  // Try all projects in registry
  for (const p of registry.getProjects()) {
    const s = registry.getService(p.id, serviceName);
    if (s?.port) return s.port;
  }
  return SERVICE_PORTS[serviceName] || 3003;
};

app.post('/api/admin/failure', async (req, res) => {
  const { service, mode, projectId } = req.body;
  const targetPort = resolveTargetPort(service || 'payment-service', projectId);
  try {
    const response = await axios.post(`http://localhost:${targetPort}/admin/failure`, { mode });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/recovery', async (req, res) => {
  const { service, projectId } = req.body;
  const targetPort = resolveTargetPort(service || 'payment-service', projectId);
  try {
    const response = await axios.post(`http://localhost:${targetPort}/admin/recovery`);
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DLQ Proxy Routes ────────────────────────────────────────────────────────
const INCIDENT_PORT_GW = process.env.PORT_INCIDENT || 3006;

app.get('/api/dlq', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/api/dlq`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) { res.json({ dlqEvents: [] }); }
});

app.get('/api/dlq/:id', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/api/dlq/${req.params.id}`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) { res.status(404).json({ error: 'Not found' }); }
});

app.post('/api/dlq/:id/retry', async (req, res) => {
  try {
    const r = await axios.post(`http://localhost:${INCIDENT_PORT_GW}/api/dlq/${req.params.id}/retry`, {}, { timeout: 10000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

app.delete('/api/dlq/:id', async (req, res) => {
  try {
    const r = await axios.delete(`http://localhost:${INCIDENT_PORT_GW}/api/dlq/${req.params.id}`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// Consumer failure simulation proxy
app.post('/api/admin/consumer-failure', async (req, res) => {
  try {
    const r = await axios.post(`http://localhost:${INCIDENT_PORT_GW}/admin/consumer-failure`, req.body, { timeout: 3000 });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SentinelAI Tool API Facade & Proxies ──────────────────────────────────────
const MONITOR_PORT_GW = process.env.PORT_MONITORING || 3005;
const RECOVERY_PORT_GW = process.env.PORT_RECOVERY || 3007;

// Internal Auth middleware helper for sensitive AI actions (e.g. recovery)
const verifyInternalAuth = (req, res, next) => {
  const authHeader = req.headers['x-sentinel-auth'] || req.headers['authorization'];
  // Allow requests if internal token matches OR in development default token
  const validToken = process.env.SENTINEL_INTERNAL_TOKEN || 'sentinel-ai-internal-key';
  if (process.env.NODE_ENV === 'production' && authHeader !== validToken) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid SentinelAI authentication token' });
  }
  next();
};

// 1. Projects Registry API
app.get('/api/projects', (req, res) => {
  res.json({ projects: registry.getProjects() });
});

app.get('/api/projects/:projectId', (req, res) => {
  const project = registry.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: `Project '${req.params.projectId}' not found` });
  res.json(project);
});

// 2. Services in Project API
app.get('/api/projects/:projectId/services', (req, res) => {
  const services = registry.getServices(req.params.projectId);
  res.json({ projectId: req.params.projectId, count: services.length, services });
});

// 3. Service Health API (proxied to monitoring-service)
app.get('/api/projects/:projectId/services/:serviceId/health', async (req, res) => {
  const { projectId, serviceId } = req.params;
  try {
    const r = await axios.get(`http://localhost:${MONITOR_PORT_GW}/projects/${projectId}/services/${serviceId}/health`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 4. Service Metrics API (proxied to monitoring-service)
app.get('/api/projects/:projectId/services/:serviceId/metrics', async (req, res) => {
  const { projectId, serviceId } = req.params;
  try {
    const r = await axios.get(`http://localhost:${MONITOR_PORT_GW}/projects/${projectId}/services/${serviceId}/metrics`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 5. Service Logs API
// For banking-001: proxy to each service's /internal/logs (separate process, separate logStore)
// For all other projects: read from the gateway's shared in-memory logStore
app.get('/api/projects/:projectId/services/:serviceId/logs', async (req, res) => {
  const { projectId, serviceId } = req.params;
  const { level, from, to, limit } = req.query;

  if (projectId === 'banking-001') {
    const targetPort = resolveTargetPort(serviceId, projectId);
    try {
      const qs = new URLSearchParams();
      if (level) qs.set('level', level);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (limit) qs.set('limit', limit);
      const r = await axios.get(`http://localhost:${targetPort}/internal/logs?${qs.toString()}`, { timeout: 3000 });
      return res.json(r.data);
    } catch (err) {
      return res.json({ projectId, serviceId, count: 0, logs: [], error: err.message });
    }
  }

  const logs = logStore.getLogs({
    projectId,
    serviceId,
    level,
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 50
  });

  res.json({
    projectId,
    serviceId,
    count: logs.length,
    logs
  });
});

// 6. Service Dependencies API (proxied to monitoring-service)
app.get('/api/projects/:projectId/services/:serviceId/dependencies', async (req, res) => {
  const { projectId, serviceId } = req.params;
  try {
    const r = await axios.get(`http://localhost:${MONITOR_PORT_GW}/projects/${projectId}/services/${serviceId}/dependencies`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 7. Service Recovery Capabilities API
app.get('/api/projects/:projectId/services/:serviceId/recovery-capabilities', (req, res) => {
  const { projectId, serviceId } = req.params;
  const cap = registry.getRecoveryCapabilities(projectId, serviceId);
  if (!cap) return res.status(404).json({ error: `Service '${serviceId}' not found in project '${projectId}'` });
  res.json(cap);
});

// 8. Incident Timeline API (proxied to incident-service)
app.get('/api/incidents/:id/timeline', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/incidents/${req.params.id}/timeline`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 9. Historical Incidents API (proxied to incident-service)
app.get('/api/projects/:projectId/historical-incidents', async (req, res) => {
  const { projectId } = req.params;
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/projects/${projectId}/historical-incidents`, {
      params: req.query,
      timeout: 3000
    });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 9b. Project Scoped Incidents API (proxied to incident-service)
app.get('/api/projects/:projectId/incidents', async (req, res) => {
  const { projectId } = req.params;
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/projects/${projectId}/incidents`, {
      params: req.query,
      timeout: 3000
    });
    res.json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 10. Controlled Recovery Request API (protected by verifyInternalAuth)
app.post('/api/projects/:projectId/incidents/:incidentId/recovery', verifyInternalAuth, async (req, res) => {
  const { projectId, incidentId } = req.params;
  try {
    const r = await axios.post(
      `http://localhost:${RECOVERY_PORT_GW}/projects/${projectId}/incidents/${incidentId}/recovery`,
      req.body,
      { timeout: 5000 }
    );
    res.status(r.status).json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});

// 11. SentinelAI Investigation Proxy Routes
const AI_PORT_GW = process.env.PORT_AI || 3011;

app.get('/api/ai/investigations', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${AI_PORT_GW}/api/ai/investigations`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    res.json({ count: 0, investigations: [] });
  }
});

app.get('/api/ai/investigations/:incidentId', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${AI_PORT_GW}/api/ai/investigations/${req.params.incidentId}`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    res.status(err.response?.status || 404).json(err.response?.data || { error: 'Not found' });
  }
});

app.get('/api/ai/projects/:projectId/investigations', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${AI_PORT_GW}/api/ai/projects/${req.params.projectId}/investigations`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) {
    res.json({ projectId: req.params.projectId, count: 0, investigations: [] });
  }
});

app.post('/api/ai/investigate/:incidentId', async (req, res) => {
  try {
    const r = await axios.post(`http://localhost:${AI_PORT_GW}/api/ai/investigate/${req.params.incidentId}`, req.body, { timeout: 5000 });
    res.status(r.status).json(r.data);
  } catch (err) {
    const errData = err.response?.data || { error: err.message };
    res.status(err.response?.status || 500).json(errData);
  }
});


// 1. Start HTTP & WebSocket server immediately on boot (so Railway/cloud healthcheck passes in <100ms)
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT} (bound to 0.0.0.0)`);
});

// 2. Connect to Kafka in the background without blocking HTTP server startup
(async () => {
  try {
    await createConsumer(
      'websocket-gateway-group',
      [TOPICS.SERVICE_EVENTS, TOPICS.INCIDENT_EVENTS, TOPICS.RECOVERY_EVENTS, TOPICS.NOTIFICATION_EVENTS, TOPICS.DLQ_EVENTS],
      handleKafkaMessage,
      logger
    );
    logger.info('Kafka consumer connected — events will be relayed via Kafka');
  } catch (err) {
    logger.warn(`Kafka consumer init failed: ${err.message}. Gateway will use HTTP-push mode for real-time events.`);
  }
})();
