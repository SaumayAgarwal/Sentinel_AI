const { buildRetrievalQuery } = require('./canonicalDocument');
const { defaultEmbeddingService } = require('../embeddings');
const tools = require('../tools');
const { createLogger } = require('@sentinelflow/shared');

const logger = createLogger('sentinel-ai-rag-v2');

/**
 * Extracts a named field value from a canonical document string.
 * Example: extractField(doc, 'Root Cause') -> 'database pool exhaustion'
 */
function extractFieldFromCanonicalDoc(doc = '', fieldName) {
  if (!doc || typeof doc !== 'string') return null;
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = doc.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Formats a semantic candidate into a compact, token-efficient historical context item.
 */
function formatSemanticHistoricalContext(candidate) {
  const content = candidate.content || '';
  const rootCause = extractFieldFromCanonicalDoc(content, 'Root Cause') || candidate.reason || 'Unspecified';
  const recoveryAction = extractFieldFromCanonicalDoc(content, 'Recovery Action') || 'RESTART';
  const recoveryResult = extractFieldFromCanonicalDoc(content, 'Recovery Result') || candidate.status || 'RESOLVED';

  return {
    incidentId: candidate.incidentId,
    serviceId: candidate.serviceId,
    type: candidate.type,
    severity: candidate.severity,
    reason: candidate.reason,
    previousRootCause: rootCause,
    effectiveRecoveryAction: recoveryAction,
    previousRecoveryStatus: recoveryResult,
    similarityScore: typeof candidate.similarityScore === 'number' ? candidate.similarityScore : 0.85,
    retrievalMode: 'semantic'
  };
}

/**
 * Executes RAG V2 semantic retrieval against PostgreSQL/pgvector.
 * 
 * @param {Object} params
 * @param {Object} params.currentIncident Active incident
 * @param {Object} params.evidence Live telemetry evidence
 * @param {string} params.projectId Multi-tenant project boundary
 * @param {string} params.serviceId Target service identifier
 * @param {number} params.limit Maximum cases to retrieve
 * @param {number} params.threshold Minimum cosine similarity threshold
 * @returns {Promise<Object>} Retrieval result
 */
async function retrieveSemanticHistory({
  currentIncident = {},
  evidence = {},
  projectId = 'ecommerce-001',
  serviceId = null,
  limit = 5,
  threshold = 0.5
} = {}) {
  const startTime = Date.now();
  const targetService = serviceId || currentIncident.serviceId;

  logger.info(`[RAG V2] 🔍 Initiating semantic incident retrieval via embeddings + pgvector for ${targetService || 'all'} (project: ${projectId})`);

  try {
    // 1. Construct natural language query representation from live incident facts
    const queryText = buildRetrievalQuery(currentIncident, evidence);

    // 2. Embed the query string into vector space (1536 dims)
    const queryVector = await defaultEmbeddingService.embed(queryText);

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error('Query vector embedding generation returned empty or invalid vector');
    }

    // 3. Query PostgreSQL pgvector with strict multi-tenant project scoping
    const candidates = await tools.searchSemanticIncidents(projectId, {
      queryVector,
      serviceId: targetService,
      limit,
      threshold
    });

    const duration = Date.now() - startTime;
    logger.info(`[RAG V2] Retrieved ${candidates.length} semantic candidates from pgvector in ${duration}ms`);

    // 4. Format into compact historical context for LLM reasoning
    const historicalContext = candidates.map(c => formatSemanticHistoricalContext(c));

    return {
      candidatesCount: candidates.length,
      selectedCount: historicalContext.length,
      historicalContext,
      retrievalMode: 'semantic',
      retrievalDurationMs: duration
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.warn(`[RAG V2] Semantic retrieval failed: ${err.message} (${duration}ms)`);
    throw err;
  }
}

module.exports = {
  retrieveSemanticHistory,
  formatSemanticHistoricalContext,
  extractFieldFromCanonicalDoc
};
