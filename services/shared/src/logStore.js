// In-memory circular log store for SentinelFlow / SentinelAI
// Collects Winston logs across services and provides filtering by service, project, level, and time window.

const MAX_LOGS = 2000;
const logsBuffer = [];

const addLog = (logEntry) => {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    timestamp: logEntry.timestamp || new Date().toISOString(),
    service: logEntry.service || 'unknown',
    projectId: logEntry.projectId || 'ecommerce-001',
    level: logEntry.level || 'info',
    message: logEntry.message || '',
    correlationId: logEntry.correlationId || null,
    meta: logEntry.meta || {}
  };

  logsBuffer.push(entry);
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }
  return entry;
};

const getLogs = (options = {}) => {
  const {
    projectId,
    serviceId,
    level,
    from,
    to,
    limit = 100
  } = options;

  let filtered = logsBuffer;

  if (projectId) {
    filtered = filtered.filter(l => l.projectId === projectId);
  }

  if (serviceId) {
    filtered = filtered.filter(l => l.service === serviceId || l.service === `${serviceId}-service`);
  }

  if (level) {
    filtered = filtered.filter(l => l.level.toLowerCase() === level.toLowerCase());
  }

  if (from) {
    const fromTime = new Date(from).getTime();
    if (!isNaN(fromTime)) {
      filtered = filtered.filter(l => new Date(l.timestamp).getTime() >= fromTime);
    }
  }

  if (to) {
    const toTime = new Date(to).getTime();
    if (!isNaN(toTime)) {
      filtered = filtered.filter(l => new Date(l.timestamp).getTime() <= toTime);
    }
  }

  // Return the most recent matching logs, reversed for newest first
  return filtered.slice(-Math.min(limit, 500)).reverse();
};

const clearLogs = () => {
  logsBuffer.length = 0;
};

module.exports = {
  addLog,
  getLogs,
  clearLogs
};
