require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createMiddleware, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'order-service';
const PORT = process.env.PORT_ORDER || 3002;
const logger = createLogger(SERVICE_NAME);

const failureState = {
  mode: 'NORMAL',
  lastFailureTime: null
};

const app = express();
app.use(express.json());
app.use(createMiddleware(SERVICE_NAME, logger, failureState));

app.get('/health', (req, res) => {
  if (failureState.mode === 'DOWN') {
    metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 0);
    return res.status(503).json({ status: 'DOWN', service: SERVICE_NAME, mode: failureState.mode });
  }
  if (failureState.mode === 'HIGH_LATENCY') {
    metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 1);
    return setTimeout(() => {
      res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: failureState.mode, latencyWarning: true });
    }, 2500);
  }
  if (failureState.mode === 'HIGH_ERROR_RATE') {
    if (Math.random() < 0.8) {
      metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 0);
      return res.status(500).json({ status: 'DOWN', service: SERVICE_NAME, mode: failureState.mode, error: 'Simulated High Error Rate' });
    }
  }
  metrics.serviceUpGauge.set({ service: SERVICE_NAME }, 1);
  res.status(200).json({ status: 'UP', service: SERVICE_NAME, mode: failureState.mode });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

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

const mockOrders = [
  { id: 'ord-101', userId: '1', items: ['Server Rack', 'UPS'], total: 2499.99, status: 'COMPLETED' },
  { id: 'ord-102', userId: '2', items: ['Network Switch 24-Port'], total: 499.50, status: 'PROCESSING' }
];

app.get('/orders', (req, res) => res.json({ orders: mockOrders }));
app.get('/orders/:id', (req, res) => {
  const order = mockOrders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});
app.post('/orders', (req, res) => {
  const newOrder = { id: `ord-${Date.now()}`, status: 'CREATED', ...req.body };
  mockOrders.push(newOrder);
  res.status(201).json(newOrder);
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});
