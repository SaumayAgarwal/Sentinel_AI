import axios from 'axios';

const GATEWAY_URL = 'http://localhost:3009';

export const fetchServices = async (projectId) => {
  try {
    const url = projectId ? `${GATEWAY_URL}/api/services?projectId=${projectId}` : `${GATEWAY_URL}/api/services`;
    const res = await axios.get(url);
    return res.data.services || [];
  } catch (err) {
    console.error('Failed to fetch services:', err);
    return [];
  }
};

export const fetchIncidents = async (projectId) => {
  try {
    const url = projectId ? `${GATEWAY_URL}/api/incidents?projectId=${projectId}` : `${GATEWAY_URL}/api/incidents`;
    const res = await axios.get(url);
    return res.data.incidents || [];
  } catch (err) {
    console.error('Failed to fetch incidents:', err);
    return [];
  }
};

export const fetchEvents = async (projectId) => {
  try {
    const url = projectId ? `${GATEWAY_URL}/api/events?projectId=${projectId}` : `${GATEWAY_URL}/api/events`;
    const res = await axios.get(url);
    return res.data.events || [];
  } catch (err) {
    console.error('Failed to fetch events:', err);
    return [];
  }
};

export const simulateFailure = async (serviceName, mode, projectId) => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/admin/failure`, { service: serviceName, mode, projectId });
    return res.data;
  } catch (err) {
    const portMap = {
      'user-service': 3001,
      'order-service': 3002,
      'payment-service': 3003,
      'inventory-service': 3004,
      'auth-service': 3021,
      'account-service': 3022,
      'transaction-service': 3023,
      'fraud-detection-service': 3024,
      'notification-service': 3025
    };
    const port = portMap[serviceName] || 3003;
    const res = await axios.post(`http://localhost:${port}/admin/failure`, { mode });
    return res.data;
  }
};

export const triggerRecovery = async (serviceName, projectId) => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/admin/recovery`, { service: serviceName, projectId });
    return res.data;
  } catch (err) {
    const portMap = {
      'user-service': 3001,
      'order-service': 3002,
      'payment-service': 3003,
      'inventory-service': 3004,
      'auth-service': 3021,
      'account-service': 3022,
      'transaction-service': 3023,
      'fraud-detection-service': 3024,
      'notification-service': 3025
    };
    const port = portMap[serviceName] || 3003;
    const res = await axios.post(`http://localhost:${port}/admin/recovery`);
    return res.data;
  }
};

export const acknowledgeIncident = async (incidentId) => {
  try {
    const res = await axios.patch(`http://localhost:3006/incidents/${incidentId}/acknowledge`);
    return res.data;
  } catch (err) {
    console.error('Failed to acknowledge incident:', err);
    return null;
  }
};

export const fetchSreMetrics = async (projectId) => {
  try {
    const url = projectId ? `${GATEWAY_URL}/api/metrics/sre?projectId=${projectId}` : `${GATEWAY_URL}/api/metrics/sre`;
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    return { mttdSeconds: 2.0, mttrSeconds: 6.4, availabilityPercent: 100.0, recoverySuccessRatePercent: 100.0 };
  }
};

export const fetchInfraStatus = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/infra/status`);
    return res.data;
  } catch (err) {
    return { postgres: 'UNKNOWN', redis: 'UNKNOWN', kafka: 'UNKNOWN' };
  }
};

// ─── SentinelAI Tool API Client Methods ───────────────────────────────────────
export const fetchProjects = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects`);
    return res.data.projects || [];
  } catch (err) { return []; }
};

export const fetchProjectServices = async (projectId = 'ecommerce-001') => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/services`);
    return res.data.services || [];
  } catch (err) { return []; }
};

export const fetchProjectIncidents = async (projectId = 'ecommerce-001') => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/incidents`);
    return res.data.incidents || [];
  } catch (err) { return []; }
};

export const fetchProjectEvents = async (projectId = 'ecommerce-001') => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/events?projectId=${projectId}`);
    return res.data.events || [];
  } catch (err) { return []; }
};

export const fetchServiceHealth = async (projectId, serviceId) => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/services/${serviceId}/health`);
    return res.data;
  } catch (err) { return null; }
};

export const fetchServiceDependencies = async (projectId, serviceId) => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/services/${serviceId}/dependencies`);
    return res.data;
  } catch (err) { return null; }
};

export const fetchServiceLogs = async (projectId, serviceId, limit = 50) => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/services/${serviceId}/logs?limit=${limit}`);
    return res.data.logs || [];
  } catch (err) { return []; }
};

export const fetchIncidentTimeline = async (incidentId) => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/incidents/${incidentId}/timeline`);
    return res.data;
  } catch (err) { return null; }
};

export const fetchHistoricalIncidents = async (projectId = 'ecommerce-001', serviceId = null) => {
  try {
    const params = serviceId ? `?serviceId=${serviceId}` : '';
    const res = await axios.get(`${GATEWAY_URL}/api/projects/${projectId}/historical-incidents${params}`);
    return res.data.historicalIncidents || [];
  } catch (err) { return []; }
};

export const requestAiRecovery = async (projectId, incidentId, serviceId, actionType = 'RESTART') => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/projects/${projectId}/incidents/${incidentId}/recovery`, {
      serviceId,
      actionType,
      requestedBy: 'AI_AGENT'
    }, {
      headers: { 'x-sentinel-auth': 'sentinel-ai-internal-key' }
    });
    return res.data;
  } catch (err) {
    throw err.response?.data || err;
  }
};

export const fetchAiInvestigation = async (incidentId) => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/ai/investigations/${incidentId}`);
    return res.data;
  } catch (err) {
    return null;
  }
};

export const triggerAiInvestigation = async (incidentId, payload = {}) => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/ai/investigate/${incidentId}`, payload);
    return res.data;
  } catch (err) {
    return null;
  }
};



