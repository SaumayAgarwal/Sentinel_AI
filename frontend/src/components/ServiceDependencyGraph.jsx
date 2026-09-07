import React, { useState, useEffect } from 'react';
import { 
  Server, Activity, Radio, ShieldAlert, RefreshCw, Bell, Database, HardDrive, 
  ArrowDown, CheckCircle2, AlertTriangle, XCircle, Info, Zap, ChevronRight, X 
} from 'lucide-react';

export default function ServiceDependencyGraph({ services = [], infraStatus = {}, incidents = [], events = [], onClose, onSelectService }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [activePulse, setActivePulse] = useState(false);

  // Trigger brief pulse animation whenever a new Kafka event arrives
  useEffect(() => {
    if (events.length > 0) {
      setActivePulse(true);
      const timer = setTimeout(() => setActivePulse(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [events]);

  // Derive microservices dynamically from services prop
  const microservices = services.map(s => ({
    name: s.name || s.serviceId,
    status: s.status || 'HEALTHY',
    port: s.port || 3000,
    latencyMs: s.lastLatencyMs || 0,
    consecutiveFailures: s.consecutiveFailures || 0,
    type: 'MICROSERVICE'
  }));

  const failingMicroservices = microservices.filter(s => s.status === 'DOWN' || s.status === 'DEGRADED');
  const hasFailure = failingMicroservices.length > 0;

  // Infrastructure node helper
  const getInfraNode = (id, name, port, defaultRole, key) => {
    const info = infraStatus[key] || {};
    const isUp = info.status === 'UP' || info.status === 'HEALTHY' || info.status === undefined;
    return {
      id,
      name,
      port,
      role: defaultRole,
      status: isUp ? 'HEALTHY' : 'DOWN',
      details: info.details || `Listening on TCP port ${port}`,
      type: 'INFRASTRUCTURE'
    };
  };

  const monitoringNode = getInfraNode('monitoring', 'Monitoring Service', 3005, 'Health Aggregator & Event Dispatcher', 'monitoringService');
  const kafkaNode = getInfraNode('kafka', 'Kafka Broker', 9092, 'Event Bus (KRaft Topic: service-events)', 'kafka');
  const incidentNode = getInfraNode('incident', 'Incident Service', 3006, 'Deduplication & State Engine', 'incidentService');
  const recoveryNode = getInfraNode('recovery', 'Recovery Service', 3007, 'Auto-healing & Exponential Backoff', 'recoveryService');
  const notifNode = getInfraNode('notification', 'Notification Service', 3008, 'Alert & Webhook Dispatcher', 'notificationService');
  const redisNode = getInfraNode('redis', 'Redis Cache', 6379, 'Active Incident Mutex & Cache', 'redis');
  const postgresNode = getInfraNode('postgres', 'PostgreSQL DB', 5433, 'Persistent Incident Storage', 'postgres');

  // Status styling helpers
  const getStatusBadge = (status) => {
    switch (status) {
      case 'DOWN':
        return {
          bg: 'bg-rose-950/80 border-rose-600 text-rose-400',
          dot: 'bg-rose-500 animate-ping',
          icon: XCircle,
          label: 'DOWN'
        };
      case 'DEGRADED':
        return {
          bg: 'bg-amber-950/80 border-amber-600 text-amber-400',
          dot: 'bg-amber-500 animate-pulse',
          icon: AlertTriangle,
          label: 'DEGRADED'
        };
      default:
        return {
          bg: 'bg-emerald-950/80 border-emerald-600 text-emerald-400',
          dot: 'bg-emerald-500',
          icon: CheckCircle2,
          label: 'HEALTHY'
        };
    }
  };

  const content = (
    <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-6 shadow-2xl relative overflow-hidden bg-slate-950/95 max-h-[90vh] overflow-y-auto">
      
      {/* Section Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-400">
              <Activity className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-white font-mono tracking-wide">
              Service Dependency & Topology Graph
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Real-time event topology: Microservices → Monitoring → Kafka Broker → Platform Consumers → Persistence
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono bg-slate-900/80 px-3.5 py-2 rounded-xl border border-slate-800">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Healthy</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span>Degraded</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              <span>Down</span>
            </div>
            <div className="flex items-center gap-1.5 text-cyan-400">
              <Zap className={`w-3 h-3 ${activePulse ? 'animate-bounce text-cyan-300' : ''}`} />
              <span>Event Flow</span>
            </div>
          </div>

          {/* Close Modal Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-slate-700"
              title="Close Topology Visualizer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Dependency Flow Pipeline (5 Tiers) */}
      <div className="space-y-6 relative pt-2 pb-2">

        {/* Failure Banner Alert if any microservice is Down/Degraded */}
        {hasFailure && (
          <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono text-rose-300 animate-pulse">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>ALERT:</strong> Active failure in {failingMicroservices.map(s => s.name).join(', ')}. Failure propagation path highlighted below.
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-rose-900/80 border border-rose-700 text-[10px] uppercase tracking-wider font-bold">
              Tracing Route
            </span>
          </div>
        )}

        {/* ─── TIER 1: Monitored Microservices ─── */}
        <div>
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            Tier 1: Monitored Microservices (Health Probed)
          </div>
          {microservices.length === 0 ? (
            <div className="text-center py-8 text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-900/40">
              NO CONNECTED SERVICES — No microservices configured or active for this project topology.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              {microservices.map((svc) => {
                const badge = getStatusBadge(svc.status);
                const isFailing = svc.status !== 'HEALTHY';
                return (
                  <button
                    key={svc.name}
                    onClick={() => setSelectedNode({ ...svc, role: 'Core Business Microservice' })}
                    className={`p-3.5 rounded-xl border text-left transition-all duration-200 relative group ${
                      isFailing
                        ? 'bg-rose-950/30 border-rose-600/80 shadow-lg shadow-rose-950/50 ring-1 ring-rose-500/40'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-white group-hover:text-cyan-300 transition-colors">
                        {svc.name}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1 ${badge.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}></span>
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Port: <strong className="text-slate-200">{svc.port}</strong></span>
                      <span>{svc.latencyMs}ms</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Directional Connection Lines T1 -> T2 */}
        <div className="flex justify-center my-1 relative">
          <div className={`h-6 w-0.5 transition-colors ${hasFailure ? 'bg-rose-500 animate-pulse' : activePulse ? 'bg-cyan-400' : 'bg-slate-800'}`} />
          <ArrowDown className={`w-4 h-4 absolute -bottom-2 ${hasFailure ? 'text-rose-400 animate-bounce' : activePulse ? 'text-cyan-400' : 'text-slate-600'}`} />
        </div>

        {/* ─── TIER 2: Monitoring Service ─── */}
        <div>
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            Tier 2: Health Aggregation Engine
          </div>
          <div className="max-w-md mx-auto">
            <button
              onClick={() => setSelectedNode(monitoringNode)}
              className={`w-full p-4 rounded-xl border text-center transition-all duration-200 relative group ${
                hasFailure 
                  ? 'bg-amber-950/30 border-amber-600/80 ring-1 ring-amber-500/30'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-cyan-300">
                    {monitoringNode.name}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port {monitoringNode.port}</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono text-left">
                Polls microservices every 5s • Accumulates failure count • Dispatches Kafka events
              </p>
            </button>
          </div>
        </div>

        {/* Directional Connection Lines T2 -> T3 */}
        <div className="flex justify-center my-1 relative">
          <div className={`h-6 w-0.5 transition-colors ${hasFailure ? 'bg-amber-500 animate-pulse' : activePulse ? 'bg-purple-400' : 'bg-slate-800'}`} />
          <ArrowDown className={`w-4 h-4 absolute -bottom-2 ${hasFailure ? 'text-amber-400 animate-bounce' : activePulse ? 'text-purple-400' : 'text-slate-600'}`} />
        </div>

        {/* ─── TIER 3: Kafka Broker ─── */}
        <div>
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
            Tier 3: Distributed Event Broker (Kafka)
          </div>
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => setSelectedNode(kafkaNode)}
              className={`w-full p-4 rounded-xl border text-center transition-all duration-200 relative group ${
                activePulse
                  ? 'bg-purple-950/40 border-purple-500 ring-2 ring-purple-500/50'
                  : hasFailure
                  ? 'bg-slate-900/80 border-amber-600/70'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-purple-300">
                    {kafkaNode.name}
                  </span>
                  {activePulse && (
                    <span className="px-2 py-0.5 rounded bg-purple-900 text-purple-300 text-[10px] font-mono animate-pulse">
                      ⚡ STREAMING EVENT
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port {kafkaNode.port}</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono text-left">
                KRaft Cluster • Topics: <code className="text-purple-300">service-events</code>, <code className="text-cyan-300">incident-events</code>, <code className="text-emerald-300">recovery-events</code>
              </p>
            </button>
          </div>
        </div>

        {/* Directional Connection Lines T3 -> T4 */}
        <div className="flex justify-center my-1 relative">
          <div className={`h-6 w-0.5 transition-colors ${hasFailure ? 'bg-rose-500 animate-pulse' : activePulse ? 'bg-purple-400' : 'bg-slate-800'}`} />
          <ArrowDown className={`w-4 h-4 absolute -bottom-2 ${hasFailure ? 'text-rose-400 animate-bounce' : activePulse ? 'text-purple-400' : 'text-slate-600'}`} />
        </div>

        {/* ─── TIER 4: Consumer & Recovery Microservices ─── */}
        <div>
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Tier 4: SRE Platform Consumers & Orchestrators
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            
            {/* Incident Service */}
            <button
              onClick={() => setSelectedNode(incidentNode)}
              className={`p-3.5 rounded-xl border text-left transition-all duration-200 group ${
                hasFailure
                  ? 'bg-rose-950/30 border-rose-600/80 ring-1 ring-rose-500/40'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-rose-300">
                    Incident Service
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port 3006</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Redis Mutex Dedup • Open/Resolve Incidents • Calculates MTTD/MTTR
              </p>
            </button>

            {/* Recovery Service */}
            <button
              onClick={() => setSelectedNode(recoveryNode)}
              className={`p-3.5 rounded-xl border text-left transition-all duration-200 group ${
                hasFailure
                  ? 'bg-purple-950/30 border-purple-600/80 ring-1 ring-purple-500/40'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-cyan-300">
                    Recovery Service
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port 3007</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Automated Self-Healing • Exponential Backoff (2s, 4s, 8s)
              </p>
            </button>

            {/* Notification Service */}
            <button
              onClick={() => setSelectedNode(notifNode)}
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 text-left transition-all duration-200 group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-amber-300">
                    Notification Service
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port 3008</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Consumes Incident Events • Alerts SRE Team • Dispatches Webhooks
              </p>
            </button>

          </div>
        </div>

        {/* Directional Connection Lines T4 -> T5 */}
        <div className="flex justify-center my-1 relative">
          <div className="h-6 w-0.5 bg-slate-800" />
          <ArrowDown className="w-4 h-4 text-slate-600 absolute -bottom-2" />
        </div>

        {/* ─── TIER 5: Data Stores ─── */}
        <div>
          <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Tier 5: Persistence & Cache Tier
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-w-2xl mx-auto">
            
            <button
              onClick={() => setSelectedNode(redisNode)}
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 text-left transition-all duration-200 group"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-rose-300">
                    Redis Cache
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port 6379</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Active incident mutex lock: <code className="text-amber-300 text-[10px]">incident:active:{'{service}'}</code>
              </p>
            </button>

            <button
              onClick={() => setSelectedNode(postgresNode)}
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 text-left transition-all duration-200 group"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white group-hover:text-cyan-300">
                    PostgreSQL DB
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">Port 5433</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Prisma ORM • Incident Audit Logs • Multi-stage Timelines
              </p>
            </button>

          </div>
        </div>

      </div>

      {/* Compact Interactive Node Inspector Panel Modal */}
      {selectedNode && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-lg rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">{selectedNode.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">Port {selectedNode.port} • {selectedNode.type}</p>
                </div>
              </div>

              <button 
                onClick={() => setSelectedNode(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 font-mono text-xs">
              
              {/* Status Row */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400">Current Health Status</span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusBadge(selectedNode.status).bg}`}>
                  {selectedNode.status}
                </span>
              </div>

              {/* Node Role & Details */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Architecture Role</p>
                <p className="text-slate-200 leading-relaxed">{selectedNode.role || selectedNode.details}</p>
              </div>

              {/* Latency & Failure info for Microservices */}
              {selectedNode.type === 'MICROSERVICE' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Last Latency</p>
                    <p className="text-cyan-400 text-sm font-bold mt-0.5">{selectedNode.latencyMs} ms</p>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Consecutive Failures</p>
                    <p className={`text-sm font-bold mt-0.5 ${selectedNode.consecutiveFailures > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedNode.consecutiveFailures}
                    </p>
                  </div>
                </div>
              )}

              {/* Recent Events relating to this node */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2">Recent Stream Events</p>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-36 overflow-y-auto space-y-1.5">
                  {events.filter(e => e.service?.toLowerCase().includes(selectedNode.name.toLowerCase().split(' ')[0])).length > 0 ? (
                    events.filter(e => e.service?.toLowerCase().includes(selectedNode.name.toLowerCase().split(' ')[0])).slice(0, 5).map((evt, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[11px] border-b border-slate-900 pb-1">
                        <span className="text-slate-300">{evt.eventType}</span>
                        <span className="text-slate-500 text-[10px]">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 italic text-[11px]">No active incident events recorded for this component.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
              {selectedNode.type === 'MICROSERVICE' && onSelectService ? (
                <button
                  onClick={() => {
                    const match = services.find(s => s.name?.includes(selectedNode.name.toLowerCase().split(' ')[0]));
                    if (match) onSelectService(match);
                    else onSelectService({ name: selectedNode.name, status: selectedNode.status, port: selectedNode.port });
                    if (onClose) onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <span>Open Service Observability</span>
                  <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
                </button>
              ) : <div />}
              <button
                onClick={() => setSelectedNode(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Close Inspector
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );

  if (onClose) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          {content}
        </div>
      </div>
    );
  }

  return content;
}
