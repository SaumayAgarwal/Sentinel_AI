require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createMiddleware, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'user-service';
const PORT = process.env.PORT_USER || 3001;
const logger = createLogger(SERVICE_NAME);

const failureState = {
  mode: 'NORMAL', // NORMAL | DOWN | HIGH_ERROR_RATE | HIGH_LATENCY
  lastFailureTime: null
};

const app = express();
app.use(express.json());
app.use(createMiddleware(SERVICE_NAME, logger, failureState));

// Health check endpoint
app.get('/health', (req, res) => {
  if (failureState.mode === 'DOWN') {
    metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 0);
    return res.status(503).json({ status: 'DOWN', service: SERVICE_NAME, mode: failureState.mode });
  }
  if (failureState.mode === 'HIGH_LATENCY') {
    // Return high latency on health check too so monitoring detects it
    metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 1);
    return setTimeout(() => {
      res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: failureState.mode, latencyWarning: true });
    }, 2500);
  }
  if (failureState.mode === 'HIGH_ERROR_RATE') {
    // 80% error rate on health check
    if (Math.random() < 0.8) {
      metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 0);
      return res.status(500).json({ status: 'DOWN', service: SERVICE_NAME, mode: failureState.mode, error: 'Simulated High Error Rate' });
    }
  }
  metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 1);
  res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: failureState.mode });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// Admin simulation endpoints
app.post('/admin/failure', (req, res) => {
  const { mode } = req.body;
  if (!['NORMAL', 'DOWN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid failure mode' });
  }
  failureState.mode = mode;
  failureState.lastFailureTime = new Date().toISOString();
  logger.warn(`Failure mode updated to ${mode}`, { mode });
  res.json({ message: `Service ${SERVICE_NAME} state set to ${mode}`, failureState });
});

app.post('/admin/recovery', (req, res) => {
  failureState.mode = 'NORMAL';
  logger.info(`Service recovered manually`, { mode: failureState.mode });
  res.json({ message: `Service ${SERVICE_NAME} recovered to NORMAL`, failureState });
});

// Business APIs
const mockUsers = [
  { id: '1', name: 'Alice Johnson', email: 'alice@example.com', role: 'DevOps Lead' },
  { id: '2', name: 'Bob Smith', email: 'bob@example.com', role: 'SRE Specialist' },
  { id: '3', name: 'Charlie Davis', email: 'charlie@example.com', role: 'System Architect' }
];

app.get('/users', (req, res) => res.json({ users: mockUsers }));
app.get('/users/:id', (req, res) => {
  const user = mockUsers.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});
app.post('/users', (req, res) => {
  const newUser = { id: String(mockUsers.length + 1), ...req.body };
  mockUsers.push(newUser);
  res.status(201).json(newUser);
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});
