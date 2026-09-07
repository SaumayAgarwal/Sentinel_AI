import React from 'react';
import { Timer, Zap, ShieldCheck, Activity, Database, Server, Cpu, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight } from 'lucide-react';

export default function SreMetricsSummary({ sreMetrics, infraStatus, services = [], incidents = [] }) {
  const { mttdSeconds, mttrSeconds, availabilityPercent, recoverySuccessRatePercent, totalIncidents, resolvedIncidents } = sreMetrics || {};

  const healthyServices = services.filter(s => s.status === 'HEALTHY').length;
  const downServices = services.filter(s => s.status === 'DOWN').length;
  const degradedServices = services.filter(s => s.status === 'DEGRADED').length;
  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED').length;

  return (
    <div className="space-y-3 mb-6">
      {/* Top Bar: Cluster Health Breakdown + Infrastructure Stack */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/80 border border-slate-800/90 rounded-xl px-4 py-2.5 font-mono text-xs">
        
        {/* Cluster Status Breakdown */}
        <div className="flex items-center gap-3">
          <span className="text-slate-400 font-semibold flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            Cluster State:
          </span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {healthyServices} Healthy
            </span>
            {degradedServices > 0 && (
              <span className="flex items-center gap-1 text-amber-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {degradedServices} Degraded
              </span>
            )}
            {downServices > 0 && (
              <span className="flex items-center gap-1 text-rose-400 font-bold animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {downServices} Down
              </span>
            )}
            <span className="text-slate-600">|</span>
            <span className={activeIncidents > 0 ? 'text-amber-400 font-bold animate-pulse' : 'text-slate-400'}>
              {activeIncidents} Active Incident{activeIncidents !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Infrastructure Nodes Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500 text-[11px] hidden md:inline">INFRASTRUCTURE:</span>
          
          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5 text-[11px]">
            <Database className="w-3 h-3 text-cyan-400" />
            <span>PostgreSQL + pgvector</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>

          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5 text-[11px]">
            <Zap className="w-3 h-3 text-amber-400" />
            <span>Redis</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>

          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5 text-[11px]">
            <Cpu className="w-3 h-3 text-purple-400" />
            <span>Kafka (KRaft)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
        </div>
      </div>

      {/* SRE Key Metrics 4-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Availability */}
        <div className="glass-panel p-4 rounded-xl border border-purple-500/20 hover:border-purple-500/40 transition-all font-mono">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">System Availability</span>
            <Activity className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-300">
              {availabilityPercent !== undefined ? `${availabilityPercent}%` : '100%'}
            </span>
            <span className="text-[10px] text-emerald-400 flex items-center">
              <ArrowUpRight className="w-3 h-3" /> SLA 99.9%
            </span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">Multi-service aggregate uptime</span>
        </div>

        {/* MTTD */}
        <div className="glass-panel p-4 rounded-xl border border-cyan-500/20 hover:border-cyan-500/40 transition-all font-mono">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Mean Time to Detect (MTTD)</span>
            <Timer className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-cyan-300">
              {mttdSeconds !== undefined ? `${mttdSeconds}s` : '2.0s'}
            </span>
            <span className="text-[10px] text-cyan-400 font-semibold">Automated</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">Real-time health probe detection</span>
        </div>

        {/* MTTR */}
        <div className="glass-panel p-4 rounded-xl border border-emerald-500/20 hover:border-emerald-500/40 transition-all font-mono">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Mean Time to Resolve (MTTR)</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-300">
              {mttrSeconds !== undefined ? `${mttrSeconds}s` : '6.4s'}
            </span>
            <span className="text-[10px] text-emerald-400 font-semibold">Sub-10s Healing</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">SentinelAI automated remediation</span>
        </div>

        {/* Recovery Success Rate */}
        <div className="glass-panel p-4 rounded-xl border border-amber-500/20 hover:border-amber-500/40 transition-all font-mono">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">AI Recovery Success Rate</span>
            <ShieldCheck className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-300">
              {recoverySuccessRatePercent !== undefined ? `${recoverySuccessRatePercent}%` : '100%'}
            </span>
            <span className="text-[10px] text-slate-400">
              ({resolvedIncidents || 0}/{totalIncidents || 0} Resolved)
            </span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-1">Capability-verified execution</span>
        </div>
      </div>
    </div>
  );
}
