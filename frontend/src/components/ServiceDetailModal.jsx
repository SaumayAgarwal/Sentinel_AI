import React, { useState, useEffect } from 'react';
import { 
  X, Server, Activity, Zap, Database, Clock, ShieldAlert, Terminal, 
  RefreshCw, AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, 
  Filter, Search, Sparkles, Flame, Check, Radio, Layers
} from 'lucide-react';
import { 
  fetchServiceHealth, 
  fetchServiceDependencies, 
  fetchServiceLogs, 
  fetchHistoricalIncidents,
  simulateFailure,
  triggerRecovery 
} from '../services/api';

export default function ServiceDetailModal({ 
  service, 
  projectId = 'ecommerce-001', 
  incidents = [], 
  onClose, 
  onSelectIncident,
  onActionTriggered 
}) {
  if (!service) return null;

  const [activeTab, setActiveTab] = useState('overview');
  const [healthData, setHealthData] = useState(null);
  const [dependencies, setDependencies] = useState([]);
  const [logs, setLogs] = useState([]);
  const [historicalCases, setHistoricalCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const servicePorts = {
    'user-service': 3001,
    'order-service': 3002,
    'payment-service': 3003,
    'inventory-service': 3004,
    'auth-service': 3021,
    'account-service': 3022,
    'transaction-service': 3023,
    'fraud-detection-service': 3024,
    'notification-service': 3025
  };
  const port = servicePorts[service.name || service.serviceId] || 3003;
  const isHealthy = service.status === 'HEALTHY';
  const isDown = service.status === 'DOWN';
  const isDegraded = service.status === 'DEGRADED';

  // Load telemetry when modal opens or service changes
  useEffect(() => {
    let isMounted = true;
    const loadDetails = async () => {
      setLoading(true);
      try {
        const [health, deps, svcLogs, hist] = await Promise.all([
          fetchServiceHealth(projectId, service.name),
          fetchServiceDependencies(projectId, service.name),
          fetchServiceLogs(projectId, service.name, 50),
          fetchHistoricalIncidents(projectId, service.name)
        ]);
        if (isMounted) {
          if (health) setHealthData(health);
          if (deps?.dependencies) setDependencies(deps.dependencies);
          if (Array.isArray(svcLogs)) setLogs(svcLogs);
          if (Array.isArray(hist)) setHistoricalCases(hist);
        }
      } catch (err) {
        console.error('Failed to load service details:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadDetails();
    return () => { isMounted = false; };
  }, [service.name, projectId]);

  const handleSimulate = async (mode) => {
    setActionLoading(true);
    try {
      if (mode === 'RECOVER') {
        await triggerRecovery(service.name);
        setActionFeedback({ type: 'SUCCESS', message: `Recovery signal dispatched to ${service.name}` });
      } else {
        await simulateFailure(service.name, mode);
        setActionFeedback({ type: 'WARNING', message: `Injected ${mode} into ${service.name}` });
      }
      if (onActionTriggered) onActionTriggered();
    } catch (err) {
      setActionFeedback({ type: 'ERROR', message: `Action failed: ${err.message}` });
    } finally {
      setActionLoading(false);
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesLevel = logFilter === 'ALL' || log.level?.toUpperCase() === logFilter;
    const matchesSearch = !logSearch || 
      (log.message && log.message.toLowerCase().includes(logSearch.toLowerCase())) ||
      (log.context && JSON.stringify(log.context).toLowerCase().includes(logSearch.toLowerCase()));
    return matchesLevel && matchesSearch;
  });

  // Filter incidents for this service
  const serviceIncidents = incidents.filter(i => 
    i.serviceName === service.name || i.serviceId === service.name
  );

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Telemetry & SRE' },
    { id: 'logs', label: `Logs (${logs.length})` },
    { id: 'dependencies', label: `Dependencies (${dependencies.length})` },
    { id: 'incidents', label: `Incidents (${serviceIncidents.length})` },
    { id: 'ai-insights', label: `AI Patterns (${historicalCases.length})` }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-4xl rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] bg-slate-950/95">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center space-x-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              isHealthy ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700' :
              isDown ? 'bg-rose-950/80 text-rose-400 border border-rose-700' :
              'bg-amber-950/80 text-amber-400 border border-amber-700'
            }`}>
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white font-mono capitalize">
                  {service.name}
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border flex items-center gap-1.5 ${
                  isHealthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                  isDown ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse' :
                  'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-400' : isDown ? 'bg-rose-400' : 'bg-amber-400'}`} />
                  {service.status}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono border border-slate-700">
                  Port: {port}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Project: <span className="text-cyan-400 font-semibold">{projectId}</span> · Environment: <span className="text-slate-300">Production</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/50 px-6 gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-3.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Action feedback toast */}
        {actionFeedback && (
          <div className={`mx-6 mt-4 p-2.5 rounded-lg text-xs font-mono flex items-center justify-between ${
            actionFeedback.type === 'SUCCESS' ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300' :
            actionFeedback.type === 'WARNING' ? 'bg-amber-950/60 border border-amber-800 text-amber-300' :
            'bg-rose-950/60 border border-rose-800 text-rose-300'
          }`}>
            <span>{actionFeedback.message}</span>
            <button onClick={() => setActionFeedback(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Quick Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-cyan-400" /> Current Latency
                  </span>
                  <p className="text-xl font-bold font-mono text-white mt-1">
                    {service.lastLatencyMs ? `${service.lastLatencyMs}ms` : '< 15ms'}
                  </p>
                  <span className="text-[10px] text-slate-500 font-mono">P95 SLA: 2000ms</span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" /> Health Checks
                  </span>
                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    {service.consecutiveFailures > 0 ? `${service.consecutiveFailures} Failed` : '100% Passing'}
                  </p>
                  <span className="text-[10px] text-slate-500 font-mono">Probe cadence: 2s</span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Active Incidents
                  </span>
                  <p className="text-xl font-bold font-mono text-amber-300 mt-1">
                    {serviceIncidents.filter(i => i.status !== 'RESOLVED').length}
                  </p>
                  <span className="text-[10px] text-slate-500 font-mono">Total historical: {serviceIncidents.length}</span>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-purple-400" /> Dependencies
                  </span>
                  <p className="text-xl font-bold font-mono text-purple-300 mt-1">
                    {dependencies.length} Connected
                  </p>
                  <span className="text-[10px] text-slate-500 font-mono">Topology integrated</span>
                </div>
              </div>

              {/* Interactive SRE Controls for this Service */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Flame className="w-4 h-4 text-rose-400" />
                    Targeted Chaos & SRE Controls
                  </h3>
                  <a
                    href={`http://localhost:${port}/health`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-400 font-mono flex items-center gap-1 hover:underline"
                  >
                    <span>Inspect Raw /health</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <button
                    disabled={actionLoading}
                    onClick={() => handleSimulate('DOWN')}
                    className="py-2.5 px-3 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Fail Service (503)
                  </button>

                  <button
                    disabled={actionLoading}
                    onClick={() => handleSimulate('HIGH_ERROR_RATE')}
                    className="py-2.5 px-3 rounded-lg bg-amber-950/70 hover:bg-amber-900 border border-amber-800 text-amber-300 font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <Flame className="w-3.5 h-3.5" /> 80% Error Rate
                  </button>

                  <button
                    disabled={actionLoading}
                    onClick={() => handleSimulate('HIGH_LATENCY')}
                    className="py-2.5 px-3 rounded-lg bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <Clock className="w-3.5 h-3.5" /> Inject 2500ms Latency
                  </button>

                  <button
                    disabled={actionLoading}
                    onClick={() => handleSimulate('RECOVER')}
                    className="py-2.5 px-3 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Recover to NORMAL
                  </button>
                </div>
              </div>

              {/* Service Health Specs */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <h3 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  Service Specifications & Configuration
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">SERVICE NAME</span>
                    <span className="text-slate-200 font-semibold">{service.name}</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">HTTP PORT</span>
                    <span className="text-cyan-400 font-semibold">{port}</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">MONITORING PROBE</span>
                    <span className="text-slate-200 font-semibold">GET /health</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">METRICS FORMAT</span>
                    <span className="text-slate-200 font-semibold">Prometheus (/metrics)</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">AUTO-RECOVERY CAPABILITY</span>
                    <span className="text-emerald-400 font-semibold">RESTART, CLEAR_CACHE</span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">INCIDENT POLICY</span>
                    <span className="text-purple-400 font-semibold">2 Consecutive Failures</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: METRICS & SRE */}
          {activeTab === 'metrics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-mono text-slate-400">Response Latency</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-bold font-mono text-cyan-300">
                      {service.lastLatencyMs || 8}ms
                    </span>
                    <span className="text-xs font-mono text-emerald-400">Normal</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        (service.lastLatencyMs || 8) > 2000 ? 'bg-rose-500' :
                        (service.lastLatencyMs || 8) > 500 ? 'bg-amber-500' : 'bg-cyan-400'
                      }`}
                      style={{ width: `${Math.min(100, ((service.lastLatencyMs || 8) / 2500) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-mono text-slate-400">Error Rate</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      {service.status === 'DOWN' ? '100%' : service.status === 'DEGRADED' ? '45%' : '0.1%'}
                    </span>
                    <span className="text-xs font-mono text-slate-400">SLA: &lt; 1%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${service.status === 'DOWN' ? 'bg-rose-500 w-full' : 'bg-emerald-400 w-1'}`}
                    />
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                  <span className="text-xs font-mono text-slate-400">Availability</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-bold font-mono text-purple-300">
                      {service.status === 'DOWN' ? '98.8%' : '99.99%'}
                    </span>
                    <span className="text-xs font-mono text-slate-400">30d target</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div className="h-full rounded-full bg-purple-400 w-[99%]" />
                  </div>
                </div>
              </div>

              {/* Raw Prometheus Telemetry Preview */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    Prometheus Metrics Probe
                  </span>
                  <a
                    href={`http://localhost:${port}/metrics`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <span>Raw Prometheus Endpoint</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs text-slate-300 space-y-1.5 border border-slate-800">
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-500">sentinelflow_service_up{`{service="${service.name}"}`}</span>
                    <span className={service.status === 'DOWN' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {service.status === 'DOWN' ? '0' : '1'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="text-slate-500">sentinelflow_http_request_duration_ms_bucket</span>
                    <span className="text-cyan-400 font-bold">{service.lastLatencyMs || 8}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">sentinelflow_consecutive_failures_count</span>
                    <span className="text-amber-400 font-bold">{service.consecutiveFailures || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              {/* Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search log messages, trace IDs, errors..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1 font-mono text-xs">
                  {['ALL', 'ERROR', 'WARN', 'INFO'].map(level => (
                    <button
                      key={level}
                      onClick={() => setLogFilter(level)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                        logFilter === level
                          ? 'bg-cyan-950 text-cyan-400 border border-cyan-700'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log List */}
              <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 h-96 overflow-y-auto font-mono text-xs space-y-1.5">
                {filteredLogs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 italic space-y-1">
                    <div>No logs available</div>
                    <div className="text-[11px] text-slate-600">No log events emitted or matched current filter.</div>
                  </div>
                ) : (
                  filteredLogs.map((l, idx) => {
                    const isErr = l.level === 'error';
                    const isWarn = l.level === 'warn';
                    return (
                      <div 
                        key={idx}
                        className={`p-2 rounded border transition-colors ${
                          isErr ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' :
                          isWarn ? 'bg-amber-950/30 border-amber-900/60 text-amber-300' :
                          'bg-slate-900/50 border-slate-800/80 text-slate-300'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                              isErr ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                              isWarn ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                              'bg-slate-800 text-cyan-400'
                            }`}>
                              {l.level || 'INFO'}
                            </span>
                            <span className="font-semibold">{l.message}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">
                            {l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'live'}
                          </span>
                        </div>
                        {l.context && Object.keys(l.context).length > 0 && (
                          <pre className="text-[10px] text-slate-400 mt-1 bg-slate-950/80 p-1.5 rounded overflow-x-auto border border-slate-800/60">
                            {JSON.stringify(l.context, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DEPENDENCIES */}
          {activeTab === 'dependencies' && (
            <div className="space-y-4">
              <p className="text-xs font-mono text-slate-400">
                Upstream and downstream topology relationships for <span className="text-white font-semibold">{service.name}</span>.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {dependencies.length === 0 ? (
                  <div className="col-span-2 text-center py-8 text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-lg">
                    No explicit dependency metadata defined for this service.
                  </div>
                ) : (
                  dependencies.map((dep, idx) => (
                    <div 
                      key={idx}
                      className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          dep.type === 'INFRASTRUCTURE' ? 'bg-purple-950/60 text-purple-400 border border-purple-800' : 'bg-cyan-950/60 text-cyan-400 border border-cyan-800'
                        }`}>
                          {dep.type === 'INFRASTRUCTURE' ? <Database className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold font-mono text-white capitalize">{dep.serviceId}</h4>
                          <span className="text-[10px] text-slate-400 font-mono">{dep.role || 'Service Dependency'}</span>
                        </div>
                      </div>

                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        dep.status === 'UP' || dep.status === 'HEALTHY'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                          : 'bg-rose-950 text-rose-400 border-rose-800'
                      }`}>
                        {dep.status || 'UP'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: INCIDENTS */}
          {activeTab === 'incidents' && (
            <div className="space-y-3">
              {serviceIncidents.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-lg">
                  No active or past incidents recorded for {service.name}.
                </div>
              ) : (
                serviceIncidents.map(inc => (
                  <div 
                    key={inc.id}
                    onClick={() => {
                      onClose();
                      if (onSelectIncident) onSelectIncident(inc);
                    }}
                    className="bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3.5 transition-all cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-rose-950 text-rose-400 flex items-center justify-center border border-rose-800">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono text-cyan-400">{inc.id}</span>
                          <span className="text-xs font-mono text-slate-300 font-semibold">{inc.type}</span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                            inc.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                          }`}>
                            {inc.severity}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Detected {new Date(inc.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        inc.status === 'RESOLVED' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-rose-950 text-rose-400 border-rose-800'
                      }`}>
                        {inc.status}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 6: AI INSIGHTS */}
          {activeTab === 'ai-insights' && (
            <div className="space-y-4">
              <div className="bg-indigo-950/40 border border-indigo-700/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold font-mono text-indigo-200 uppercase tracking-wider">
                    Historical Root Cause Patterns & Recovery Knowledge
                  </h3>
                </div>
                <p className="text-xs font-mono text-slate-300">
                  SentinelAI retains indexed vector embeddings and historical resolution patterns for this service to accelerate automated recovery.
                </p>
              </div>

              <div className="space-y-2">
                {historicalCases.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-lg space-y-1">
                    <div className="text-slate-400">No recurring patterns identified yet</div>
                    <div className="text-[11px] text-slate-600">Historical resolution patterns will populate as incidents are investigated and resolved.</div>
                  </div>
                ) : (
                  historicalCases.map((hist, idx) => (
                    <div 
                      key={idx}
                      className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-400 font-bold">{hist.id}</span>
                          <span className="text-slate-300 font-medium">{hist.type}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                            {hist.severity}
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                          Recovered via {hist.recoveryAction || 'RESTART'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px]">
                        <span className="text-slate-500">Root cause: </span>
                        {hist.rootCause || hist.reason || 'Service process crash / failure'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <span className="text-xs font-mono text-slate-500">
            SentinelAI Microservice Health Engine · {service.name}
          </span>
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
