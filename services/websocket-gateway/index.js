require('dotenv').config({ path: '../../.env' });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { createLogger, createConsumer, TOPICS, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'websocket-gateway';
const PORT = process.env.PORT_GATEWAY || 3009;
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

app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get('/api/events', (req, res) => {
  res.json({ events: recentEvents });
});

// Proxy endpoint to aggregate service status
app.get('/api/services', async (req, res) => {
  try {
    const monitorPort = process.env.PORT_MONITORING || 3005;
    const response = await axios.get(`http://localhost:${monitorPort}/api/monitors`, { timeout: 3000 });
    return res.json(response.data);
  } catch (err) {
    const fallbackServices = [
      { name: 'user-service', status: 'UNKNOWN', lastLatencyMs: 0 },
      { name: 'order-service', status: 'UNKNOWN', lastLatencyMs: 0 },
      { name: 'payment-service', status: 'UNKNOWN', lastLatencyMs: 0 },
      { name: 'inventory-service', status: 'UNKNOWN', lastLatencyMs: 0 }
    ];
    return res.json({ services: fallbackServices });
  }
});

// Proxy endpoint to fetch incidents
app.get('/api/incidents', async (req, res) => {
  try {
    const incidentPort = process.env.PORT_INCIDENT || 3006;
    const response = await axios.get(`http://localhost:${incidentPort}/incidents`, { timeout: 3000 });
    return res.json(response.data);
  } catch (err) {
    return res.json({ incidents: [] });
  }
});

// Proxy SRE metrics from incident service
app.get('/api/metrics/sre', async (req, res) => {
  try {
    const incidentPort = process.env.PORT_INCIDENT || 3006;
    const response = await axios.get(`http://localhost:${incidentPort}/api/metrics/sre`, { timeout: 3000 });
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
  'inventory-service': process.env.PORT_INVENTORY || 3004
};

app.post('/api/admin/failure', async (req, res) => {
  const { service, mode } = req.body;
  const targetPort = SERVICE_PORTS[service || 'payment-service'] || 3003;
  try {
    const response = await axios.post(`http://localhost:${targetPort}/admin/failure`, { mode });
    return res.json(response.data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/recovery', async (req, res) => {
  const { service } = req.body;
  const targetPort = SERVICE_PORTS[service || 'payment-service'] || 3003;
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

app.get('/api/admin/consumer-failure', async (req, res) => {
  try {
    const r = await axios.get(`http://localhost:${INCIDENT_PORT_GW}/admin/consumer-failure`, { timeout: 3000 });
    res.json(r.data);
  } catch (err) { res.json({ simulateConsumerFailure: false }); }
});

const start = async () => {
  // Try Kafka (optional - system works without it)
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

  server.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} running on port ${PORT}`);
  });
};

start();
