import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal, Activity, AlertTriangle, ShieldCheck, Cpu, ChevronDown, 
  ChevronRight, Filter, Copy, Check, Radio, Sparkles, RefreshCw, Zap
} from 'lucide-react';

export default function EventStream({ events = [], loading = false }) {
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  const handleCopyJson = (evt) => {
    navigator.clipboard.writeText(JSON.stringify(evt, null, 2));
    setCopiedId(evt.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredEvents = events.filter(evt => {
    const type = evt.type || '';
    const dType = evt.data?.eventType || evt.data?.type || '';
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'AI') return type.includes('AI') || dType.includes('AI') || dType.includes('RCA');
    if (activeFilter === 'INCIDENTS') return type.includes('INCIDENT') || dType.includes('INCIDENT') || dType.includes('FAIL');
    if (activeFilter === 'RECOVERY') return type.includes('RECOVERY') || dType.includes('RECOVER');
    if (activeFilter === 'SERVICES') return type.includes('SERVICE') || dType.includes('SERVICE');
    return true;
  });

  const getEventCategoryBadge = (evt) => {
    const type = evt.type || '';
    const dType = evt.data?.eventType || evt.data?.type || '';
    if (type.includes('AI') || dType.includes('AI') || dType.includes('RCA')) {
      return { label: 'AI RCA', style: 'bg-purple-950 text-purple-300 border-purple-800' };
    }
    if (type.includes('RECOVERY') || dType.includes('RECOVER')) {
      return { label: 'RECOVERY', style: 'bg-emerald-950 text-emerald-300 border-emerald-800' };
    }
    if (type.includes('INCIDENT') || dType.includes('FAIL')) {
      return { label: 'INCIDENT', style: 'bg-rose-950 text-rose-300 border-rose-800' };
    }
    return { label: 'SERVICE', style: 'bg-cyan-950 text-cyan-300 border-cyan-800' };
  };

  return (
    <div className="glass-panel rounded-xl p-5 mb-8">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-base font-bold text-white tracking-tight font-mono">
              Live Kafka Event Bus Stream
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Topics: <span className="text-cyan-400">service-events</span> · <span className="text-purple-400">incident-events</span> · <span className="text-emerald-400">recovery-events</span>
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          {['ALL', 'AI', 'INCIDENTS', 'RECOVERY', 'SERVICES'].map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition-all ${
                activeFilter === f
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`ml-2 px-2 py-1 rounded text-[10px] border ${
              autoScroll ? 'bg-slate-900 text-slate-400 border-slate-800' : 'bg-amber-950 text-amber-300 border-amber-800'
            }`}
          >
            {autoScroll ? 'AUTO-SCROLL ON' : 'PAUSED'}
          </button>
        </div>
      </div>

      {/* Event Stream Container */}
      <div 
        ref={scrollRef}
        className="h-80 overflow-y-auto bg-slate-950/90 rounded-xl p-3 font-mono text-xs border border-slate-800 space-y-2"
      >
        {loading ? (
          <div className="text-slate-400 font-mono text-xs italic py-12 text-center">
            Loading project events...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-slate-500 italic py-12 text-center">
            {events.length === 0
              ? 'NO EVENTS — No live Kafka events recorded for this project.'
              : 'No events match the active category filter.'}
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const data = evt.data || {};
            const isExpanded = expandedEventId === evt.id;
            const badge = getEventCategoryBadge(evt);
            const serviceName = data.service || data.serviceId || evt.service;

            return (
              <div 
                key={evt.id} 
                className="rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-cyan-800/60 transition-colors overflow-hidden"
              >
                {/* Compact Row */}
                <div 
                  onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                  className="flex items-center gap-2.5 p-2.5 cursor-pointer hover:bg-slate-850 select-none"
                >
                  <button className="text-slate-500 hover:text-cyan-400">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  <span className="text-slate-500 text-[10px] tabular-nums whitespace-nowrap">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>

                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border uppercase ${badge.style}`}>
                    {badge.label}
                  </span>

                  <span className="text-slate-200 font-bold text-xs whitespace-nowrap">
                    {(() => {
                      const rawType = data.eventType || data.type || evt.type || '';
                      if (rawType === 'UNKNOWN_EVENT' || !rawType) {
                        return evt.type === 'notification-events' || evt.service === 'notification-service'
                          ? 'NOTIFICATION'
                          : 'EVENT';
                      }
                      return rawType;
                    })()}
                  </span>

                  {serviceName && (
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 text-[10px] border border-slate-700">
                      {serviceName}
                    </span>
                  )}

                  <span className="text-slate-400 text-xs truncate flex-1">
                    {data.error || data.message || data.details || JSON.stringify(data.incident || data).slice(0, 80)}
                  </span>

                  <span className="text-[10px] text-slate-500 hidden sm:inline font-mono" title={evt.id}>
                    ID: {data.eventId || (typeof evt.id === 'string' && evt.id.startsWith('evt-') ? evt.id.slice(-6) : String(evt.id).slice(0, 8))}
                  </span>
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="p-3 bg-slate-950/80 border-t border-slate-800 space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">EVENT ID</span>
                        <span className="text-slate-300 font-semibold">{evt.id}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">PROJECT</span>
                        <span className="text-cyan-400 font-semibold">{data.projectId || 'ecommerce-001'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">SEVERITY</span>
                        <span className="text-amber-400 font-semibold">{data.severity || 'HIGH'}</span>
                      </div>
                      <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                        <span className="text-slate-500 block text-[9px]">TIMESTAMP</span>
                        <span className="text-slate-300 font-semibold">{new Date(evt.timestamp).toISOString()}</span>
                      </div>
                    </div>

                    {/* Raw JSON Payload */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 uppercase font-bold">Raw Payload:</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyJson(evt);
                          }}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-400"
                        >
                          {copiedId === evt.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedId === evt.id ? 'Copied' : 'Copy JSON'}</span>
                        </button>
                      </div>
                      <pre className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-[10px] text-slate-300 overflow-x-auto max-h-40">
                        {JSON.stringify(evt, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
