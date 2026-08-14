import React, { useRef, useEffect } from 'react';
import { Terminal, Activity, AlertTriangle, ShieldCheck, Cpu } from 'lucide-react';

export default function EventStream({ events }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events]);

  return (
    <div className="glass-panel rounded-xl p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white tracking-tight">Live Kafka Event Bus Stream</h2>
        </div>
        <span className="text-xs font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 animate-pulse">
          SOCKET.IO BROADCAST ACTIVE
        </span>
      </div>

      <div 
        ref={scrollRef}
        className="h-64 overflow-y-auto bg-slate-950/90 rounded-lg p-4 font-mono text-xs border border-slate-800 space-y-2"
      >
        {events.length === 0 ? (
          <div className="text-slate-500 italic py-4 text-center">Listening for event stream on Kafka topics...</div>
        ) : (
          events.map((evt) => {
            const data = evt.data || {};
            const isIncident = evt.type === 'INCIDENT_EVENT';
            const isRecovery = evt.type === 'RECOVERY_EVENT';
            const isService = evt.type === 'SERVICE_EVENT';

            return (
              <div 
                key={evt.id} 
                className="flex items-start gap-2 p-2 rounded bg-slate-900/60 border border-slate-800/80 hover:border-cyan-800 transition-colors"
              >
                <span className="text-slate-500 text-[10px] whitespace-nowrap pt-0.5">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>

                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  isIncident ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                  isRecovery ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' :
                  'bg-emerald-950 text-emerald-400 border border-emerald-800'
                }`}>
                  {evt.type}
                </span>

                <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  <span className="text-slate-200 font-semibold">
                    {data.eventType || data.type || 'EVENT'}:
                  </span>{' '}
                  <span className="text-slate-400">
                    {data.service ? `[${data.service}] ` : ''}
                    {data.error || data.message || JSON.stringify(data.incident || data)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
