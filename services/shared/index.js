const createLogger = require('./src/logger');
const { kafka, TOPICS, initTopics, createProducer, createConsumer, retryWithBackoff } = require('./src/kafkaClient');
const createRedisClient = require('./src/redisClient');
const metrics = require('./src/metrics');
const createMiddleware = require('./src/middleware');

module.exports = {
  createLogger,
  kafka,
  TOPICS,
  initTopics,
  createProducer,
  createConsumer,
  retryWithBackoff,
  createRedisClient,
  metrics,
  createMiddleware
};

