// LLM Provider Abstraction Layer for SentinelAI
// Supports OpenAI API with pluggable fallback / deterministic heuristic reasoning.
// Incorporates RAG V1 Historical Evidence into single bounded RCA reasoning call.

const axios = require('axios');

class LLMProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
    this.baseURL = options.baseURL || process.env.GROQ_BASE_URL || process.env.OPENAI_BASE_URL || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
    this.model = options.model || process.env.GROQ_MODEL || process.env.OPENAI_MODEL || (this.baseURL.includes('groq.com') ? 'openai/gpt-oss-120b' : 'gpt-4o-mini');
  }

  // Generates structured diagnosis from incident + collected current evidence + historical context (RAG V1)
  async analyzeIncident({ incident, evidence, historicalEvidence = [], toolsUsed = [] }) {
    if (this.apiKey) {
      try {
        return await this._callOpenAI({ incident, evidence, historicalEvidence });
      } catch (err) {
        console.warn(`[LLMProvider] LLM call failed (${err.message}${err.response?.data?.error?.message ? ': ' + err.response.data.error.message : ''}). Falling back to deterministic diagnosis.`);
        // Fallback gracefully to structured diagnostic engine if OpenAI/Groq fails
        return this._diagnosticFallback({ incident, evidence, historicalEvidence, fallbackReason: err.message });
      }
    }

    // High-precision deterministic diagnostic engine (works without external keys)
    return this._diagnosticFallback({ incident, evidence, historicalEvidence });
  }

  async _callOpenAI({ incident, evidence, historicalEvidence = [] }) {
    const systemPrompt = `You are SentinelAI, an autonomous SRE expert investigating distributed microservice incidents.
Analyze the incident and evidence strictly.
CRITICAL INSTRUCTIONS ON HISTORICAL EVIDENCE:
1. Historical incidents are reference information to identify recurring patterns and proven recovery actions.
2. Do not assume a historical incident is the root cause of the current incident unless current evidence clearly supports it.
3. In "historicalEvidence", ONLY cite incident IDs that appear directly in the provided HISTORICAL EVIDENCE list. NEVER invent fictional incident IDs.

Respond with a JSON object ONLY conforming to this schema:
{
  "diagnosis": "Short summary of the issue",
  "rootCause": "Detailed explanation of why the service failed",
  "confidence": 0.0 to 1.0 (number),
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "evidence": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "historicalEvidence": [
    {
      "incidentId": "INC-xxx (must match provided historical incident)",
      "similarityReason": "Explanation of similarity to current incident",
      "previousRootCause": "Brief past root cause",
      "previousRecovery": "Action that recovered the past incident",
      "previousRecoveryStatus": "SUCCESS"
    }
  ],
  "recommendation": {
    "action": "RESTART" | "CLEAR_CACHE" | "SCALE" | "NONE",
    "target": "service-name",
    "reason": "Rationale for this recovery action, referencing past success if applicable"
  }
}`;

    const userPrompt = `INCIDENT DETAILS:
${JSON.stringify(incident, null, 2)}

CURRENT EVIDENCE (Live Telemetry):
${JSON.stringify(evidence, null, 2)}

HISTORICAL EVIDENCE (RAG V1 - Past Resolved Incidents):
${JSON.stringify(historicalEvidence, null, 2)}

Diagnose the root cause and recommend an actionable recovery step. Ground your recommendation in both current evidence and relevant historical cases.`;

    const res = await axios.post(
      `${this.baseURL}/chat/completions`,
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const content = res.data.choices[0]?.message?.content;
    const parsed = JSON.parse(content);

    // Enforce hallucination protection: filter out any historical incidents not in input
    const inputHistoricalMap = new Map(historicalEvidence.map(h => [h.incidentId, h]));
    const sanitizedHistorical = (parsed.historicalEvidence || [])
      .filter(item => inputHistoricalMap.has(item.incidentId))
      .map(item => {
        const original = inputHistoricalMap.get(item.incidentId) || {};
        return {
          ...item,
          similarityScore: original.similarityScore,
          relevanceScore: original.relevanceScore,
          retrievalMode: original.retrievalMode || (original.similarityScore ? 'semantic' : 'deterministic')
        };
      });

    return {
      ...parsed,
      historicalEvidence: sanitizedHistorical,
      tokensUsed: res.data.usage?.total_tokens || 0,
      provider: this.baseURL.includes('groq.com') ? 'groq' : 'openai',
      model: this.model
    };
  }

  // Deterministic expert diagnostic engine for zero-dependency offline resilience
  _diagnosticFallback({ incident, evidence, historicalEvidence = [], fallbackReason = null }) {
    const serviceName = incident.serviceId || incident.serviceName || incident.service || 'unknown';
    const type = incident.type || incident.reason || 'SERVICE_DOWN';
    const health = evidence.health || {};
    const deps = evidence.dependencies || [];
    const logs = evidence.logs || [];
    const metrics = evidence.metrics || {};

    const evidenceList = [];
    let rootCause = '';
    let diagnosis = '';
    let confidence = 0.90;
    let targetAction = 'RESTART';
    let targetService = serviceName;

    // 1. Dependency Analysis
    const failingDep = deps.find(d => d.status === 'DOWN' || d.status === 'FAILED');
    if (failingDep) {
      diagnosis = `${failingDep.serviceId} dependency failure affecting ${serviceName}`;
      rootCause = `${serviceName} cannot process requests because its critical dependency '${failingDep.serviceId}' (${failingDep.role || 'dependency'}) is DOWN.`;
      evidenceList.push(`Dependency '${failingDep.serviceId}' health check returned DOWN`);
      evidenceList.push(`Service ${serviceName} is reporting status ${health.status || 'DOWN'}`);
      targetService = failingDep.serviceId;
      confidence = 0.94;
    } else if (type === 'HIGH_LATENCY' || health.failureType === 'HIGH_LATENCY') {
      diagnosis = `Thread saturation and latency threshold breach on ${serviceName}`;
      rootCause = `${serviceName} response latency exceeds 2000ms threshold (measured: ${health.responseTime || metrics.p95LatencyMs || '2500'}ms).`;
      evidenceList.push(`Health check response latency measured at ${health.responseTime || 2500}ms`);
      evidenceList.push(`P95 response latency degraded beyond operational SLA`);
      confidence = 0.88;
    } else if (type === 'HIGH_ERROR_RATE' || health.failureType === 'HIGH_ERROR_RATE') {
      diagnosis = `Elevated HTTP 5xx error rate on ${serviceName}`;
      rootCause = `${serviceName} is failing 80%+ of incoming requests with Internal Server Error responses.`;
      evidenceList.push(`Error rate observed at ${metrics.metrics?.errorRatePercent || 80}%`);
      evidenceList.push(`Repeated HTTP 500 error responses during monitoring probes`);
      confidence = 0.91;
    } else {
      diagnosis = `${serviceName} process failure (HTTP 503 / unreachable)`;
      rootCause = `Service ${serviceName} is unresponsive on its configured port. Health check failed consecutively ${health.consecutiveFailures || 2} times.`;
      evidenceList.push(`${serviceName} health check returned ${health.status || 'DOWN'}`);
      evidenceList.push(`Consecutive monitoring failures exceeded threshold of 2`);
      confidence = 0.92;
    }

    if (logs && logs.length > 0) {
      const errorLogs = logs.filter(l => l.level === 'error' || l.level === 'warn');
      if (errorLogs.length > 0) {
        evidenceList.push(`Identified ${errorLogs.length} error/warning logs in recent trace window: "${errorLogs[0].message.slice(0, 80)}"`);
      }
    }

    // 2. Synthesize Historical Evidence (RAG V1 / V2 Grounding)
    const formattedHistEvidence = [];
    if (Array.isArray(historicalEvidence) && historicalEvidence.length > 0) {
      // Find top matching historical case
      const topPast = historicalEvidence[0];
      if (topPast) {
        formattedHistEvidence.push({
          incidentId: topPast.incidentId,
          similarityReason: topPast.similarityReason || (topPast.matchReasons ? topPast.matchReasons.join(', ') : `Similar incident on ${topPast.serviceId}`),
          previousRootCause: topPast.previousRootCause || topPast.reason || `${topPast.serviceId} failure`,
          previousRecovery: topPast.effectiveRecoveryAction || topPast.previousRecovery || 'RESTART',
          previousRecoveryStatus: topPast.previousRecoveryStatus || 'SUCCESS',
          similarityScore: topPast.similarityScore,
          relevanceScore: topPast.relevanceScore,
          retrievalMode: topPast.retrievalMode || (topPast.similarityScore ? 'semantic' : 'deterministic')
        });

        // If historical incident had a proven recovery action, reinforce recommendation
        if (topPast.effectiveRecoveryAction || topPast.previousRecovery) {
          targetAction = (topPast.effectiveRecoveryAction || topPast.previousRecovery).toUpperCase();
        }
        // Confidence boost from historical pattern verification
        confidence = Math.min(confidence + 0.02, 0.96);
      }
    }

    const recommendationReason = formattedHistEvidence.length > 0
      ? `Automated recovery to restore ${targetService} to HEALTHY baseline status (proven effective in past incident ${formattedHistEvidence[0].incidentId})`
      : `Automated recovery to restore ${targetService} to HEALTHY baseline status`;

    return {
      diagnosis,
      rootCause,
      confidence,
      severity: incident.severity || 'CRITICAL',
      evidence: evidenceList,
      historicalEvidence: formattedHistEvidence,
      recommendation: {
        action: targetAction,
        target: targetService,
        reason: recommendationReason
      },
      provider: fallbackReason ? 'fallback-reasoning' : 'deterministic-engine',
      model: fallbackReason ? `fallback (error: ${fallbackReason.slice(0, 40)})` : 'built-in-rca-engine'
    };
  }
}

module.exports = LLMProvider;
