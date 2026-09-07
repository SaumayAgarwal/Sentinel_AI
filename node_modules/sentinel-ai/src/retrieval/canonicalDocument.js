/**
 * Canonical Document Builder & Query Representation Generator for SentinelAI RAG V2
 * Ensures standard, structured semantic representations of incidents for vector embedding.
 */

/**
 * Builds standard canonical text representation of a historical resolved incident.
 * This document text is what gets embedded and stored in PostgreSQL pgvector.
 * 
 * @param {Object} incident
 * @returns {string} Canonical document string
 */
function buildCanonicalDocument(incident = {}) {
  const projectId = incident.projectId || 'ecommerce-001';
  const serviceId = incident.serviceId || 'unknown';
  const severity = incident.severity || 'UNKNOWN';
  const type = incident.type || 'UNKNOWN';
  const reason = incident.reason || 'None provided';

  // Extract root cause from previous investigations or timeline if available
  let rootCause = incident.rootCause || incident.diagnosis || 'Unspecified';
  if (!incident.rootCause && Array.isArray(incident.timeline)) {
    const rcaEvent = incident.timeline.find(e => e.event === 'DIAGNOSED' || e.event === 'RCA_COMPLETED');
    if (rcaEvent && rcaEvent.details) {
      rootCause = rcaEvent.details;
    }
  }

  // Extract effective recovery action
  let effectiveRecoveryAction = incident.effectiveRecoveryAction || incident.actionType || 'NONE';
  if (!incident.effectiveRecoveryAction && Array.isArray(incident.recoveryActions)) {
    const successAction = incident.recoveryActions.find(a => a.status === 'SUCCESS');
    if (successAction) {
      effectiveRecoveryAction = successAction.actionType;
    }
  }

  const recoveryResult = incident.status === 'RESOLVED' ? 'SUCCESS' : (incident.status || 'UNKNOWN');

  return [
    `Project: ${projectId}`,
    `Service: ${serviceId}`,
    `Severity: ${severity}`,
    `Failure: ${type}`,
    `Reason: ${reason}`,
    `Root Cause: ${rootCause}`,
    `Recovery Action: ${effectiveRecoveryAction}`,
    `Recovery Result: ${recoveryResult}`
  ].join('\n');
}

/**
 * Builds a natural language retrieval query from an active/investigating incident and its live telemetry evidence.
 * 
 * @param {Object} incident
 * @param {Object} evidence
 * @returns {string} Semantic retrieval query string
 */
function buildRetrievalQuery(incident = {}, evidence = {}) {
  const parts = [];

  const projectId = incident.projectId || 'ecommerce-001';
  const serviceId = incident.serviceId || 'unknown';
  const type = incident.type || 'UNKNOWN';
  const severity = incident.severity || 'UNKNOWN';
  const reason = incident.reason || '';

  parts.push(`Incident in project ${projectId} for service ${serviceId}.`);
  parts.push(`Failure mode: ${type}, Severity: ${severity}.`);
  if (reason) {
    parts.push(`Observed reason: ${reason}.`);
  }

  // Incorporate live health facts
  if (evidence.health) {
    const h = evidence.health;
    parts.push(`Live health status is ${h.status || 'UNKNOWN'}.`);
    if (h.failureType) parts.push(`Health failure type: ${h.failureType}.`);
    if (h.responseTime) parts.push(`Response latency: ${h.responseTime}ms.`);
  }

  // Incorporate failed or degraded dependencies
  if (Array.isArray(evidence.dependencies) && evidence.dependencies.length > 0) {
    const downDeps = evidence.dependencies.filter(d => d.status === 'DOWN' || d.status === 'DEGRADED');
    if (downDeps.length > 0) {
      const depDesc = downDeps.map(d => `${d.serviceId} (${d.role || d.type || 'dependency'}) is ${d.status}`).join(', ');
      parts.push(`Degraded dependencies: ${depDesc}.`);
    }
  }

  // Incorporate recent error log snippets
  if (Array.isArray(evidence.logs) && evidence.logs.length > 0) {
    const errorLogs = evidence.logs
      .filter(l => l.level === 'error')
      .slice(0, 3)
      .map(l => l.message)
      .join(' | ');
    if (errorLogs) {
      parts.push(`Recent error logs: ${errorLogs}.`);
    }
  }

  return parts.join(' ');
}

module.exports = {
  buildCanonicalDocument,
  buildRetrievalQuery
};
