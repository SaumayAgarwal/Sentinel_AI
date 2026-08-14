require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createMiddleware, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'payment-service';
const PORT = process.env.PORT_PAYMENT || 3003;
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
  logger.warn(`[DEMO TARGET] Payment Service state updated to ${mode}`, { mode });
  res.json({ message: `Payment Service state set to ${mode}`, failureState });
});

app.post('/admin/recovery', (req, res) => {
  failureState.mode = 'NORMAL';
  logger.info(`[DEMO TARGET] Payment Service recovered to NORMAL`, { mode: failureState.mode });
  res.json({ message: `Payment Service recovered to NORMAL`, failureState });
});

const mockPayments = [
  { id: 'pay-9001', orderId: 'ord-101', amount: 2499.99, status: 'SUCCESS', method: 'STRIPE' },
  { id: 'pay-9002', orderId: 'ord-102', amount: 499.50, status: 'PENDING', method: 'PAYPAL' }
];

app.get('/payments', (req, res) => res.json({ payments: mockPayments }));
app.get('/payments/:id', (req, res) => {
  const pay = mockPayments.find(p => p.id === req.params.id);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });
  res.json(pay);
});
app.post('/payments/process', (req, res) => {
  const newPayment = { id: `pay-${Date.now()}`, status: 'SUCCESS', ...req.body };
  mockPayments.push(newPayment);
  res.status(201).json(newPayment);
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} running on port ${PORT}`);
});
