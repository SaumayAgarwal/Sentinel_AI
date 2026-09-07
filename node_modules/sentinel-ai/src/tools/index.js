// Deterministic Tool Layer for SentinelAI
// Directly accesses SentinelFlow APIs without invoking any LLM.

const axios = require('axios');
const { registry } = require('@sentinelflow/shared');

const MONITORING_URL = `http://localhost:${process.env.PORT_MONITORING || 3005}`;
const INCIDENT_URL = `http://localhost:${process.env.PORT_INCIDENT || 3006}`;
const RECOVERY_URL = `http://localhost:${process.env.PORT_RECOVERY || 3007}`;
const GATEWAY_URL = `http://localhost:${process.env.PORT_GATEWAY || 3009}`;
const INTERNAL_AUTH_TOKEN = process.env.SENTINEL_INTERNAL_TOKEN || 'sentinel-ai-internal-key';

// 1. Projects
const getProjects = async () => {
  return registry.getProjects();
};

// 2. Project Services
const getProjectServices = async (projectId = 'ecommerce-001') => {
  return registry.getServices(projectId);
};

// 3. Service Health
const getServiceHealth = async (projectId = 'ecommerce-001', serviceId) => {
  try {
    const res = await axios.get(`${MONITORING_URL}/projects/${projectId}/services/${serviceId}/health`, { timeout: 3000 });
    return res.data;
  } catch (err) {
    return {
      projectId,
      serviceId,
      status: 'UNKNOWN',
      error: err.response?.data?.error || err.message
    };
  }
};

// 4. Service Metrics
const getServiceMetrics = async (projectId = 'ecommerce-001', serviceId) => {
  try {
    const res = await axios.get(`${MONITORING_URL}/projects/${projectId}/services/${serviceId}/metrics`, { timeout: 3000 });
    return res.data;
  } catch (err) {
    return {
      projectId,
      serviceId,
      error: err.response?.data?.error || err.message,
      metrics: { serviceUp: 0, errorRatePercent: 100 }
    };
  }
};

// 5. Service Logs
const getServiceLogs = async (projectId = 'ecommerce-001', serviceId, options = {}) => {
  const { from, to, level, limit = 50 } = options;
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/services/${serviceId}/logs`, {
      params: { from, to, level, limit },
      timeout: 3000
    });
    return res.data.logs || [];
  } catch (err) {
    return [];
  }
};

// 6. Service Dependencies
const getServiceDependencies = async (projectId = 'ecommerce-001', serviceId) => {
  try {
    const res = await axios.get(`${MONITORING_URL}/projects/${projectId}/services/${serviceId}/dependencies`, { timeout: 3000 });
    return res.data;
  } catch (err) {
    return {
      projectId,
      serviceId,
      dependencies: []
    };
  }
};

// 7. Get Incident
const getIncident = async (projectId = 'ecommerce-001', incidentId) => {
  try {
    const res = await axios.get(`${INCIDENT_URL}/incidents/${incidentId}`, { timeout: 3000 });
    return res.data;
  } catch (err) {
    return null;
  }
};

// 8. Incident Timeline
const getIncidentTimeline = async (incidentId) => {
  try {
    const res = await axios.get(`${INCIDENT_URL}/incidents/${incidentId}/timeline`, { timeout: 3000 });
    return res.data;
  } catch (err) {
    return null;
  }
};

// 9. Historical Incidents
const getHistoricalIncidents = async (projectId = 'ecommerce-001', options = {}) => {
  const { serviceId, limit = 10 } = options;
  try {
    const res = await axios.get(`${INCIDENT_URL}/projects/${projectId}/historical-incidents`, {
      params: { serviceId, limit },
      timeout: 3000
    });
    return res.data.historicalIncidents || [];
  } catch (err) {
    return [];
  }
};

// 9.1 Semantic Incidents Search (RAG V2 via pgvector)
const searchSemanticIncidents = async (projectId = 'ecommerce-001', options = {}) => {
  const { queryVector, serviceId, limit = 5, threshold = 0.5 } = options;
  try {
    const res = await axios.post(
      `${INCIDENT_URL}/projects/${projectId}/incidents/semantic-search`,
      { queryVector, serviceId, limit, threshold },
      { timeout: 4000 }
    );
    return res.data?.candidates || [];
  } catch (err) {
    return [];
  }
};

// 9.2 Upsert Incident Embedding (RAG V2 Indexing)
const saveIncidentEmbedding = async (projectId = 'ecommerce-001', incidentId, data = {}) => {
  const { content, embedding, embeddingModel, serviceId } = data;
  try {
    const res = await axios.post(
      `${INCIDENT_URL}/projects/${projectId}/incidents/${incidentId}/embed`,
      { content, embedding, embeddingModel, serviceId },
      { timeout: 5000 }
    );
    return res.data;
  } catch (err) {
    return null;
  }
};

// 10. Recovery Capabilities
const getRecoveryCapabilities = async (projectId = 'ecommerce-001', serviceId) => {
  return registry.getRecoveryCapabilities(projectId, serviceId) || { projectId, serviceId, recoveryCapabilities: ['restart'] };
};

// 11. Controlled Recovery Request
const requestRecovery = async (projectId = 'ecommerce-001', incidentId, serviceId, actionType = 'RESTART') => {
  try {
    const res = await axios.post(
      `${RECOVERY_URL}/projects/${projectId}/incidents/${incidentId}/recovery`,
      {
        serviceId,
        actionType,
        requestedBy: 'AI_AGENT'
      },
      {
        headers: {
          'x-sentinel-auth': INTERNAL_AUTH_TOKEN
        },
        timeout: 5000
      }
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.error || err.message);
  }
};

// Tool definitions for LLM function calling
const toolDefinitions = [
  {
    name: 'get_service_health',
    description: 'Get current real-time health status and dependency health of a service.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (default: ecommerce-001)' },
        serviceId: { type: 'string', description: 'Target service identifier (e.g. payment-service)' }
      },
      required: ['serviceId']
    },
    execute: async (args) => getServiceHealth(args.projectId || 'ecommerce-001', args.serviceId)
  },
  {
    name: 'get_service_dependencies',
    description: 'Get explicit declared architecture dependencies (databases, internal services) and their statuses.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (default: ecommerce-001)' },
        serviceId: { type: 'string', description: 'Target service identifier' }
      },
      required: ['serviceId']
    },
    execute: async (args) => getServiceDependencies(args.projectId || 'ecommerce-001', args.serviceId)
  },
  {
    name: 'get_service_metrics',
    description: 'Get error rate, latency P95/P99, and uptime metrics for a service.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (default: ecommerce-001)' },
        serviceId: { type: 'string', description: 'Target service identifier' }
      },
      required: ['serviceId']
    },
    execute: async (args) => getServiceMetrics(args.projectId || 'ecommerce-001', args.serviceId)
  },
  {
    name: 'get_service_logs',
    description: 'Fetch recent logs filtered by service and log level.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        serviceId: { type: 'string', description: 'Target service identifier' },
        level: { type: 'string', description: 'Log level filter (error, warn, info)' },
        limit: { type: 'number', description: 'Max logs to retrieve (default: 30)' }
      },
      required: ['serviceId']
    },
    execute: async (args) => getServiceLogs(args.projectId || 'ecommerce-001', args.serviceId, args)
  },
  {
    name: 'get_incident_timeline',
    description: 'Get ordered chronological sequence of detection, threshold, and recovery events for an incident.',
    parameters: {
      type: 'object',
      properties: {
        incidentId: { type: 'string', description: 'Incident ID' }
      },
      required: ['incidentId']
    },
    execute: async (args) => getIncidentTimeline(args.incidentId)
  },
  {
    name: 'get_recovery_capabilities',
    description: 'Check what automated recovery capabilities are declared and permitted for a service.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        serviceId: { type: 'string', description: 'Target service identifier' }
      },
      required: ['serviceId']
    },
    execute: async (args) => getRecoveryCapabilities(args.projectId || 'ecommerce-001', args.serviceId)
  },
  {
    name: 'get_historical_incidents',
    description: 'Retrieve past resolved incidents for pattern recognition and recovery effectiveness comparison.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        serviceId: { type: 'string', description: 'Target service identifier' },
        severity: { type: 'string', description: 'Severity filter (CRITICAL, HIGH, etc.)' },
        limit: { type: 'number', description: 'Maximum historical incidents to retrieve (default: 5)' }
      }
    },
    execute: async (args) => getHistoricalIncidents(args.projectId || 'ecommerce-001', args)
  },
  {
    name: 'search_semantic_incidents',
    description: 'Retrieve past resolved incidents via vector semantic search against PostgreSQL/pgvector.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        serviceId: { type: 'string', description: 'Target service identifier' },
        limit: { type: 'number', description: 'Maximum candidates (default: 5)' },
        threshold: { type: 'number', description: 'Minimum cosine similarity threshold (default: 0.5)' }
      }
    },
    execute: async (args) => searchSemanticIncidents(args.projectId || 'ecommerce-001', args)
  }
];

module.exports = {
  getProjects,
  getProjectServices,
  getServiceHealth,
  getServiceMetrics,
  getServiceLogs,
  getServiceDependencies,
  getIncident,
  getIncidentTimeline,
  getHistoricalIncidents,
  searchSemanticIncidents,
  saveIncidentEmbedding,
  getRecoveryCapabilities,
  requestRecovery,
  toolDefinitions
};
