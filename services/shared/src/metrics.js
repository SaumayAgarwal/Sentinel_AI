const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service'],
  registers: [register]
});

const httpErrorCounter = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP error responses (5xx)',
  labelNames: ['method', 'route', 'service'],
  registers: [register]
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register]
});

const serviceUpGauge = new client.Gauge({
  name: 'service_up',
  help: 'Service health status (1 = UP, 0 = DOWN)',
  labelNames: ['service'],
  registers: [register]
});

module.exports = {
  register,
  httpRequestCounter,
  httpErrorCounter,
  httpRequestDuration,
  serviceUpGauge
};
