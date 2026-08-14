import React from 'react';
import { X, Clock, ShieldAlert, Check, Activity, RefreshCw, AlertTriangle, CheckCircle2, Zap, Radio } from 'lucide-react';

// Map event names → icon + colour
const getStepStyle = (event = '') => {
  const e = event.toLowerCase();
  if (e.includes('resolved') || e.includes('resolution')) return { icon: CheckCircle2, color: 'border-emerald-400 bg-emerald-950', text: 'text-emerald-300' };
  if (e.includes('recovered') || e.includes('recovery success')) return { icon: CheckCircle2, color: 'border-emerald-400 bg-emerald-950', text: 'text-emerald-300' };
  if (e.includes('recovery attempt')) return { icon: RefreshCw, color: 'border-cyan-400 bg-cyan-950', text: 'text-cyan-300' };
  if (e.includes('incident created') || e.includes('incident opened')) return { icon: ShieldAlert, color: 'border-amber-400 bg-amber-950', text: 'text-amber-300' };
  if (e.includes('threshold reached') || e.includes('kafka') || e.includes('published')) return { icon: Radio, color: 'border-purple-400 bg-purple-950', text: 'text-purple-300' };
  if (e.includes('acknowledged')) return { icon: Check, color: 'border-blue-400 bg-blue-950', text: 'text-blue-300' };
  if (e.includes('health check') || e.includes('failed') || e.includes('failure')) return { icon: AlertTriangle, color: 'border-rose-400 bg-rose-950', text: 'text-rose-300' };
  return { icon: Activity, color: 'border-slate-500 bg-slate-900', text: 'text-slate-300' };
};

export default function IncidentDetailModal({ incident, onClose, onAcknowledge }) {
  if (!incident) return null;

  const timeline = Array.isArray(incident.timeline) ? [...incident.timeline].reverse() : [];

  const statusColors = {
    OPEN: 'text-rose-400 bg-rose-950/60 border-rose-800',
    ACKNOWLEDGED: 'text-amber-400 bg-amber-950/60 border-amber-800',
    INVESTIGATING: 'text-cyan-400 bg-cyan-950/60 border-cyan-800',
    RECOVERING: 'text-purple-400 bg-purple-950/60 border-purple-800',
    RESOLVED: 'text-emerald-400 bg-emerald-950/60 border-emerald-800',
    FAILED: 'text-red-400 bg-red-950/60 border-red-800',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white font-mono">{incident.id}</h2>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-xs border border-slate-700">
                  {incident.serviceName}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${statusColors[incident.status] || 'text-slate-400 bg-slate-800 border-slate-700'}`}>
                  {incident.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Type: <span className="text-cyan-400">{incident.type}</span> · Severity: <span className={incident.severity === 'CRITICAL' ? 'text-rose-400' : 'text-amber-400'}>{incident.severity}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {/* Timing Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wide">Created At</p>
              <p className="text-xs text-slate-200 font-mono mt-0.5">{new Date(incident.createdAt).toLocaleString()}</p>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wide">{incident.resolvedAt ? 'Resolved At' : 'Time Active'}</p>
              <p className="text-xs text-slate-200 font-mono mt-0.5">
                {incident.resolvedAt
                  ? new Date(incident.resolvedAt).toLocaleString()
                  : `${Math.round((Date.now() - new Date(incident.createdAt).getTime()) / 1000)}s ago`}
              </p>
            </div>
          </div>

          {/* Acknowledge Button */}
          {incident.status === 'OPEN' && (
            <div className="flex items-center justify-end">
              <button
                onClick={() => onAcknowledge(incident.id)}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold font-mono text-xs flex items-center gap-2 transition-colors"
              >
                <Check className="w-4 h-4" /> Acknowledge Incident
              </button>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-bold text-slate-200 font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400" />
              Incident Timeline
              <span className="text-xs text-slate-500 font-normal normal-case">({timeline.length} events)</span>
            </h3>

            {timeline.length === 0 && (
              <p className="text-xs text-slate-500 font-mono italic">No timeline events recorded yet.</p>
            )}

            <div className="relative pl-7 border-l-2 border-slate-800 space-y-5">
              {timeline.map((step, idx) => {
                const { icon: Icon, color, text } = getStepStyle(step.event);
                const isLatest = idx === 0;
                return (
                  <div key={idx} className="relative group">
                    {/* Dot */}
                    <div className={`absolute -left-[35px] top-0.5 w-4 h-4 rounded-full border-2 ${color} ${isLatest ? 'ring-2 ring-offset-1 ring-offset-slate-950 ring-cyan-500/40' : ''}`}>
                      <Icon className={`w-2.5 h-2.5 absolute inset-0 m-auto ${text}`} />
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className={`font-mono text-xs font-bold ${text}`}>{step.event}</span>
                      <span className="font-mono text-[10px] text-slate-500 tabular-nums ml-4">
                        {new Date(step.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {step.details && (
                      <p className="text-xs text-slate-400 mt-0.5 font-mono leading-relaxed">{step.details}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
