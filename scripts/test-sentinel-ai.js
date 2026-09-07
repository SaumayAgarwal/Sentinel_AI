// Comprehensive Test Suite for SentinelAI: Tools, LLM Abstraction, and Agent Investigation Loop
// Mocks external calls so unit tests run cleanly without external API keys or live brokers.

process.env.NODE_ENV = 'test';
const assert = require('assert');
const SentinelAIAgent = require('../services/sentinel-ai/src/agent');
const LLMProvider = require('../services/sentinel-ai/src/llm');
const tools = require('../services/sentinel-ai/src/tools');
const { registry } = require('../services/shared');

async function runSentinelAiTests() {
  console.log('====================================================');
  console.log('  SentinelAI: AI Agent & Tool Layer Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(condition, description) {
    total++;
    if (condition) {
      console.log(`[PASS] ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${description}`);
    }
  }

  // 1. Tool Layer Determinism & Interface
  console.log('--- 1. Deterministic Tool Layer ---');
  test(typeof tools.getServiceHealth === 'function', 'getServiceHealth is exported');
  test(typeof tools.getServiceDependencies === 'function', 'getServiceDependencies is exported');
  test(typeof tools.getServiceMetrics === 'function', 'getServiceMetrics is exported');
  test(typeof tools.getServiceLogs === 'function', 'getServiceLogs is exported');
  test(typeof tools.requestRecovery === 'function', 'requestRecovery is exported');

  // Verify tool definitions schema for LLM
  test(Array.isArray(tools.toolDefinitions) && tools.toolDefinitions.length >= 6, 'Tool definitions array contains required tools');
  const healthDef = tools.toolDefinitions.find(t => t.name === 'get_service_health');
  test(healthDef && healthDef.parameters.required.includes('serviceId'), 'get_service_health has structured parameter schema');

  // 2. LLM Provider Abstraction & Fallback
  console.log('\n--- 2. LLM Provider Abstraction Layer ---');
  const mockLLM = new LLMProvider();
  test(mockLLM.model === 'gpt-4o-mini', 'Defaults to configured model');

  const mockEvidence = {
    health: { status: 'DOWN', failureType: 'SERVICE_DOWN', responseTime: 0, consecutiveFailures: 3 },
    dependencies: [
      { serviceId: 'postgres', type: 'INFRASTRUCTURE', status: 'DOWN', role: 'Payment ledger database' },
      { serviceId: 'redis', type: 'INFRASTRUCTURE', status: 'UP' }
    ],
    logs: [{ level: 'error', message: 'Connection to postgres:5433 refused' }]
  };

  const diagnosis = await mockLLM.analyzeIncident({
    incident: { serviceId: 'payment-service', type: 'SERVICE_DOWN', severity: 'CRITICAL' },
    evidence: mockEvidence
  });

  test(diagnosis && typeof diagnosis.rootCause === 'string', 'LLM Provider generates structured rootCause');
  test(diagnosis.confidence >= 0.85, `Confidence meets high threshold (${diagnosis.confidence})`);
  test(diagnosis.evidence.length >= 2, 'Returns bulleted evidence points');
  test(diagnosis.recommendation && diagnosis.recommendation.action === 'RESTART', 'Generates actionable recovery recommendation');
  test(diagnosis.recommendation.target === 'postgres', 'Correctly identifies root-cause dependency target (postgres)');

  // 3. Agent Selective Evidence Collection & Bounded Investigation
  console.log('\n--- 3. Agent Investigation Loop & Limits ---');
  const agent = new SentinelAIAgent();

  // Test investigation on mock incident
  const mockIncident = {
    incidentId: `INC-TEST-${Date.now()}`,
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    createdAt: new Date().toISOString()
  };

  const invResult = await agent.investigate(mockIncident);
  test(invResult.investigationId.startsWith('INV-'), 'Investigation created with unique ID');
  test(invResult.status === 'DIAGNOSED' || invResult.status === 'RECOVERY_REQUESTED' || invResult.status === 'RECOVERED', `Investigation reached valid state: ${invResult.status}`);
  test(invResult.llmCalls <= 4, `Bounded LLM calls: ${invResult.llmCalls} <= 4`);
  test(invResult.toolCalls <= 8, `Bounded Tool calls: ${invResult.toolCalls} <= 8`);
  test(invResult.evidence !== null, 'Stored structured evidence');
  test(typeof invResult.rootCause === 'string', 'Diagnosis root cause stored');

  // 4. Duplicate Event Prevention
  console.log('\n--- 4. Duplicate Event Prevention ---');
  const initialInvId = invResult.investigationId;
  const duplicateResult = await agent.investigate(mockIncident);
  test(duplicateResult.investigationId === initialInvId, 'Duplicate incident delivery returns existing investigation without re-executing');
  test(duplicateResult.llmCalls === invResult.llmCalls, 'No additional LLM calls incurred on duplicate event');

  // 5. Capability Safety & Recovery Policy Check
  console.log('\n--- 5. Recovery Capability & Safety Validation ---');
  const caps = registry.getRecoveryCapabilities('ecommerce-001', 'payment-service');
  test(caps.recoveryCapabilities.includes('restart'), 'Payment service allows restart');
  test(!caps.recoveryCapabilities.includes('drop_database'), 'Arbitrary/destructive action drop_database is rejected');

  // 6. Graceful Degradation under Tool / LLM Fault
  console.log('\n--- 6. Fault Tolerance & Graceful Degradation ---');
  const faultyAgent = new SentinelAIAgent();
  faultyAgent.llm = {
    analyzeIncident: async () => { throw new Error('OpenAI API network timeout'); }
  };
  const faultyIncident = {
    incidentId: `INC-FAULT-${Date.now()}`,
    serviceId: 'order-service',
    type: 'SERVICE_DOWN'
  };
  const faultResult = await faultyAgent.investigate(faultyIncident);
  test(faultResult.status === 'FAILED' && faultResult.error.includes('OpenAI'), 'Agent handles LLM failure gracefully without crashing the runtime');

  // 7. SentinelAI RAG V1 — Historical Incident Retrieval & Scoring
  console.log('\n--- 7. RAG V1: Historical Incident Retrieval & Relevance Scoring ---');
  const { calculateRelevanceScore, formatHistoricalContext, retrieveRelevantHistory } = require('../services/sentinel-ai/src/retrieval/historicalIncidents');

  const currentInc = {
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    reason: 'Database connection refused'
  };

  const candidateA = {
    id: 'inc-1',
    incidentId: 'INC-101',
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    reason: 'Database connection refused',
    effectiveRecoveryAction: 'RESTART',
    status: 'RESOLVED',
    resolutionDurationSeconds: 35
  };

  const candidateB = {
    id: 'inc-2',
    incidentId: 'INC-202',
    serviceId: 'order-service',
    type: 'HIGH_LATENCY',
    severity: 'HIGH',
    reason: 'Thread pool exhaustion',
    effectiveRecoveryAction: 'RESTART',
    status: 'RESOLVED',
    resolutionDurationSeconds: 50
  };

  const scoreA = calculateRelevanceScore(currentInc, candidateA);
  const scoreB = calculateRelevanceScore(currentInc, candidateB);

  test(scoreA.score === 100, `High matching candidate receives top score (+40 svc, +20 type, +15 sev, +15 rsn, +10 rec = ${scoreA.score})`);
  test(scoreA.score > scoreB.score, `Candidate A (${scoreA.score}) ranks strictly higher than unrelated Candidate B (${scoreB.score})`);
  test(scoreA.matchReasons.length >= 4, 'Score breakdown provides explainable match reasons');

  const compact = formatHistoricalContext(candidateA, scoreA);
  test(compact.incidentId === 'INC-101' && compact.relevanceScore === 100, 'Compact representation correctly formats historical context');

  // 8. Single LLM Call with RAG Grounding Verification
  console.log('\n--- 8. Single LLM Call & RAG Context Verification ---');
  const ragAgent = new SentinelAIAgent();
  const ragIncident = {
    incidentId: `INC-RAG-${Date.now()}`,
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    createdAt: new Date().toISOString()
  };

  const ragInvestigation = await ragAgent.investigate(ragIncident);
  test(ragInvestigation.llmCalls === 1, `Strictly 1 bounded LLM call incurred during RAG investigation (actual: ${ragInvestigation.llmCalls})`);
  test(ragInvestigation.ragMetadata && ragInvestigation.ragMetadata.enabled === true, 'RAG metadata recorded on investigation');
  test(Array.isArray(ragInvestigation.historicalEvidence), 'historicalEvidence array is attached to investigation result');

  // 9. Hallucination Protection
  console.log('\n--- 9. Hallucination Protection ---');
  const mockHistory = [
    { incidentId: 'INC-GENUINE-1', serviceId: 'payment-service', effectiveRecoveryAction: 'RESTART' },
    { incidentId: 'INC-GENUINE-2', serviceId: 'payment-service', effectiveRecoveryAction: 'RESTART' }
  ];
  const groundedDiagnosis = await mockLLM.analyzeIncident({
    incident: currentInc,
    evidence: mockEvidence,
    historicalEvidence: mockHistory
  });

  const citedIds = (groundedDiagnosis.historicalEvidence || []).map(h => h.incidentId);
  const allowedIds = new Set(['INC-GENUINE-1', 'INC-GENUINE-2']);
  const onlyValidCited = citedIds.every(id => allowedIds.has(id));
  test(onlyValidCited, `Only retrieved incident IDs are cited in historicalEvidence (${citedIds.join(', ')})`);

  // 10. RAG V2: Canonical Document & Retrieval Query Builders
  console.log('\n--- 10. RAG V2: Canonical Document & Query Builders ---');
  const { buildCanonicalDocument, buildRetrievalQuery } = require('../services/sentinel-ai/src/retrieval/canonicalDocument');

  const resolvedIncident = {
    incidentId: 'INC-RESOLVED-101',
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    severity: 'CRITICAL',
    type: 'SERVICE_DOWN',
    reason: 'Database pool exhaustion',
    rootCause: 'PostgreSQL max_connections exceeded under load spike',
    effectiveRecoveryAction: 'RESTART',
    status: 'RESOLVED'
  };

  const canonicalDoc = buildCanonicalDocument(resolvedIncident);
  test(canonicalDoc.includes('Project: ecommerce-001'), 'Canonical doc includes Project');
  test(canonicalDoc.includes('Service: payment-service'), 'Canonical doc includes Service');
  test(canonicalDoc.includes('Severity: CRITICAL'), 'Canonical doc includes Severity');
  test(canonicalDoc.includes('Failure: SERVICE_DOWN'), 'Canonical doc includes Failure mode');
  test(canonicalDoc.includes('Reason: Database pool exhaustion'), 'Canonical doc includes Reason');
  test(canonicalDoc.includes('Root Cause: PostgreSQL max_connections exceeded'), 'Canonical doc includes Root Cause');
  test(canonicalDoc.includes('Recovery Action: RESTART'), 'Canonical doc includes Recovery Action');
  test(canonicalDoc.includes('Recovery Result: SUCCESS'), 'Canonical doc includes Recovery Result');

  const liveEvidence = {
    health: { status: 'DOWN', failureType: 'SERVICE_DOWN', responseTime: 0 },
    dependencies: [{ serviceId: 'postgres', status: 'DOWN', role: 'Database' }],
    logs: [{ level: 'error', message: 'Connection to postgres refused' }]
  };
  const retrievalQuery = buildRetrievalQuery(currentInc, liveEvidence);
  test(retrievalQuery.includes('payment-service'), 'Retrieval query incorporates serviceId');
  test(retrievalQuery.includes('SERVICE_DOWN'), 'Retrieval query incorporates failure mode');
  test(retrievalQuery.includes('postgres (Database) is DOWN'), 'Retrieval query incorporates live failed dependencies');
  test(retrievalQuery.includes('Connection to postgres refused'), 'Retrieval query incorporates live error logs');

  // 11. RAG V2: Embedding Abstraction & Cosine Similarity
  console.log('\n--- 11. RAG V2: Embeddings & Cosine Similarity ---');
  const { defaultEmbeddingService, cosineSimilarity } = require('../services/sentinel-ai/src/embeddings');

  const vec1 = await defaultEmbeddingService.embed('payment-service database connection error');
  test(Array.isArray(vec1) && vec1.length === 1536, `Embedding vector has exactly 1536 dimensions (actual: ${vec1?.length})`);
  test(vec1.every(n => typeof n === 'number' && !isNaN(n)), 'All embedding vector elements are valid numbers');

  // Check L2 unit length
  let sumSquares = 0;
  for (let i = 0; i < vec1.length; i++) sumSquares += vec1[i] * vec1[i];
  const l2Norm = Math.sqrt(sumSquares);
  test(Math.abs(l2Norm - 1.0) < 0.01, `Embedding is unit-normalized (L2 norm: ${l2Norm.toFixed(4)})`);

  // Identical text produces identical embedding (deterministic consistency)
  const vec1Again = await defaultEmbeddingService.embed('payment-service database connection error');
  const simSelf = cosineSimilarity(vec1, vec1Again);
  test(Math.abs(simSelf - 1.0) < 0.001, `Self cosine similarity is 1.0 (actual: ${simSelf.toFixed(4)})`);

  // Semantically related vs unrelated text similarity
  const vecRelated = await defaultEmbeddingService.embed('payment-service database connection refused postgres');
  const vecUnrelated = await defaultEmbeddingService.embed('user profile picture avatar upload frontend rendering');
  const simRelated = cosineSimilarity(vec1, vecRelated);
  const simUnrelated = cosineSimilarity(vec1, vecUnrelated);
  test(simRelated > simUnrelated, `Semantically related text (${simRelated.toFixed(4)}) scores higher than unrelated text (${simUnrelated.toFixed(4)})`);

  // 12. RAG V2: Candidate Formatting & Multi-Tenant Isolation
  console.log('\n--- 12. RAG V2: Candidate Formatting & Multi-Tenant Isolation ---');
  const { formatSemanticHistoricalContext } = require('../services/sentinel-ai/src/retrieval/semanticIncidents');

  const mockSemanticCandidate = {
    incidentId: 'INC-SEMANTIC-555',
    serviceId: 'payment-service',
    content: canonicalDoc,
    similarityScore: 0.92,
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    reason: 'Database pool exhaustion',
    status: 'RESOLVED'
  };

  const formattedSemantic = formatSemanticHistoricalContext(mockSemanticCandidate);
  test(formattedSemantic.incidentId === 'INC-SEMANTIC-555', 'Extracts incidentId cleanly');
  test(formattedSemantic.previousRootCause === 'PostgreSQL max_connections exceeded under load spike', 'Extracts root cause from canonical document');
  test(formattedSemantic.effectiveRecoveryAction === 'RESTART', 'Extracts effective recovery action from canonical doc');
  test(formattedSemantic.similarityScore === 0.92, 'Preserves cosine similarity score');
  test(formattedSemantic.retrievalMode === 'semantic', 'Tags retrievalMode as semantic');

  // Verify multi-tenant isolation in tools layer
  test(typeof tools.searchSemanticIncidents === 'function', 'tools.searchSemanticIncidents is exported');
  test(typeof tools.saveIncidentEmbedding === 'function', 'tools.saveIncidentEmbedding is exported');

  // 13. RAG V2: Hierarchical Fallback Chain (Semantic -> Deterministic -> Live Only)
  console.log('\n--- 13. RAG V2: Hierarchical Fallback Chain ---');
  // Fallback test: when pgvector / semantic search returns 0 candidates or fails, agent falls back to RAG V1
  const fallbackAgent = new SentinelAIAgent();
  const testIncidentWithFallback = {
    incidentId: `INC-FALLBACK-${Date.now()}`,
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    createdAt: new Date().toISOString()
  };

  const fallbackInv = await fallbackAgent.investigate(testIncidentWithFallback);
  test(fallbackInv.status === 'DIAGNOSED', 'Investigation succeeds despite RAG V2 empty/offline candidates');
  test(fallbackInv.llmCalls === 1, 'Strictly 1 bounded LLM call incurred across the investigation');
  test(fallbackInv.ragMetadata && typeof fallbackInv.ragMetadata.mode === 'string', `RAG mode recorded on fallback: ${fallbackInv.ragMetadata?.mode}`);

  // Test with active semantic pgvector match
  const origSearchSemantic = tools.searchSemanticIncidents;
  tools.searchSemanticIncidents = async (pId, opts) => {
    return [{
      incidentId: 'INC-SEMANTIC-HIT-1',
      serviceId: 'payment-service',
      content: canonicalDoc,
      similarityScore: 0.94,
      type: 'SERVICE_DOWN',
      severity: 'CRITICAL',
      status: 'RESOLVED'
    }];
  };

  const semanticMatchAgent = new SentinelAIAgent();
  const testIncidentSemantic = {
    incidentId: `INC-SEMANTIC-${Date.now()}`,
    projectId: 'ecommerce-001',
    serviceId: 'payment-service',
    type: 'SERVICE_DOWN',
    severity: 'CRITICAL',
    createdAt: new Date().toISOString()
  };

  const semanticInv = await semanticMatchAgent.investigate(testIncidentSemantic);
  tools.searchSemanticIncidents = origSearchSemantic; // restore

  test(semanticInv.ragMetadata && semanticInv.ragMetadata.mode === 'semantic', `Active RAG V2 records mode: 'semantic' (actual: ${semanticInv.ragMetadata?.mode})`);
  test(semanticInv.historicalEvidence.length > 0 && semanticInv.historicalEvidence[0].incidentId === 'INC-SEMANTIC-HIT-1', 'Semantic candidate correctly attached to historicalEvidence');
  test(semanticInv.historicalEvidence[0].similarityScore === 0.94, 'Semantic similarity score preserved');
  test(semanticInv.llmCalls === 1, 'Strictly 1 bounded LLM call with active semantic grounding');


  console.log(`\n====================================================`);
  console.log(`SentinelAI Tests: ${passed}/${total} Passed`);
  console.log(`====================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runSentinelAiTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
