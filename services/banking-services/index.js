require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createMiddleware, metrics, logStore } = require('@sentinelflow/shared');

// Service Configurations for Banking Platform (banking-001)
const BANKING_SERVICES = [
  {
    serviceId: 'auth-service',
    name: 'Authentication & Session Service',
    port: parseInt(process.env.PORT_BANKING_AUTH || '3021', 10),
    routes: (app, logger) => {
      app.post('/auth/login', (req, res) => {
        const { username, password } = req.body || {};
        logger.info(`Authentication attempt for user: ${username || 'client_user'}`);
        res.json({ token: `jwt-bank-${Date.now()}`, expiresAt: new Date(Date.now() + 3600000).toISOString() });
      });
      app.get('/auth/verify', (req, res) => {
        res.json({ valid: true, role: 'BANKING_CUSTOMER', scope: ['transfers', 'accounts'] });
      });
    }
  },
  {
    serviceId: 'account-service',
    name: 'Account & Balance Ledger',
    port: parseInt(process.env.PORT_BANKING_ACCOUNT || '3022', 10),
    routes: (app, logger) => {
      const accounts = [
        { accountNumber: 'ACC-891024', owner: 'Acme Corp Operating', balance: 542000.50, currency: 'USD' },
        { accountNumber: 'ACC-334190', owner: 'Retail Savings Ledger', balance: 128500.00, currency: 'USD' }
      ];
      app.get('/accounts', (req, res) => res.json({ accounts }));
      app.get('/accounts/:id', (req, res) => {
        const acc = accounts.find(a => a.accountNumber === req.params.id) || accounts[0];
        res.json(acc);
      });
      app.post('/accounts/:id/debit', (req, res) => {
        const { amount } = req.body || { amount: 100 };
        logger.info(`Debit request of $${amount} against account ${req.params.id}`);
        res.json({ status: 'DEBITED', newBalance: 541900.50, reference: `DEB-${Date.now()}` });
      });
    }
  },
  {
    serviceId: 'transaction-service',
    name: 'Transaction Settlement Service',
    port: parseInt(process.env.PORT_BANKING_TRANSACTION || '3023', 10),
    routes: (app, logger) => {
      const transactions = [
        { txId: 'TX-9012481', from: 'ACC-891024', to: 'ACC-334190', amount: 1500.00, status: 'SETTLED', timestamp: new Date().toISOString() },
        { txId: 'TX-9012482', from: 'ACC-891024', to: 'EXT-991204', amount: 840.50, status: 'SETTLED', timestamp: new Date().toISOString() }
      ];
      app.get('/transactions', (req, res) => res.json({ transactions }));
      app.get('/transactions/:id', (req, res) => {
        const tx = transactions.find(t => t.txId === req.params.id) || transactions[0];
        res.json(tx);
      });
      app.post('/transactions/transfer', (req, res) => {
        const tx = { txId: `TX-${Date.now()}`, ...req.body, status: 'PENDING', timestamp: new Date().toISOString() };
        transactions.unshift(tx);
        logger.info(`Settlement transaction initiated: ${tx.txId} for amount $${tx.amount || 500}`);
        res.status(201).json(tx);
      });
    }
  },
  {
    serviceId: 'fraud-detection-service',
    name: 'AI Fraud Detection Engine',
    port: parseInt(process.env.PORT_BANKING_FRAUD || '3024', 10),
    routes: (app, logger) => {
      app.post('/fraud/score', (req, res) => {
        const { amount = 0, ip = '127.0.0.1' } = req.body || {};
        const riskScore = amount > 10000 ? 0.85 : 0.05;
        logger.info(`Risk evaluation for $${amount}: riskScore=${riskScore}`);
        res.json({ riskScore, decision: riskScore > 0.7 ? 'FLAG_FOR_REVIEW' : 'ALLOW', evaluatedAt: new Date().toISOString() });
      });
    }
  },
  {
    serviceId: 'notification-service',
    name: 'Banking Alert Notification Service',
    port: parseInt(process.env.PORT_BANKING_NOTIFICATION || '3025', 10),
    routes: (app, logger) => {
      app.post('/notifications/alert', (req, res) => {
        const { channel = 'SMS', recipient, message } = req.body || {};
        logger.info(`Banking alert dispatched via ${channel} to ${recipient || 'customer'}`);
        res.json({ dispatched: true, alertId: `ALT-${Date.now()}` });
      });
    }
  }
];

// Launch each banking microservice
const runningServers = [];

BANKING_SERVICES.forEach(svc => {
  const { serviceId, name, port, routes } = svc;
  // Pass 'banking-001' as projectId so all logs are tagged and queryable under banking-001
  const logger = createLogger(serviceId, 'banking-001');

  const failureState = {
    mode: 'NORMAL', // NORMAL | DOWN | HIGH_ERROR_RATE | HIGH_LATENCY
    lastFailureTime: null
  };

  const app = express();
  app.use(express.json());
  app.use(createMiddleware(serviceId, logger, failureState));

  // Health endpoint probed by monitoring-service
  app.get('/health', (req, res) => {
    if (failureState.mode === 'DOWN') {
      metrics.serviceUpGauge.set({ service: serviceId }, 0);
      logger.error(`[${serviceId}] Health check FAILED — service is in simulated DOWN state. All inbound connections being refused.`, {
        mode: failureState.mode,
        failureSince: failureState.lastFailureTime,
        impact: `Downstream services depending on ${serviceId} will receive connection refused or HTTP 503`
      });
      return res.status(503).json({ status: 'DOWN', service: serviceId, projectId: 'banking-001', mode: failureState.mode });
    }
    if (failureState.mode === 'HIGH_LATENCY') {
      metrics.serviceUpGauge.set({ service: serviceId }, 1);
      logger.warn(`[${serviceId}] Health check DEGRADED — responding with simulated HIGH LATENCY (2500ms). SLA breach imminent.`, {
        mode: failureState.mode,
        artificialDelayMs: 2500,
        impact: `Downstream timeout errors expected in services depending on ${serviceId}`
      });
      return setTimeout(() => {
        res.status(200).json({ status: 'UP', service: serviceId, projectId: 'banking-001', mode: failureState.mode, latencyWarning: true });
      }, 2500);
    }
    if (failureState.mode === 'HIGH_ERROR_RATE') {
      if (Math.random() < 0.8) {
        metrics.serviceUpGauge.set({ service: serviceId }, 0);
        logger.error(`[${serviceId}] Health check FAILED — HIGH_ERROR_RATE mode active. 80% of requests returning HTTP 500. Possible memory leak or DB connection pool exhaustion.`, {
          mode: failureState.mode,
          errorRatePercent: 80,
          failureSince: failureState.lastFailureTime,
          impact: `${serviceId} is intermittently unavailable. Retry storms expected from upstream callers.`
        });
        return res.status(500).json({ status: 'DOWN', service: serviceId, projectId: 'banking-001', mode: failureState.mode, error: 'Simulated High Error Rate' });
      }
    }
    metrics.serviceUpGauge.set({ service: serviceId }, 1);
    res.status(200).json({ status: 'UP', service: serviceId, projectId: 'banking-001', mode: failureState.mode });
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  });

  // Admin failure injection endpoint
  app.post('/admin/failure', (req, res) => {
    const { mode } = req.body;
    if (!['NORMAL', 'DOWN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid failure mode' });
    }
    const previousMode = failureState.mode;
    failureState.mode = mode;
    failureState.lastFailureTime = new Date().toISOString();

    // Emit rich diagnostic logs per failure type so SentinelAI has context to investigate
    if (mode === 'DOWN') {
      logger.error(`[${serviceId}] FAILURE INJECTED — mode=DOWN. Service process simulating crash/OOM. All health checks will return HTTP 503.`, {
        previousMode,
        newMode: mode,
        failureSince: failureState.lastFailureTime,
        cause: 'Simulated process crash or out-of-memory condition',
        affectedEndpoints: ['GET /health', 'POST /transactions/transfer', 'GET /accounts'],
        recommendation: 'SentinelAI recovery agent should issue POST /admin/recovery to restore service'
      });
    } else if (mode === 'HIGH_LATENCY') {
      logger.warn(`[${serviceId}] FAILURE INJECTED — mode=HIGH_LATENCY. Artificial 2500ms delay applied to all responses. Downstream timeout SLA likely breached.`, {
        previousMode,
        newMode: mode,
        failureSince: failureState.lastFailureTime,
        artificialDelayMs: 2500,
        cause: 'Simulated slow DB query or network congestion spike',
        recommendation: 'Check database query execution time and connection pool saturation'
      });
    } else if (mode === 'HIGH_ERROR_RATE') {
      logger.error(`[${serviceId}] FAILURE INJECTED — mode=HIGH_ERROR_RATE. 80% of requests returning HTTP 500. Possible DB connection pool exhaustion or memory leak detected.`, {
        previousMode,
        newMode: mode,
        failureSince: failureState.lastFailureTime,
        errorRatePercent: 80,
        cause: 'Simulated connection pool exhaustion or uncaught exception storm',
        recommendation: 'Inspect active DB connections and heap usage. Circuit breaker may need activation.'
      });
    }

    res.json({ message: `Service ${serviceId} state set to ${mode}`, failureState, projectId: 'banking-001' });
  });

  // Admin recovery endpoint (invoked by recovery-service and gateway)
  app.post('/admin/recovery', (req, res) => {
    const previousMode = failureState.mode;
    failureState.mode = 'NORMAL';
    logger.info(`[${serviceId}] SERVICE RECOVERED — mode reset to NORMAL. All health checks will return HTTP 200.`, {
      previousMode,
      recoveredAt: new Date().toISOString(),
      recoveredBy: req.headers['x-sentinel-auth'] ? 'SentinelAI Recovery Agent' : 'Manual Operator Action',
      outcome: 'Service is healthy. Downstream services should resume normal operation.'
    });
    res.json({ message: `Service ${serviceId} recovered to NORMAL`, failureState, projectId: 'banking-001' });
  });

  // Internal logs endpoint — gateway proxies this to serve banking-001 logs from the correct process
  app.get('/internal/logs', (req, res) => {
    const { level, from, to, limit } = req.query;
    const logs = logStore.getLogs({
      projectId: 'banking-001',
      serviceId,
      level,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 100
    });
    res.json({ projectId: 'banking-001', serviceId, count: logs.length, logs });
  });

  // Attach business domain routes
  if (routes) {
    routes(app, logger);
  }

  const server = app.listen(port, () => {
    logger.info(`[Banking Platform] ${name} (${serviceId}) running on port ${port}`, {
      projectId: 'banking-001',
      port,
      healthUrl: `http://localhost:${port}/health`,
      metricsUrl: `http://localhost:${port}/metrics`
    });
  });

  runningServers.push(server);
});

process.on('SIGTERM', () => {
  runningServers.forEach(s => s.close());
});
process.on('SIGINT', () => {
  runningServers.forEach(s => s.close());
});
