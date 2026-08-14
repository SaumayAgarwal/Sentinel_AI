const { v4: uuidv4 } = require('uuid');
const { httpRequestCounter, httpErrorCounter, httpRequestDuration, serviceUpGauge } = require('./metrics');

const createMiddleware = (serviceName, logger, failureStateRef) => {
  // Initialize up gauge
  serviceUpGauge.set({ service: serviceName }, 1);

  const requestHandler = (req, res, next) => {
    const startTime = Date.now();
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    // CORS Headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-correlation-id');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    // Check failure simulation state if provided
    if (failureStateRef && req.path !== '/health' && req.path !== '/metrics' && !req.path.startsWith('/admin')) {
      const mode = failureStateRef.mode; // NORMAL | DOWN | HIGH_ERROR_RATE | HIGH_LATENCY

      if (mode === 'DOWN') {
        serviceUpGauge.set({ service: serviceName }, 0);
        logger.warn(`[${serviceName}] Simulating DOWN state (503 Service Unavailable)`, { correlationId });
        return res.status(503).json({ error: 'Service Unavailable (Simulated Failure)', service: serviceName });
      }

      if (mode === 'HIGH_ERROR_RATE') {
        // 80% failure rate
        if (Math.random() < 0.8) {
          logger.warn(`[${serviceName}] Simulating HIGH_ERROR_RATE (500 Internal Error)`, { correlationId });
          httpErrorCounter.inc({ method: req.method, route: req.path, service: serviceName });
          return res.status(500).json({ error: 'Simulated Internal Server Error', service: serviceName });
        }
      }

      if (mode === 'HIGH_LATENCY') {
        // Add artificial latency (2.5 seconds)
        const delay = 2500;
        logger.warn(`[${serviceName}] Simulating HIGH_LATENCY (${delay}ms)`, { correlationId });
        return setTimeout(() => {
          finishResponse();
          next();
        }, delay);
      }
    }

    const finishResponse = () => {
      res.on('finish', () => {
        const duration = (Date.now() - startTime) / 1000;
        const route = req.route ? req.route.path : req.path;
        const statusCode = res.statusCode;

        httpRequestCounter.inc({ method: req.method, route, status_code: statusCode, service: serviceName });
        httpRequestDuration.observe({ method: req.method, route, status_code: statusCode, service: serviceName }, duration);

        if (statusCode >= 500) {
          httpErrorCounter.inc({ method: req.method, route, service: serviceName });
        }

        logger.info(`${req.method} ${req.originalUrl} ${statusCode} - ${Math.round(duration * 1000)}ms`, {
          correlationId,
          statusCode,
          durationMs: Math.round(duration * 1000)
        });
      });
    };

    finishResponse();
    next();
  };

  return requestHandler;
};

module.exports = createMiddleware;
