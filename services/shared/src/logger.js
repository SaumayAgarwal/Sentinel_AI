const winston = require('winston');
const Transport = require('winston-transport');
const { addLog } = require('./logStore');

// Custom in-memory transport so all winston log calls across services feed into logStore
class LogStoreTransport extends Transport {
  constructor(opts) {
    super(opts);
    this.serviceName = opts.serviceName;
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    try {
      const { timestamp, level, message, service, correlationId, projectId, ...meta } = info;
      addLog({
        timestamp: timestamp || new Date().toISOString(),
        service: service || this.serviceName || 'unknown',
        projectId: projectId || 'ecommerce-001',
        level,
        message: typeof message === 'object' ? JSON.stringify(message) : String(message),
        correlationId,
        meta
      });
    } catch (e) {
      // Avoid logging errors from inside logger
    }

    callback();
  }
}

const createLogger = (serviceName, projectId = 'ecommerce-001') => {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: serviceName, projectId },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, service, correlationId, ...meta }) => {
            const corr = correlationId ? ` [cid:${correlationId}]` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${service}] ${level}:${corr} ${message}${metaStr}`;
          })
        ),
      }),
      new LogStoreTransport({ serviceName })
    ],
  });
};

module.exports = createLogger;
