import React from 'react';
import { Server, Activity, AlertCircle, CheckCircle2, Clock, Zap, ExternalLink, ArrowRight, Database } from 'lucide-react';

export default function ServiceCard({ service, onSelectService, incidents = [] }) {
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

  // Static dependency mapping based on microservice topology
  const defaultDeps = {
    'user-service': ['Order Service', 'PostgreSQL'],
    'order-service': ['Payment Service', 'Inventory Service', 'PostgreSQL'],
    'payment-service': ['PostgreSQL', 'Redis', 'Order Service'],
    'inventory-service': ['PostgreSQL', 'Redis']
  };
  const deps = defaultDeps[service.name] || ['PostgreSQL'];

  // Calculate error rate & health %
  const errorRate = isDown ? '100%' : isDegraded ? '45%' : '0.1%';
  const healthPercent = isDown ? '0%' : isDegraded ? '55%' : '100%';
  const availability = isDown ? '98.8%' : '99.98%';
  const latency = service.lastLatencyMs || (service.name === 'payment-service' ? 24 : service.name === 'order-service' ? 18 : 12);

  // Mini sparkline points based on latency
  const sparklinePoints = isDown
    ? "0,20 10,22 20,25 30,28 40,30 50,30"
    : isDegraded
    ? "0,15 10,22 20,10 30,25 40,28 50,26"
    : "0,15 10,12 20,14 30,11 40,13 50,12";

  // Last incident
  const serviceIncidents = incidents.filter(i => (i.serviceName === service.name || i.serviceId === service.name));
  const activeInc = serviceIncidents.find(i => i.status !== 'RESOLVED');
  const lastInc = serviceIncidents[0];

  return (
    <div className={`glass-panel rounded-xl p-5 relative overflow-hidden transition-all duration-300 hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-950/30 flex flex-col justify-between ${
      isDown ? 'border-rose-500/60 bg-rose-950/15 ring-1 ring-rose-500/30' : 
      isDegraded ? 'border-amber-500/50 bg-amber-950/10' : ''
    }`}>
      {/* Top indicator ribbon */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${
        isHealthy ? 'bg-emerald-500' : isDown ? 'bg-rose-500 animate-pulse' : 'bg-amber-500'
      }`} />

      <div>
        {/* Header Row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isHealthy ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60' : 
              isDown ? 'bg-rose-950/50 text-rose-400 border border-rose-800/60' : 
              'bg-amber-950/50 text-amber-400 border border-amber-800/60'
            }`}>
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white tracking-wide font-mono text-sm capitalize">
                  {service.name.replace('-service', '')} Service
                </h3>
                {isDemoTarget && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono font-semibold">
                    TARGET
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400 font-mono">Port: {port}</span>
            </div>
          </div>

          {/* Explicit Status Badge */}
          <div className={`px-2.5 py-1 rounded-full text-xs font-semibold font-mono flex items-center gap-1.5 ${
            isHealthy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
            isDown ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse' :
            'bg-amber-500/10 text-amber-400 border border-amber-500/30'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-400 animate-ping inline-block' : isDown ? 'bg-rose-400' : 'bg-amber-400'}`} />
            <span>{service.status || 'UNKNOWN'}</span>
          </div>
        </div>

        {/* 4-Metric Grid with Sparkline */}
        <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-800/80 text-xs font-mono">
          <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                <Zap className="w-3 h-3 text-cyan-400" /> Latency
              </span>
              {/* Mini SVG Sparkline */}
              <svg className="w-12 h-4 overflow-visible" viewBox="0 0 50 30">
                <polyline
                  fill="none"
                  stroke={isDown ? '#f43f5e' : isDegraded ? '#fbbf24' : '#00d4ff'}
                  strokeWidth="2"
                  points={sparklinePoints}
                />
              </svg>
            </div>
            <p className={`font-bold mt-1 text-sm ${
              latency > 2000 ? 'text-amber-400' : 'text-slate-100'
            }`}>
              {latency}ms
            </p>
          </div>

          <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900">
            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
              <Activity className="w-3 h-3 text-rose-400" /> Error Rate
            </span>
            <p className={`font-bold mt-1 text-sm ${isDown ? 'text-rose-400' : 'text-emerald-400'}`}>
              {errorRate}
            </p>
          </div>

          <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900">
            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
              <Clock className="w-3 h-3 text-purple-400" /> Availability
            </span>
            <p className="font-bold text-slate-200 mt-1 text-sm">
              {availability}
            </p>
          </div>

          <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900">
            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Health
            </span>
            <p className={`font-bold mt-1 text-sm ${isDown ? 'text-rose-400' : 'text-emerald-400'}`}>
              {healthPercent}
            </p>
          </div>
        </div>

        {/* Dependencies Row */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono">
          <span className="text-slate-500">Dependencies:</span>
          <div className="flex items-center gap-1.5">
            {deps.map((d, i) => (
              <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {d.replace(' Service', '')}
              </span>
            ))}
          </div>
        </div>

        {/* Last Incident Indicator */}
        <div className="mt-2 text-[10px] font-mono flex items-center justify-between text-slate-500">
          <span>Incident Status:</span>
          {activeInc ? (
            <span className="text-rose-400 font-bold flex items-center gap-1 animate-pulse">
              ● Active Incident ({activeInc.type})
            </span>
          ) : lastInc ? (
            <span className="text-slate-400">
              Last: {new Date(lastInc.createdAt).toLocaleTimeString()} (Resolved)
            </span>
          ) : (
            <span className="text-emerald-400">● 0 Active Incidents</span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2">
        <button
          onClick={() => onSelectService && onSelectService(service)}
          className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-700/60 hover:border-cyan-500 text-cyan-300 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
        >
          <span>View Details</span>
          <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
        </button>

        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
          title="Open raw /health endpoint"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
