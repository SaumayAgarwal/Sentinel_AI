const path = require('path');
const { spawn } = require('child_process');

const SERVICES = [
  { name: 'USER', script: 'services/user-service/index.js', color: '\x1b[36m' },
  { name: 'ORDER', script: 'services/order-service/index.js', color: '\x1b[34m' },
  { name: 'PAYMENT', script: 'services/payment-service/index.js', color: '\x1b[35m' },
  { name: 'INVENTORY', script: 'services/inventory-service/index.js', color: '\x1b[33m' },
  { name: 'BANKING', script: 'services/banking-services/index.js', color: '\x1b[92m' },
  { name: 'MONITOR', script: 'services/monitoring-service/index.js', color: '\x1b[31m' },
  { name: 'INCIDENT', script: 'services/incident-service/index.js', color: '\x1b[32m' },
  { name: 'RECOVERY', script: 'services/recovery-service/index.js', color: '\x1b[35m' },
  { name: 'NOTIF', script: 'services/notification-service/index.js', color: '\x1b[90m' },
  { name: 'GATEWAY', script: 'services/websocket-gateway/index.js', color: '\x1b[33m' },
  { name: 'AI', script: 'services/sentinel-ai/server.js', color: '\x1b[45m\x1b[37m' }
];

const RESET = '\x1b[0m';
const rootDir = path.resolve(__dirname, '..');
const children = [];

const gatewayPort = process.env.PORT || process.env.PORT_GATEWAY || '3009';

console.log(`?? Starting SentinelAI Backend Services in Production (Gateway Port: ${gatewayPort})...`);

SERVICES.forEach(svc => {
  const fullPath = path.join(rootDir, svc.script);
  
  // Create process-specific env
  const childEnv = {
    ...process.env,
    PORT_GATEWAY: gatewayPort
  };

  // Only the GATEWAY service should use Railway's public PORT
  if (svc.name !== 'GATEWAY') {
    delete childEnv.PORT;
  }

  const child = spawn(process.execPath, [fullPath], {
    cwd: rootDir,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  const prefix = `${svc.color}[${svc.name}]${RESET} `;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    lines.forEach(line => console.log(`${prefix}${line}`));
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    lines.forEach(line => console.error(`${prefix}${line}`));
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix}Process exited with code ${code}`);
    }
  });

  children.push(child);
});

const cleanup = () => {
  console.log('\n?? Shutting down all microservices...');
  children.forEach(child => {
    try {
      child.kill('SIGTERM');
    } catch (e) {}
  });
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
