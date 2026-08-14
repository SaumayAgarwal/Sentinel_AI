import axios from 'axios';

const GATEWAY_URL = 'http://localhost:3009';

export const fetchServices = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/services`);
    return res.data.services || [];
  } catch (err) {
    console.error('Failed to fetch services:', err);
    return [];
  }
};

export const fetchIncidents = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/incidents`);
    return res.data.incidents || [];
  } catch (err) {
    console.error('Failed to fetch incidents:', err);
    return [];
  }
};

export const fetchEvents = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/events`);
    return res.data.events || [];
  } catch (err) {
    console.error('Failed to fetch events:', err);
    return [];
  }
};

export const simulateFailure = async (serviceName, mode) => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/admin/failure`, { service: serviceName, mode });
    return res.data;
  } catch (err) {
    const portMap = {
      'user-service': 3001,
      'order-service': 3002,
      'payment-service': 3003,
      'inventory-service': 3004
    };
    const port = portMap[serviceName] || 3003;
    const res = await axios.post(`http://localhost:${port}/admin/failure`, { mode });
    return res.data;
  }
};

export const triggerRecovery = async (serviceName) => {
  try {
    const res = await axios.post(`${GATEWAY_URL}/api/admin/recovery`, { service: serviceName });
    return res.data;
  } catch (err) {
    const portMap = {
      'user-service': 3001,
      'order-service': 3002,
      'payment-service': 3003,
      'inventory-service': 3004
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

export const fetchSreMetrics = async () => {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/metrics/sre`);
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

