const { Kafka, logLevel } = require('kafkajs');

const broker = process.env.KAFKA_BROKER || '127.0.0.1:9092';
const clientId = process.env.KAFKA_CLIENT_ID || 'sentinelflow';

const kafka = new Kafka({
  clientId,
  brokers: [broker],
  logLevel: logLevel.NOTHING,
  connectionTimeout: 5000,
  authenticationTimeout: 5000,
  requestTimeout: 10000,
  retry: {
    initialRetryTime: 500,
    retries: 5
  }
});

const TOPICS = {
  SERVICE_EVENTS: 'service-events',
  INCIDENT_EVENTS: 'incident-events',
  RECOVERY_EVENTS: 'recovery-events',
  NOTIFICATION_EVENTS: 'notification-events',
  DLQ_EVENTS: 'incident-events.DLQ'
};

// Exponential backoff retry helper for consumer processing failures
// Delays: 1s, 2s, 4s (3 retries max)
const retryWithBackoff = async (fn, maxRetries, logger, eventId) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    try {
      await fn(attempt);
      return { success: true, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (logger) logger.warn(`[DLQ] Event ${eventId} retry #${attempt} failed: ${err.message} (next backoff: ${delayMs * 2}ms)`);
    }
  }
  return { success: false, attempts: maxRetries, error: lastError };
};

const initTopics = async (logger) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const requiredTopics = Object.values(TOPICS);
    const topicsToCreate = requiredTopics
      .filter(t => !existingTopics.includes(t))
      .map(t => ({ topic: t, numPartitions: 1, replicationFactor: 1 }));

    if (topicsToCreate.length > 0) {
      await admin.createTopics({ topics: topicsToCreate });
      if (logger) logger.info('Kafka topics created successfully', { topics: topicsToCreate.map(t => t.topic) });
    }
    if (logger) logger.info('Kafka: CONNECTED');
  } catch (err) {
    if (logger) logger.error(`❌ Kafka is UNAVAILABLE on ${broker}: ${err.message}. Please ensure Docker container 'sentinelflow-kafka' is running.`);
    throw err;
  } finally {
    try { await admin.disconnect(); } catch (e) {}
  }
};

const createProducer = async (logger) => {
  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: false
  });
  await producer.connect();
  if (logger) logger.info('Kafka Producer: CONNECTED');
  return {
    send: async (topic, message) => {
      const payload = {
        value: JSON.stringify({
          ...message,
          timestamp: message.timestamp || new Date().toISOString()
        })
      };
      return await producer.send({ topic, messages: [payload] });
    },
    disconnect: () => producer.disconnect()
  };
};

const createConsumer = async (groupId, topics, onMessage, logger) => {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  if (logger) logger.info(`Kafka Consumer [${groupId}]: CONNECTED`);

  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const value = JSON.parse(message.value.toString());
        await onMessage(topic, value);
      } catch (err) {
        if (logger) logger.error(`Error processing Kafka message on topic ${topic}`, { error: err.message });
      }
    }
  });

  return consumer;
};

module.exports = {
  kafka,
  TOPICS,
  initTopics,
  createProducer,
  createConsumer,
  retryWithBackoff
};

