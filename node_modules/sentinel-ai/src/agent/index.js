const tools = require('../tools');
const LLMProvider = require('../llm');
const { retrieveRelevantHistory } = require('../retrieval/historicalIncidents');
const { retrieveSemanticHistory } = require('../retrieval/semanticIncidents');
const { createLogger, registry } = require('@sentinelflow/shared');

const logger = createLogger('sentinel-ai-agent');

const MAX_TOOL_CALLS = parseInt(process.env.MAX_TOOL_CALLS || '8', 10);
const MAX_LLM_CALLS = parseInt(process.env.MAX_LLM_CALLS || '4', 10);
const CONFIDENCE_THRESHOLD = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.75');
const AUTO_RECOVERY_ENABLED = process.env.AI_AUTO_RECOVERY_ENABLED === 'true';
const RAG_ENABLED = process.env.AI_RAG_ENABLED !== 'false';
const RAG_V2_ENABLED = process.env.AI_RAG_V2_ENABLED !== 'false';
const RAG_HISTORY_LIMIT = parseInt(process.env.AI_RAG_HISTORY_LIMIT || '5', 10);
const RAG_SIMILARITY_THRESHOLD = parseFloat(process.env.AI_RAG_SIMILARITY_THRESHOLD || '0.5');


class SentinelAIAgent {
  constructor(options = {}) {
    this.llm = new LLMProvider(options);
    this.investigations = new Map(); // In-memory store + prisma fallback
  }

  // Investigates an incident end-to-end
  async investigate(incident) {
    const incidentId = incident.incidentId || incident.id;
    const projectId = incident.projectId || 'ecommerce-001';
    const serviceId = incident.serviceId || incident.serviceName || incident.service;

    // 1. Deduplication guard — prevent duplicate investigations
    if (this.investigations.has(incidentId)) {
      logger.info(`[Agent] Investigation already exists for incident ${incidentId}, skipping.`);
      return this.investigations.get(incidentId);
    }

    const investigationId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const investigationRecord = {
      investigationId,
      projectId,
      incidentId,
      serviceId,
      status: 'INVESTIGATING',
      diagnosis: null,
      rootCause: null,
      confidence: 0,
      severity: incident.severity || 'HIGH',
      evidence: {},
      historicalEvidence: [],
      ragMetadata: {
        enabled: RAG_ENABLED,
        mode: 'none',
        candidatesCount: 0,
        selectedCount: 0,
        retrievalDurationMs: 0
      },
      recommendation: null,
      recovery: { status: 'NOT_EXECUTED' },
      llmCalls: 0,
      toolCalls: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null
    };

    this.investigations.set(incidentId, investigationRecord);
    logger.info(`[Agent] 🔍 Starting investigation ${investigationId} for ${serviceId} (Incident: ${incidentId})`);

    let toolCallsCount = 0;
    let llmCallsCount = 0;

    try {
      // ──────────────────────────────────────────────────────────────────────────
      // STAGE 1: Deterministic Evidence Collection (Selective & Cost-Efficient)
      // Only collects what is needed for this specific incident type
      // ──────────────────────────────────────────────────────────────────────────
      const evidence = {};

      // 1. Always inspect live service health
      if (toolCallsCount < MAX_TOOL_CALLS) {
        toolCallsCount++;
        logger.info(`[Agent] Calling tool: getServiceHealth(${serviceId})`);
        evidence.health = await tools.getServiceHealth(projectId, serviceId);
      }

      // 2. Always inspect dependencies (database, internal services) to spot cascade failures
      if (toolCallsCount < MAX_TOOL_CALLS) {
        toolCallsCount++;
        logger.info(`[Agent] Calling tool: getServiceDependencies(${serviceId})`);
        const depResult = await tools.getServiceDependencies(projectId, serviceId);
        evidence.dependencies = depResult?.dependencies || [];
      }

      // 3. Selectively collect metrics if high latency or error rate suspected
      const isPerformanceIssue = incident.type === 'HIGH_LATENCY' || incident.type === 'HIGH_ERROR_RATE' ||
        evidence.health?.failureType === 'HIGH_LATENCY' || evidence.health?.failureType === 'HIGH_ERROR_RATE';

      if (isPerformanceIssue && toolCallsCount < MAX_TOOL_CALLS) {
        toolCallsCount++;
        logger.info(`[Agent] Calling tool: getServiceMetrics(${serviceId})`);
        evidence.metrics = await tools.getServiceMetrics(projectId, serviceId);
      }

      // 4. Collect recent error/warn logs for root cause context
      if (toolCallsCount < MAX_TOOL_CALLS) {
        toolCallsCount++;
        logger.info(`[Agent] Calling tool: getServiceLogs(${serviceId})`);
        evidence.logs = await tools.getServiceLogs(projectId, serviceId, { limit: 20 });
      }

      // Check recovery capabilities for policy evaluation
      if (toolCallsCount < MAX_TOOL_CALLS) {
        toolCallsCount++;
        evidence.recoveryCapabilities = await tools.getRecoveryCapabilities(projectId, serviceId);
      }

      investigationRecord.evidence = evidence;
      investigationRecord.toolCalls = toolCallsCount;

      // ──────────────────────────────────────────────────────────────────────────
      // STAGE 1.5: RAG Layer (RAG V2 Semantic -> RAG V1 Deterministic Fallback)
      // Retrieves, scores, and ranks past incidents WITHOUT invoking an LLM.
      // ──────────────────────────────────────────────────────────────────────────
      let historicalEvidence = [];
      let retrievalMode = 'none';

      if (RAG_ENABLED) {
        // Step 1: Attempt RAG V2 (Semantic Retrieval with pgvector)
        if (RAG_V2_ENABLED) {
          try {
            const semanticResult = await retrieveSemanticHistory({
              currentIncident: incident,
              evidence,
              projectId,
              serviceId,
              limit: RAG_HISTORY_LIMIT,
              threshold: RAG_SIMILARITY_THRESHOLD
            });

            if (semanticResult && semanticResult.historicalContext && semanticResult.historicalContext.length > 0) {
              historicalEvidence = semanticResult.historicalContext;
              retrievalMode = 'semantic';
              investigationRecord.historicalEvidence = historicalEvidence;
              investigationRecord.ragMetadata = {
                enabled: true,
                mode: 'semantic',
                provider: process.env.AI_EMBEDDING_PROVIDER || 'openai',
                model: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
                candidatesCount: semanticResult.candidatesCount,
                selectedCount: semanticResult.selectedCount,
                retrievalDurationMs: semanticResult.retrievalDurationMs
              };
              logger.info(`[Agent] 📚 RAG V2 (Semantic) retrieved ${historicalEvidence.length} relevant historical incidents for grounding`);
            } else {
              logger.info(`[Agent] RAG V2 returned 0 semantic candidates. Falling back to RAG V1 deterministic retrieval.`);
            }
          } catch (v2Err) {
            logger.warn(`[Agent] RAG V2 semantic retrieval failed: ${v2Err.message}. Falling back to RAG V1 deterministic retrieval.`);
          }
        }

        // Step 2: Fallback to RAG V1 (Deterministic Rule-Based Retrieval) if needed
        if (historicalEvidence.length === 0) {
          try {
            const ragResult = await retrieveRelevantHistory({
              currentIncident: incident,
              projectId,
              serviceId,
              limit: RAG_HISTORY_LIMIT
            });

            if (ragResult && ragResult.historicalContext && ragResult.historicalContext.length > 0) {
              historicalEvidence = ragResult.historicalContext;
              retrievalMode = 'deterministic';
              investigationRecord.historicalEvidence = historicalEvidence;
              investigationRecord.ragMetadata = {
                enabled: true,
                mode: 'deterministic',
                candidatesCount: ragResult.candidatesCount || 0,
                selectedCount: ragResult.selectedCount || 0,
                retrievalDurationMs: ragResult.retrievalDurationMs || 0
              };
              logger.info(`[Agent] 📚 RAG V1 (Deterministic) retrieved ${historicalEvidence.length} relevant historical incidents for grounding`);
            }
          } catch (ragErr) {
            logger.warn(`[Agent] RAG V1 retrieval failed: ${ragErr.message}. Continuing with live evidence only.`);
          }
        }

        if (!investigationRecord.ragMetadata) {
          investigationRecord.ragMetadata = {
            enabled: true,
            mode: retrievalMode,
            candidatesCount: 0,
            selectedCount: 0,
            retrievalDurationMs: 0
          };
        } else {
          investigationRecord.ragMetadata.mode = retrievalMode;
        }
      }

      // ──────────────────────────────────────────────────────────────────────────
      // STAGE 2: LLM Reasoning & Root Cause Analysis
      // Single, structured analysis call (bounded) combining Current + Historical evidence
      // ──────────────────────────────────────────────────────────────────────────
      if (llmCallsCount >= MAX_LLM_CALLS) {
        investigationRecord.status = 'INCONCLUSIVE';
        investigationRecord.error = 'Exceeded maximum LLM reasoning calls limit';
        return investigationRecord;
      }

      llmCallsCount++;
      logger.info(`[Agent] 🧠 Invoking LLM for root-cause analysis with RAG grounding (Call ${llmCallsCount}/${MAX_LLM_CALLS})`);
      const diagnosisResult = await this.llm.analyzeIncident({
        incident,
        evidence,
        historicalEvidence,
        toolsUsed: ['health', 'dependencies', 'logs', 'capabilities', 'historical_incidents']
      });

      investigationRecord.llmCalls = llmCallsCount;
      investigationRecord.diagnosis = diagnosisResult.diagnosis;
      investigationRecord.rootCause = diagnosisResult.rootCause;
      investigationRecord.confidence = diagnosisResult.confidence || 0.9;
      investigationRecord.recommendation = diagnosisResult.recommendation;
      investigationRecord.provider = diagnosisResult.provider;
      investigationRecord.model = diagnosisResult.model;
      investigationRecord.tokensUsed = diagnosisResult.tokensUsed || 0;
      if (diagnosisResult.historicalEvidence && diagnosisResult.historicalEvidence.length > 0) {
        investigationRecord.historicalEvidence = diagnosisResult.historicalEvidence;
      }
      investigationRecord.status = 'DIAGNOSED';

      logger.info(`[Agent] ✅ Diagnosis reached: "${diagnosisResult.diagnosis}" (Confidence: ${Math.round(investigationRecord.confidence * 100)}%)`);


      // ──────────────────────────────────────────────────────────────────────────
      // STAGE 3: Policy Validation & Controlled Recovery
      // ──────────────────────────────────────────────────────────────────────────
      const rec = diagnosisResult.recommendation;
      if (rec && rec.action && rec.action !== 'NONE') {
        const actionType = rec.action.toUpperCase();
        const targetService = rec.target || serviceId;

        // Policy Check: Is confidence sufficient?
        if (investigationRecord.confidence >= CONFIDENCE_THRESHOLD) {
          // Policy Check: Does service support this capability?
          const capInfo = registry.getRecoveryCapabilities(projectId, targetService);
          const allowedCaps = (capInfo?.recoveryCapabilities || ['restart']).map(c => c.toUpperCase());

          if (allowedCaps.includes(actionType.toLowerCase()) || allowedCaps.includes(actionType)) {
            if (AUTO_RECOVERY_ENABLED) {
              investigationRecord.status = 'RECOVERY_REQUESTED';
              logger.info(`[Agent] 🚀 Requesting controlled recovery for ${targetService} [Action: ${actionType}]`);

              try {
                const recoveryResult = await tools.requestRecovery(projectId, incidentId, targetService, actionType);
                investigationRecord.recovery = {
                  status: 'RECOVERING',
                  actionType,
                  targetService,
                  requestedBy: 'AI_AGENT',
                  recoveryActionId: recoveryResult.recoveryActionId,
                  timestamp: new Date().toISOString()
                };

                // ──────────────────────────────────────────────────────────────────────────
                // STAGE 4: Recovery Health Verification (Wait & Verify)
                // ──────────────────────────────────────────────────────────────────────────
                setTimeout(async () => {
                  await this.verifyRecovery(investigationRecord, targetService, projectId);
                }, 3000);

              } catch (recErr) {
                logger.error(`[Agent] Recovery request failed: ${recErr.message}`);
                investigationRecord.recovery = {
                  status: 'FAILED',
                  error: recErr.message
                };
                investigationRecord.status = 'FAILED';
              }
            } else {
              investigationRecord.recovery = {
                status: 'APPROVAL_REQUIRED',
                actionType,
                targetService,
                reason: 'Auto-recovery disabled by policy configuration'
              };
            }
          } else {
            logger.warn(`[Agent] Recommended action ${actionType} not permitted by policy for ${targetService}`);
            investigationRecord.recovery = {
              status: 'POLICY_REJECTED',
              error: `Action '${actionType}' not allowed for ${targetService}`
            };
          }
        }
      }

      investigationRecord.completedAt = new Date().toISOString();
      return investigationRecord;

    } catch (err) {
      logger.error(`[Agent] Investigation error: ${err.message}`);
      investigationRecord.status = 'FAILED';
      investigationRecord.error = err.message;
      investigationRecord.completedAt = new Date().toISOString();
      return investigationRecord;
    }
  }

  // Verifies recovery by checking health
  async verifyRecovery(investigationRecord, serviceId, projectId) {
    logger.info(`[Agent] Verifying recovery health for ${serviceId}...`);
    try {
      const health = await tools.getServiceHealth(projectId, serviceId);
      if (health.status === 'HEALTHY' || health.status === 'UP') {
        investigationRecord.status = 'RECOVERED';
        investigationRecord.recovery.status = 'SUCCESS';
        investigationRecord.recovery.verified = true;
        investigationRecord.recovery.verifiedAt = new Date().toISOString();
        logger.info(`[Agent] 🎉 Service ${serviceId} verified HEALTHY! Investigation marked RECOVERED.`);
      } else {
        logger.warn(`[Agent] Service ${serviceId} verification check returned: ${health.status}`);
      }
    } catch (e) {
      logger.warn(`[Agent] Verification check error: ${e.message}`);
    }
  }

  getInvestigation(incidentId) {
    return this.investigations.get(incidentId) || null;
  }

  getAllInvestigations(projectId = null) {
    const all = Array.from(this.investigations.values());
    if (projectId) {
      return all.filter(inv => inv.projectId === projectId);
    }
    return all.reverse();
  }
}

module.exports = SentinelAIAgent;
