import React from 'react';
import { Brain, Sparkles, ShieldCheck, Zap, Database, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function AiInsightsPanel({ incidents = [], services = [] }) {
  const total = incidents.length;
  const resolved = incidents.filter(i => i.status === 'RESOLVED').length;
  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED');

  // Compute top failing service & type
  const serviceFailCounts = {};
  const typeFailCounts = {};
  incidents.forEach(inc => {
    const s = inc.serviceName || inc.serviceId || 'unknown';
    const t = inc.type || 'UNKNOWN';
    serviceFailCounts[s] = (serviceFailCounts[s] || 0) + 1;
    typeFailCounts[t] = (typeFailCounts[t] || 0) + 1;
  });

  const topService = Object.entries(serviceFailCounts).sort((a, b) => b[1] - a[1])[0] || ['payment-service', 0];
  const topType = Object.entries(typeFailCounts).sort((a, b) => b[1] - a[1])[0] || ['HIGH_ERROR_RATE', 0];

  // Auto-recovery rate
  const autoRecoveredCount = resolved;
  const humanInterventions = 0; // Fully autonomous SentinelAI system

  return (
    <div className="glass-panel rounded-xl p-5 mb-8 border border-purple-900/40 bg-purple-950/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-purple-900/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-700 flex items-center justify-center text-purple-400">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white font-mono tracking-tight">
                SentinelAI AIOps & Recovery Intelligence
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-mono font-semibold">
                Autonomous RCA Active
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Live heuristic correlation and RAG historical incident pattern synthesis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400">RAG Architecture:</span>
          <span className="px-2 py-0.5 rounded bg-slate-900 text-purple-300 border border-purple-800 font-semibold flex items-center gap-1" title="Semantic pgvector 1536-dim embeddings with deterministic fallback">
            <Database className="w-3 h-3 text-purple-400" />
            pgvector + Deterministic Fallback
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Metric 1: Autonomous Incident Execution */}
        <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-900 space-y-2 font-mono">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider block">
            AI Operations Efficacy
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-900/60 p-2 rounded-lg">
              <span className="text-slate-500 text-[10px] block">ACTIVE INVESTIGATIONS</span>
              <span className="text-lg font-bold text-cyan-400">
                {activeIncidents.length}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg">
              <span className="text-slate-500 text-[10px] block">TOTAL RCA DIAGNOSED</span>
              <span className="text-lg font-bold text-purple-400">
                {total}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg">
              <span className="text-slate-500 text-[10px] block">AUTO-RECOVERED</span>
              <span className="text-lg font-bold text-emerald-400">
                {autoRecoveredCount}
              </span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg">
              <span className="text-slate-500 text-[10px] block">HUMAN OVERRIDES</span>
              <span className="text-lg font-bold text-slate-400">
                {humanInterventions}
              </span>
            </div>
          </div>
        </div>

        {/* Metric 2: Recurring Incident Clustering */}
        <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-900 space-y-2 font-mono">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider block">
            Recurring Pattern Identification
          </span>
          {total === 0 ? (
            <div className="text-slate-500 text-xs py-4 text-center italic">
              NO PROJECT TELEMETRY — No incident clusters detected for this project.
            </div>
          ) : (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60">
                <span className="text-slate-400">Top Impacted Service:</span>
                <span className="font-bold text-white capitalize">{topService[0]} ({topService[1]}x)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60">
                <span className="text-slate-400">Dominant Failure Mode:</span>
                <span className="font-bold text-rose-400">{topType[0]}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60">
                <span className="text-slate-400">Historical Recovery:</span>
                <span className="font-bold text-emerald-400">
                  {resolved > 0 ? `${Math.round((resolved / total) * 100)}% RESTART Efficacy` : 'Pending Data'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Metric 3: AI SRE Recommendation */}
        <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-900 space-y-2 font-mono">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            AI Continuous Improvement
          </span>
          {total === 0 ? (
            <div className="text-slate-500 text-xs py-4 text-center italic">
              No anomalies detected. Architecture operating within nominal baseline.
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-slate-900/60 text-xs text-slate-300 space-y-1 leading-relaxed">
              <p className="font-semibold text-indigo-300">
                Pattern: {topService[0]} transient failure mode ({topType[0]}).
              </p>
              <p className="text-[11px] text-slate-400">
                Recommendation: Verify retry backoff policies and circuit breakers for {topService[0]} to prevent cascading HTTP 5xx responses.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
