require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createMiddleware, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'inventory-service';
const PORT = process.env.PORT_INVENTORY || 3004;
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

const mockInventory = [
  { id: 'inv-1', item: 'Server Rack 42U', stock: 15, location: 'Warehouse A' },
  { id: 'inv-2', item: 'Network Switch 24-Port', stock: 4, location: 'Warehouse B' }
];

app.get('/inventory', (req, res) => res.json({ inventory: mockInventory }));
app.get('/inventory/low-stock', (req, res) => {
  const low = mockInventory.filter(i => i.stock < 10);
  res.json({ lowStock: low });
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});
