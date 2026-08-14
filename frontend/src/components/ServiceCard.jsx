import React from 'react';
import { Server, Activity, AlertCircle, CheckCircle, Clock, Zap, ExternalLink } from 'lucide-react';

export default function ServiceCard({ service }) {
  const isHealthy = service.status === 'HEALTHY';
  const isDown = service.status === 'DOWN';
  const isDegraded = service.status === 'DEGRADED';

  const isDemoTarget = service.name === 'payment-service';

  const servicePorts = {
    'user-service': 3001,
    'order-service': 3002,
    'payment-service': 3003,
    'inventory-service': 3004
  };
  const port = servicePorts[service.name] || 3003;
  const serviceUrl = service.url || `http://localhost:${port}/health`;

  return (
    <div className={`glass-panel rounded-xl p-5 relative overflow-hidden transition-all duration-300 hover:border-cyan-500/40 hover:shadow-lg hover:shadow-cyan-950/20 ${
      isDown ? 'border-rose-500/60 bg-rose-950/10' : ''
    }`}>
      {/* Top indicator ribbon */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${
        isHealthy ? 'bg-emerald-500' : isDown ? 'bg-rose-500 animate-pulse' : 'bg-amber-500'
      }`} />

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            isHealthy ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/50' : 
            isDown ? 'bg-rose-950/50 text-rose-400 border border-rose-800/50' : 
            'bg-amber-950/50 text-amber-400 border border-amber-800/50'
          }`}>
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white tracking-wide font-mono text-sm capitalize">
                {service.name.replace('-service', '')} Service
              </h3>
              {isDemoTarget && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                  DEMO TARGET
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400 font-mono">Port: {port}</span>
          </div>
        </div>

        {/* Status Badge */}
        <div className={`px-2.5 py-1 rounded-full text-xs font-semibold font-mono flex items-center gap-1.5 ${
          isHealthy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
          isDown ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse' :
          'bg-amber-500/10 text-amber-400 border border-amber-500/30'
        }`}>
          {isHealthy ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block"></span>
              <span>HEALTHY</span>
            </>
          ) : isDown ? (
            <>
              <AlertCircle className="w-3.5 h-3.5" />
              <span>DOWN</span>
            </>
          ) : (
            <>
              <Clock className="w-3.5 h-3.5" />
              <span>DEGRADED</span>
            </>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 text-xs font-mono">
        <div>
          <span className="text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" /> Latency
          </span>
          <p className={`font-semibold mt-0.5 ${
            (service.lastLatencyMs || 0) > 2000 ? 'text-amber-400' : 'text-slate-200'
          }`}>
            {service.lastLatencyMs ? `${service.lastLatencyMs}ms` : '< 15ms'}
          </p>
        </div>

        <div>
          <span className="text-slate-400 flex items-center gap-1">
            <Activity className="w-3 h-3 text-emerald-400" /> Health Checks
          </span>
          <p className="font-semibold text-slate-200 mt-0.5">
            {service.consecutiveFailures > 0 ? `${service.consecutiveFailures} Failures` : 'Passing 100%'}
          </p>
        </div>
      </div>

      {/* Visit Service Endpoint Button */}
      <div className="mt-4 pt-3 border-t border-slate-800/80">
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2 px-3 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/50 text-cyan-400 text-xs font-mono font-medium flex items-center justify-center gap-2 transition-all group shadow-sm"
        >
          <span>Visit Endpoint (/health)</span>
          <ExternalLink className="w-3.5 h-3.5 text-cyan-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </a>
      </div>
    </div>
  );
}
