// Project & Service Registry for SentinelFlow / SentinelAI
// Provides multi-tenant project configuration, service descriptors, dependencies, and recovery capabilities.

const DEFAULT_PROJECT_ID = 'ecommerce-001';

const projects = {
  'ecommerce-001': {
    id: 'ecommerce-001',
    name: 'E-Commerce Core Platform',
    description: 'Primary e-commerce production microservice ecosystem',
    environment: 'production',
    createdAt: '2026-01-01T00:00:00.000Z',
    services: [
      {
        projectId: 'ecommerce-001',
        serviceId: 'user-service',
        name: 'User Service',
        port: parseInt(process.env.PORT_USER || '3001', 10),
        healthUrl: `http://localhost:${process.env.PORT_USER || 3001}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_USER || 3001}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'User accounts & profiles database' },
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Session store & authentication token cache' }
        ],
        recoveryCapabilities: ['restart', 'clear-cache']
      },
      {
        projectId: 'ecommerce-001',
        serviceId: 'order-service',
        name: 'Order Service',
        port: parseInt(process.env.PORT_ORDER || '3002', 10),
        healthUrl: `http://localhost:${process.env.PORT_ORDER || 3002}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_ORDER || 3002}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'Orders persistent ledger' },
          { serviceId: 'user-service', type: 'INTERNAL_SERVICE', role: 'Customer identity verification' },
          { serviceId: 'payment-service', type: 'INTERNAL_SERVICE', role: 'Payment transaction settlement' }
        ],
        recoveryCapabilities: ['restart']
      },
      {
        projectId: 'ecommerce-001',
        serviceId: 'payment-service',
        name: 'Payment Service',
        port: parseInt(process.env.PORT_PAYMENT || '3003', 10),
        healthUrl: `http://localhost:${process.env.PORT_PAYMENT || 3003}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_PAYMENT || 3003}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'Payment ledgers & transaction audit trail' },
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Payment idempotency key cache' }
        ],
        recoveryCapabilities: ['restart', 'clear-cache']
      },
      {
        projectId: 'ecommerce-001',
        serviceId: 'inventory-service',
        name: 'Inventory Service',
        port: parseInt(process.env.PORT_INVENTORY || '3004', 10),
        healthUrl: `http://localhost:${process.env.PORT_INVENTORY || 3004}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_INVENTORY || 3004}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'Inventory SKU database' },
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Stock reservation locks' }
        ],
        recoveryCapabilities: ['restart']
      }
    ]
  },
  'banking-001': {
    id: 'banking-001',
    name: 'Banking Platform',
    description: 'High-security core financial transaction and ledger ecosystem',
    environment: 'production',
    createdAt: '2026-02-15T00:00:00.000Z',
    services: [
      {
        projectId: 'banking-001',
        serviceId: 'auth-service',
        name: 'Authentication & Session Service',
        port: parseInt(process.env.PORT_BANKING_AUTH || '3021', 10),
        healthUrl: `http://localhost:${process.env.PORT_BANKING_AUTH || 3021}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_BANKING_AUTH || 3021}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Token blacklisting & OAuth session cache' },
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'User identity & credential store' }
        ],
        recoveryCapabilities: ['restart', 'clear-cache']
      },
      {
        projectId: 'banking-001',
        serviceId: 'account-service',
        name: 'Account & Balance Ledger',
        port: parseInt(process.env.PORT_BANKING_ACCOUNT || '3022', 10),
        healthUrl: `http://localhost:${process.env.PORT_BANKING_ACCOUNT || 3022}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_BANKING_ACCOUNT || 3022}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'auth-service', type: 'INTERNAL_SERVICE', role: 'Identity token validation' },
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'Immutable double-entry account ledger' }
        ],
        recoveryCapabilities: ['restart']
      },
      {
        projectId: 'banking-001',
        serviceId: 'transaction-service',
        name: 'Transaction Settlement Service',
        port: parseInt(process.env.PORT_BANKING_TRANSACTION || '3023', 10),
        healthUrl: `http://localhost:${process.env.PORT_BANKING_TRANSACTION || 3023}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_BANKING_TRANSACTION || 3023}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'account-service', type: 'INTERNAL_SERVICE', role: 'Sufficient funds & balance deduction' },
          { serviceId: 'fraud-detection-service', type: 'INTERNAL_SERVICE', role: 'Real-time transaction risk scoring' },
          { serviceId: 'notification-service', type: 'INTERNAL_SERVICE', role: 'Customer transaction alerts' }
        ],
        recoveryCapabilities: ['restart']
      },
      {
        projectId: 'banking-001',
        serviceId: 'fraud-detection-service',
        name: 'AI Fraud Detection Engine',
        port: parseInt(process.env.PORT_BANKING_FRAUD || '3024', 10),
        healthUrl: `http://localhost:${process.env.PORT_BANKING_FRAUD || 3024}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_BANKING_FRAUD || 3024}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Velocity check & anomaly rate limit cache' }
        ],
        recoveryCapabilities: ['restart', 'clear-cache']
      },
      {
        projectId: 'banking-001',
        serviceId: 'notification-service',
        name: 'Banking Alert Notification Service',
        port: parseInt(process.env.PORT_BANKING_NOTIFICATION || '3025', 10),
        healthUrl: `http://localhost:${process.env.PORT_BANKING_NOTIFICATION || 3025}/health`,
        metricsUrl: `http://localhost:${process.env.PORT_BANKING_NOTIFICATION || 3025}/metrics`,
        healthInterval: 2000,
        failureThreshold: 2,
        latencyThreshold: 2000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'postgres', type: 'INFRASTRUCTURE', role: 'Notification delivery audit log' }
        ],
        recoveryCapabilities: ['restart']
      }
    ]
  },
  'logistics-002': {
    id: 'logistics-002',
    name: 'Global Logistics Network',
    description: 'Fulfillment and shipping logistics cluster',
    environment: 'staging',
    createdAt: '2026-02-01T00:00:00.000Z',
    services: [
      {
        projectId: 'logistics-002',
        serviceId: 'tracking-service',
        name: 'Fleet Tracking Service',
        port: 3010,
        healthUrl: 'http://localhost:3010/health',
        metricsUrl: 'http://localhost:3010/metrics',
        healthInterval: 5000,
        failureThreshold: 3,
        latencyThreshold: 3000,
        errorRateThreshold: 5,
        dependencies: [
          { serviceId: 'redis', type: 'INFRASTRUCTURE', role: 'Live GPS location feed cache' }
        ],
        recoveryCapabilities: ['restart']
      }
    ]
  }
};

const getProjects = () => {
  return Object.values(projects).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    environment: p.environment,
    serviceCount: p.services.length,
    createdAt: p.createdAt
  }));
};

const getProject = (projectId = DEFAULT_PROJECT_ID) => {
  return projects[projectId] || null;
};

const getServices = (projectId = DEFAULT_PROJECT_ID) => {
  const project = getProject(projectId);
  return project ? project.services : [];
};

const getService = (projectId = DEFAULT_PROJECT_ID, serviceId) => {
  const services = getServices(projectId);
  return services.find(s => s.serviceId === serviceId || s.name === serviceId) || null;
};

const getDependencies = (projectId = DEFAULT_PROJECT_ID, serviceId) => {
  const service = getService(projectId, serviceId);
  if (!service) return null;
  return {
    projectId,
    serviceId: service.serviceId,
    dependencies: service.dependencies || []
  };
};

const getRecoveryCapabilities = (projectId = DEFAULT_PROJECT_ID, serviceId) => {
  const service = getService(projectId, serviceId);
  if (!service) return null;
  return {
    projectId,
    serviceId: service.serviceId,
    recoveryCapabilities: service.recoveryCapabilities || []
  };
};

module.exports = {
  DEFAULT_PROJECT_ID,
  getProjects,
  getProject,
  getServices,
  getService,
  getDependencies,
  getRecoveryCapabilities
};
