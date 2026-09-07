// Deterministic Historical Incident Retrieval & Relevance Scoring Engine for SentinelAI RAG V1
// Zero vector database — retrieves past incidents via SentinelFlow API and ranks deterministically.

const tools = require('../tools');
const { createLogger } = require('@sentinelflow/shared');

const logger = createLogger('sentinel-ai-rag');

const DEFAULT_HISTORY_LIMIT = parseInt(process.env.AI_RAG_HISTORY_LIMIT || '5', 10);

/**
 * Calculates a deterministic relevance score between a current incident and a historical candidate.
 * Scoring breakdown:
 *  +40 : Same serviceId
 *  +20 : Same incident type / failure mode
 *  +15 : Same severity
 *  +15 : Matching or similar reason / error message
 *  +10 : Confirmed effective past recovery action
 */
const calculateRelevanceScore = (currentIncident, historicalCandidate) => {
  let score = 0;
  const matchReasons = [];

  const currService = (currentIncident.serviceId || currentIncident.serviceName || currentIncident.service || '').toLowerCase();
  const histService = (historicalCandidate.serviceId || historicalCandidate.serviceName || '').toLowerCase();

  const currType = (currentIncident.type || currentIncident.eventType || '').toUpperCase();
  const histType = (historicalCandidate.type || '').toUpperCase();

  const currSeverity = (currentIncident.severity || '').toUpperCase();
  const histSeverity = (historicalCandidate.severity || '').toUpperCase();

  const currReason = (currentIncident.reason || currentIncident.error || '').toLowerCase();
  const histReason = (historicalCandidate.reason || '').toLowerCase();

  // 1. Same service (+40)
  if (currService && histService && currService === histService) {
    score += 40;
    matchReasons.push('Same service target');
  }

  // 2. Same failure type (+20)
  if (currType && histType && currType === histType) {
    score += 20;
    matchReasons.push(`Same failure type: ${currType}`);
  }

  // 3. Same severity (+15)
  if (currSeverity && histSeverity && currSeverity === histSeverity) {
    score += 15;
    matchReasons.push(`Same severity: ${currSeverity}`);
  }

  // 4. Similar reason / error substring (+15)
  if (currReason && histReason) {
    if (currReason === histReason || currReason.includes(histReason) || histReason.includes(currReason)) {
      score += 15;
      matchReasons.push('Matching failure reason keywords');
    }
  }

  // 5. Successful past recovery action (+10)
  if (historicalCandidate.effectiveRecoveryAction && historicalCandidate.status === 'RESOLVED') {
    score += 10;
    matchReasons.push(`Proven recovery action: ${historicalCandidate.effectiveRecoveryAction}`);
  }

  return {
    score,
    matchReasons
  };
};

/**
 * Compact representation builder to protect token window and ensure clean LLM consumption.
 */
const formatHistoricalContext = (candidate, scoreInfo) => {
  return {
    incidentId: candidate.incidentId || candidate.id,
    serviceId: candidate.serviceId || candidate.serviceName,
    type: candidate.type,
    severity: candidate.severity,
    reason: candidate.reason || 'Unspecified failure',
    effectiveRecoveryAction: candidate.effectiveRecoveryAction || 'RESTART',
    resolutionDurationSeconds: candidate.resolutionDurationSeconds || 0,
    relevanceScore: scoreInfo.score,
    matchReasons: scoreInfo.matchReasons
  };
};

/**
 * Main RAG V1 retrieval function
 */
const retrieveRelevantHistory = async ({
  currentIncident,
  projectId = 'ecommerce-001',
  serviceId,
  limit = DEFAULT_HISTORY_LIMIT
}) => {
  const startTime = Date.now();
  logger.info(`[RAG V1] 📚 Initiating historical incident retrieval for ${serviceId || currentIncident.serviceId}`);

  try {
    // 1. Retrieve candidates from existing incident-service API
    // Retrieve up to 20 candidates for the project to allow intelligent cross-filtering
    const candidates = await tools.getHistoricalIncidents(projectId, {
      serviceId: serviceId || currentIncident.serviceId,
      limit: 20
    });

    const candidateCount = candidates.length;
    logger.info(`[RAG V1] Retrieved ${candidateCount} raw historical candidates from incident-service`);

    if (candidateCount === 0) {
      return {
        candidatesCount: 0,
        selectedCount: 0,
        retrievalDurationMs: Date.now() - startTime,
        historicalContext: []
      };
    }

    // 2. Score and filter candidates
    const scoredCandidates = candidates.map(candidate => {
      const scoreInfo = calculateRelevanceScore(currentIncident, candidate);
      return {
        candidate,
        scoreInfo,
        formatted: formatHistoricalContext(candidate, scoreInfo)
      };
    });

    // 3. Rank candidates by relevance score descending
    scoredCandidates.sort((a, b) => b.scoreInfo.score - a.scoreInfo.score);

    // 4. Select top candidates capped at limit
    const topSelected = scoredCandidates
      .filter(item => item.scoreInfo.score > 0) // Exclude completely irrelevant incidents
      .slice(0, limit)
      .map(item => item.formatted);

    const retrievalDurationMs = Date.now() - startTime;
    logger.info(`[RAG V1] ✅ Selected top ${topSelected.length} relevant historical incidents in ${retrievalDurationMs}ms (Top score: ${topSelected[0]?.relevanceScore || 0})`);

    return {
      candidatesCount: candidateCount,
      selectedCount: topSelected.length,
      retrievalDurationMs,
      historicalContext: topSelected
    };

  } catch (err) {
    logger.warn(`[RAG V1] Historical retrieval failed: ${err.message}. Gracefully proceeding without RAG.`);
    return {
      candidatesCount: 0,
      selectedCount: 0,
      retrievalDurationMs: Date.now() - startTime,
      historicalContext: [],
      error: err.message
    };
  }
};

module.exports = {
  calculateRelevanceScore,
  formatHistoricalContext,
  retrieveRelevantHistory
};
