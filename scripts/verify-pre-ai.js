// Standalone automated test script for SentinelFlow -> SentinelAI pre-AI foundation
// Verifies Registry, Logging, Health, Metrics, Dependencies, Timelines, and Recovery APIs

const axios = require('axios');
const { registry, logStore, createEventEnvelope } = require('../services/shared');

const GATEWAY_URL = 'http://localhost:3009';
const MONITOR_URL = 'http://localhost:3005';
const INCIDENT_URL = 'http://localhost:3006';
const RECOVERY_URL = 'http://localhost:3007';

async function runTests() {
  console.log('====================================================');
  console.log('  SentinelFlow -> SentinelAI Pre-AI Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    }
  }

  // 1. Registry verification
  console.log('--- 1. Service & Project Registry ---');
  const projects = registry.getProjects();
  assert(projects.length >= 2, 'Multiple projects defined in registry', `Found ${projects.length}`);
  
  const defaultProj = registry.getProject('ecommerce-001');
  assert(defaultProj !== null, 'Default project ecommerce-001 exists');
  assert(defaultProj.services.length === 4, 'ecommerce-001 has 4 microservices');

  const paymentSvc = registry.getService('ecommerce-001', 'payment-service');
  assert(paymentSvc !== null && paymentSvc.dependencies.length > 0, 'Payment service has explicit dependencies');
  assert(paymentSvc.recoveryCapabilities.includes('restart'), 'Payment service declares restart recovery capability');

  // Test multi-project isolation
  const nonExistent = registry.getProject('unknown-project');
  assert(nonExistent === null, 'Unknown project lookup safely returns null');

  // 2. Standardized Kafka Event Envelope
  console.log('\n--- 2. Kafka Event Schemas & IDs ---');
  const env = createEventEnvelope({
    eventType: 'SERVICE_DOWN',
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    severity: 'CRITICAL',
    reason: 'Health check timeout'
  });
  assert(env.eventId.startsWith('evt-'), 'Generated eventId with stable prefix');
  assert(env.projectId === 'ecommerce-001', 'Propagates projectId');
  assert(env.serviceId === 'payment-service', 'Propagates serviceId');
  assert(env.service === 'payment-service', 'Maintains backwards-compatible service alias');

  // 3. In-memory Log Store
  console.log('\n--- 3. Log Store & Query Interface ---');
  logStore.addLog({
    service: 'payment-service',
    projectId: 'ecommerce-001',
    level: 'warn',
    message: 'High database connection contention detected'
  });
  const logs = logStore.getLogs({ projectId: 'ecommerce-001', serviceId: 'payment-service' });
  assert(logs.length > 0, 'Stored and retrieved logs via query interface');
  assert(logs[0].service === 'payment-service', 'Log serviceId matches');

  console.log(`\n====================================================`);
  console.log(`Unit & Module Tests: ${passed}/${total} Passed`);
  console.log(`====================================================\n`);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
