const Redis = require('ioredis');

const createRedisClient = (logger) => {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let loggedError = false;

  const redis = new Redis(redisUrl, {
    retryStrategy(times) {
      if (times >= 5) {
        if (!loggedError && logger) {
          logger.error(`❌ Redis is UNAVAILABLE on ${redisUrl}. Please ensure Docker container 'sentinelflow-redis' is running.`);
          loggedError = true;
        }
        return null; // Stop retrying after 5 attempts
      }
      return 1000;
    },
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 5000
  });

  redis.on('connect', () => {
    loggedError = false;
    if (logger) logger.info('Redis: CONNECTED');
  });

  redis.on('error', (err) => {
    if (!loggedError && logger) {
      logger.error(`❌ Redis connection error on ${redisUrl}: ${err.message}`);
      loggedError = true;
    }
  });

  return redis;
};

module.exports = createRedisClient;
