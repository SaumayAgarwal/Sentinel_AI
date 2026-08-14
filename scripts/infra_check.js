// infra_check.js – verifies PostgreSQL, Redis, and Kafka connectivity
// Run with `node scripts/infra_check.js`

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const net = require('net');
const Redis = require('ioredis');
const { Kafka, logLevel } = require('kafkajs');

const checkPort = (host, port, timeout = 2000) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
};

async function checkPostgres() {
  const isOpen = await checkPort('127.0.0.1', 5432);
  if (isOpen) {
    console.log('PostgreSQL: CONNECTED');
  } else {
    console.error('PostgreSQL: NOT CONNECTED (localhost:5432 unreachable)');
  }
}

async function checkRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redis = new Redis(redisUrl, { connectTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => {});
  try {
    await redis.ping();
    await redis.quit();
    console.log('Redis: CONNECTED');
  } catch (e) {
    console.error('Redis: NOT CONNECTED –', e.message);
  }
}

async function checkKafka() {
  const broker = process.env.KAFKA_BROKER || '127.0.0.1:9092';
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'sentinelflow-check',
    brokers: [broker],
    logLevel: logLevel.NOTHING,
    connectionTimeout: 2000,
    retry: { retries: 0 }
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    console.log('Kafka: CONNECTED');
  } catch (e) {
    console.error('Kafka: NOT CONNECTED –', e.message);
  }
}

(async () => {
  await checkPostgres();
  await checkRedis();
  await checkKafka();
})();
