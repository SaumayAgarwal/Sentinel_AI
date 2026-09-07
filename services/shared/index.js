const createLogger = require('./src/logger');
const { kafka, TOPICS, initTopics, createProducer, createConsumer, retryWithBackoff, createEventEnvelope } = require('./src/kafkaClient');
const createRedisClient = require('./src/redisClient');
const metrics = require('./src/metrics');
const createMiddleware = require('./src/middleware');
const registry = require('./src/registry');
const logStore = require('./src/logStore');

module.exports = {
  createLogger,
  kafka,
  TOPICS,
  initTopics,
  createProducer,
  createConsumer,
  retryWithBackoff,
  createEventEnvelope,
  createRedisClient,
  metrics,
  createMiddleware,
  registry,
  logStore
};
