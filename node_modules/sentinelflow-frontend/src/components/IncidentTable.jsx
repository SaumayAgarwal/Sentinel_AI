import React from 'react';
import { AlertOctagon, CheckCircle2, Clock, ChevronRight, Eye } from 'lucide-react';

export default function IncidentTable({ incidents, onSelectIncident, onAcknowledge }) {
  return (
    <div className="glass-panel rounded-xl p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white tracking-tight">Active & Recent Incidents</h2>
        </div>
        <span className="text-xs font-mono text-slate-400">Total: {incidents.length}</span>
      </div>

      {incidents.length === 0 ? (
        <div className="text-center py-8 text-slate-500 font-mono text-sm border border-dashed border-slate-800 rounded-lg">
          No incidents detected. All services operating within parameters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Incident ID</th>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {incidents.map((inc) => {
                const isResolved = inc.status === 'RESOLVED';
                const isCritical = inc.severity === 'CRITICAL';
                
                return (
                  <tr 
                    key={inc.id}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    onClick={() => onSelectIncident(inc)}
                  >
                    <td className="py-3 px-4 font-bold text-cyan-400 group-hover:underline">
                      {inc.id.substring(0, 14)}
                    </td>
                    <td className="py-3 px-4 text-slate-200 capitalize font-medium">
                      {inc.serviceName}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {inc.type}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isCritical ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                        inc.severity === 'HIGH' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center w-max gap-1 ${
                        isResolved ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                        inc.status === 'RECOVERING' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800 animate-pulse' :
                        'bg-rose-950 text-rose-400 border border-rose-800 animate-pulse'
                      }`}>
                        {isResolved ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {inc.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(inc.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectIncident(inc);
                        }}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 hover:text-cyan-400 text-slate-300 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
