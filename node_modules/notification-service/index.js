require('dotenv').config({ path: '../../.env' });
const express = require('express');
const { createLogger, createProducer, createConsumer, createRedisClient, TOPICS, metrics } = require('@sentinelflow/shared');

const SERVICE_NAME = 'notification-service';
const PORT = process.env.PORT_NOTIFICATION || 3008;
const logger = createLogger(SERVICE_NAME);
const redis = createRedisClient(logger);

let kafkaProducer = null;

const sendNotification = async (notification) => {
  logger.info(`NOTIFICATION DISPATCHED: [${notification.severity}] ${notification.title} - ${notification.message}`);

  // Push to Redis list
  try {
    await redis.lpush('notifications:recent', JSON.stringify(notification));
    await redis.ltrim('notifications:recent', 0, 49); // Keep latest 50
  } catch (err) {
    logger.error(`Redis lpush failed: ${err.message}`);
  }

  // Publish to notification-events topic
  if (kafkaProducer) {
    try {
      await kafkaProducer.send(TOPICS.NOTIFICATION_EVENTS, notification);
    } catch (err) {
      logger.error(`Kafka publish notification failed: ${err.message}`);
    }
  }
};

const handleKafkaEvent = async (topic, message) => {
  if (topic === TOPICS.INCIDENT_EVENTS) {
    if (message.eventType === 'INCIDENT_CREATED') {
      const inc = message.incident;
      await sendNotification({
        id: `notif-${Date.now()}`,
        type: 'INCIDENT_ALERT',
        title: `🚨 Incident Created: ${inc.serviceName}`,
        message: `${inc.type} detected on ${inc.serviceName}. Severity: ${inc.severity}. Status: ${inc.status}`,
        severity: inc.severity,
        service: inc.serviceName,
        timestamp: new Date().toISOString()
      });
    } else if (message.eventType === 'INCIDENT_RESOLVED') {
      const inc = message.incident;
      await sendNotification({
        id: `notif-${Date.now()}`,
        type: 'INCIDENT_RESOLVED',
        title: `✅ Incident Resolved: ${inc.serviceName}`,
        message: `Service ${inc.serviceName} has fully recovered. Incident status marked RESOLVED.`,
        severity: 'LOW',
        service: inc.serviceName,
        timestamp: new Date().toISOString()
      });
    }
  } else if (topic === TOPICS.RECOVERY_EVENTS) {
    if (message.eventType === 'RECOVERY_ATTEMPT_STARTED') {
      await sendNotification({
        id: `notif-${Date.now()}`,
        type: 'RECOVERY_PROGRESS',
        title: `🔄 Recovery Started: ${message.service}`,
        message: `Automated recovery attempt ${message.attempt}/${message.maxAttempts} initiated for ${message.service}`,
        severity: 'MEDIUM',
        service: message.service,
        timestamp: new Date().toISOString()
      });
    }
  }
};

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'UP', service: SERVICE_NAME }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get('/notifications', async (req, res) => {
  try {
    const raw = await redis.lrange('notifications:recent', 0, 49);
    const notifications = raw.map(item => JSON.parse(item));
    return res.json({ notifications });
  } catch (err) {
    return res.status(503).json({ error: `Redis dependency unavailable: ${err.message}` });
  }
});

const start = async () => {
  try {
    kafkaProducer = await createProducer(logger);
    await createConsumer('notification-service-group', [TOPICS.INCIDENT_EVENTS, TOPICS.RECOVERY_EVENTS], handleKafkaEvent, logger);
  } catch (err) {
    logger.warn(`Kafka consumer/producer init in notification service error: ${err.message}`);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} running on port ${PORT}`);
  });
};

start();
