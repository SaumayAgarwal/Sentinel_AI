require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const net = require('net');
const Redis = require('ioredis');
const { Kafka, logLevel } = require('kafkajs');

const SERVICES = [
  { name: 'User Service', port: 3001 },
  { name: 'Order Service', port: 3002 },
  { name: 'Payment Service', port: 3003 },
  { name: 'Inventory Service', port: 3004 },
  { name: 'Monitoring Service', port: 3005 },
  { name: 'Incident Service', port: 3006 },
  { name: 'Recovery Service', port: 3007 },
  { name: 'Notification Service', port: 3008 },
  { name: 'WebSocket Gateway', port: 3009 }
];

const checkPort = (host, port, timeout = 2000) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
};

async function runHealthCheck() {
  console.log('=== SentinelFlow Infrastructure Check ===\n');

  // 1. PostgreSQL Check
  let pgStatus = 'OFFLINE';
  try {
    const isOpen = await checkPort('127.0.0.1', 5432);
    if (isOpen) pgStatus = 'CONNECTED';
  } catch (e) {}
  console.log(`PostgreSQL: ${pgStatus}`);

  // 2. Redis Check
  let redisStatus = 'OFFLINE';
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const redis = new Redis(redisUrl, { connectTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
    redis.on('error', () => {}); // Catch offline error quietly
    await redis.ping();
    await redis.quit();
    redisStatus = 'CONNECTED';
  } catch (e) {}
  console.log(`Redis: ${redisStatus}`);

  // 3. Kafka Check
  let kafkaStatus = 'OFFLINE';
  try {
    const broker = process.env.KAFKA_BROKER || '127.0.0.1:9092';
    const kafka = new Kafka({
      clientId: 'sentinelflow-infra-check',
      brokers: [broker],
      logLevel: logLevel.NOTHING,
      connectionTimeout: 2000,
      retry: { retries: 0 }
    });
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    kafkaStatus = 'CONNECTED';
  } catch (e) {}
  console.log(`Kafka: ${kafkaStatus}`);

  console.log('\n=== SentinelFlow Services Health Check ===\n');

  SERVICES.forEach(svc => {
    const req = http.get(`http://localhost:${svc.port}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`✅ [${svc.name.padEnd(20)}] Port ${svc.port} - Status ${res.statusCode} ${data}`);
      });
    });

    req.on('error', (err) => {
      console.log(`❌ [${svc.name.padEnd(20)}] Port ${svc.port} - OFFLINE (${err.message})`);
    });
  });
}

runHealthCheck();
