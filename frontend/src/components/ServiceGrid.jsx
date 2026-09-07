import React from 'react';
import { Server, Activity } from 'lucide-react';
import ServiceCard from './ServiceCard';

export default function ServiceGrid({ services = [], onSelectService, incidents = [], loading = false }) {
  const healthyCount = services.filter(s => s.status === 'HEALTHY').length;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
          <h2 className="text-lg font-bold text-white tracking-tight font-mono">
            Monitored Microservices
          </h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
            {healthyCount}/{services.length} Healthy
          </span>
        </div>
        <span className="text-xs font-mono text-slate-400">
          Autonomous Telemetry Probing Active (2s cadence)
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
          Loading project services...
        </div>
      ) : services.length === 0 ? (
        <div className="py-12 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
          NO SERVICES — No microservices configured or registered for this project.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.map(s => (
            <ServiceCard 
              key={s.name || s.serviceId} 
              service={s} 
              onSelectService={onSelectService} 
              incidents={incidents}
            />
          ))}
        </div>
      )}
    </section>
  );
}
