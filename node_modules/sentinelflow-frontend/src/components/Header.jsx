import React from 'react';
import { ShieldAlert, Activity, CheckCircle2, AlertTriangle, XCircle, Radio, Network } from 'lucide-react';

export default function Header({ services, incidents, isConnected, onOpenGraph }) {
  const total = services.length || 4;
  const healthy = services.filter(s => s.status === 'HEALTHY').length;
  const down = services.filter(s => s.status === 'DOWN').length;

  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED').length;

  return (
    <header className="glass-panel sticky top-0 z-40 border-b border-slate-800 px-6 py-4 mb-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        
        {/* Brand & Connection Status */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-mono">SentinelFlow</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
                v1.0 Distributed SRE
              </span>
            </div>
            <p className="text-xs text-slate-400">Incident Detection & Automated Recovery</p>
          </div>
        </div>

        {/* Action Controls & Live Stats */}
        <div className="flex flex-wrap items-center gap-4">
          
          {/* Topology Graph Modal Trigger Button */}
          <button
            onClick={onOpenGraph}
            className="px-3.5 py-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300 font-mono text-xs font-semibold flex items-center gap-2 transition-all shadow-lg hover:shadow-cyan-950/50 hover:border-cyan-500"
          >
            <Network className="w-4 h-4 text-cyan-400" />
            <span>View Topology Graph</span>
          </button>

          {/* Live WS Status Indicator */}
          <div className="flex items-center space-x-2 text-xs font-mono bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800">
            <Radio className={`w-4 h-4 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
            <span className={isConnected ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
              {isConnected ? 'LIVE STREAM' : 'OFFLINE'}
            </span>
          </div>

          {/* Quick Stats Badges */}
          <div className="hidden sm:grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-900/50 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-300">Healthy:</span>
              <span className="font-bold text-emerald-400">{healthy}</span>
            </div>

            <div className="bg-rose-950/40 px-3 py-1.5 rounded-lg border border-rose-900/50 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-rose-300">Down:</span>
              <span className="font-bold text-rose-400">{down}</span>
            </div>

            <div className="bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-900/50 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300">Incidents:</span>
              <span className="font-bold text-amber-400">{activeIncidents}</span>
            </div>
          </div>
        </div>

      </div>
    </header>
  );
}
