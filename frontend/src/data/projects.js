// Central Project Registry for SentinelAI Frontend
// Single source of truth for projects, environments, and frontend project contexts.

export const PROJECTS = [
  {
    id: 'ecommerce-001',
    name: 'E-Commerce Platform',
    environments: ['Production', 'Staging'],
    defaultEnvironment: 'Production',
    description: 'Core e-commerce distributed microservices (User, Order, Payment, Inventory)',
    isMonitoredLive: true // Backed by live Docker microservice cluster & Kafka
  },
  {
    id: 'banking-001',
    name: 'Banking Platform',
    environments: ['Production', 'Staging'],
    defaultEnvironment: 'Production',
    description: 'High-security financial transaction & ledger ecosystem',
    isMonitoredLive: true // Backed by live banking microservice cluster (ports 3021-3025)
  }
];

export const DEFAULT_PROJECT_ID = 'ecommerce-001';

export const getProjectById = (id) => {
  return PROJECTS.find(p => p.id === id) || PROJECTS[0];
};

// Scoped state for mock/demonstration projects (e.g. banking-001)
// Note: Telemetry is not faked; unmonitored projects display authentic empty state (NO SERVICES, NO INCIDENTS, NO EVENTS)
export const BANKING_PROJECT_DATA = {
  services: [],
  incidents: [],
  events: [],
  sreMetrics: {
    mttdSeconds: 0,
    mttrSeconds: 0,
    availabilityPercent: 100.0,
    recoverySuccessRatePercent: 100.0,
    totalIncidents: 0,
    resolvedIncidents: 0
  },
  infraStatus: {
    postgres: 'DISCONNECTED',
    redis: 'DISCONNECTED',
    kafka: 'DISCONNECTED'
  }
};
