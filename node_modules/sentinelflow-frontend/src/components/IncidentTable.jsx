import React, { useState } from 'react';
import { 
  AlertOctagon, CheckCircle2, Clock, ChevronRight, Eye, Search, 
  Filter, Sparkles, RefreshCw, ShieldAlert, ArrowUpDown 
} from 'lucide-react';

export default function IncidentTable({ incidents = [], onSelectIncident, onAcknowledge, loading = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedService, setSelectedService] = useState('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  const uniqueServices = Array.from(new Set(incidents.map(i => i.serviceName || i.serviceId).filter(Boolean)));

  // Filter incidents
  const filteredIncidents = incidents.filter(inc => {
    const sName = inc.serviceName || inc.serviceId || '';
    const matchesSearch = !searchTerm || 
      inc.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inc.type && inc.type.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesService = selectedService === 'ALL' || sName === selectedService;
    const matchesSeverity = selectedSeverity === 'ALL' || inc.severity === selectedSeverity;
    const matchesStatus = selectedStatus === 'ALL' || inc.status === selectedStatus;

    return matchesSearch && matchesService && matchesSeverity && matchesStatus;
  }).sort((a, b) => {
    // Priority order: OPEN (1) -> RECOVERING (2) -> RESOLVED (3)
    const statusPriority = { OPEN: 1, RECOVERING: 2, RESOLVED: 3 };
    const pA = statusPriority[a.status] || 4;
    const pB = statusPriority[b.status] || 4;
    if (pA !== pB) return pA - pB;
    // Secondary: Newest first
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  return (
    <div className="glass-panel rounded-xl p-5 mb-8">
      {/* Table Header & Quick Counters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <AlertOctagon className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-base font-bold text-white tracking-tight font-mono">
              Active & Recent Incidents
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Autonomous telemetry event correlation and lifecycle tracking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400">Total Incidents:</span>
          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-white font-bold">
            {incidents.length}
          </span>
          <span className="text-slate-400 ml-2">Filtered:</span>
          <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
            {filteredIncidents.length}
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-xs font-mono">
        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search incident ID, service..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Service Filter */}
        <select
          value={selectedService}
          onChange={(e) => setSelectedService(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="ALL">All Services</option>
          {uniqueServices.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Severity Filter */}
        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="ALL">All Severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
        </select>

        {/* Status Filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="ALL">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="RECOVERING">Recovering</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
          Loading project incidents...
        </div>
      ) : filteredIncidents.length === 0 ? (
        <div className="text-center py-12 text-slate-400 font-mono text-xs border border-dashed border-slate-800 rounded-xl bg-slate-950/40 space-y-1">
          <div className="text-emerald-400 font-semibold text-sm">
            {incidents.length === 0 ? '✓ NO INCIDENTS' : '✓ No matching incidents'}
          </div>
          <p className="text-slate-500 text-xs">
            {incidents.length === 0 
              ? 'No active or historical incidents recorded for this project.' 
              : 'No incidents match the active search and filter criteria.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Incident ID</th>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">AI RCA</th>
                <th className="py-3 px-4">Recovery</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
              {filteredIncidents.map((inc) => {
                const isResolved = inc.status === 'RESOLVED';
                const isCritical = inc.severity === 'CRITICAL';
                
                // Duration
                let duration = '—';
                if (inc.createdAt) {
                  const s = new Date(inc.createdAt).getTime();
                  if (inc.resolvedAt) {
                    duration = `${((new Date(inc.resolvedAt).getTime() - s) / 1000).toFixed(1)}s`;
                  } else {
                    duration = `${Math.round((Date.now() - s) / 1000)}s`;
                  }
                }

                return (
                  <tr 
                    key={inc.id}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    onClick={() => onSelectIncident(inc)}
                  >
                    <td className="py-3 px-4 font-bold text-cyan-400 group-hover:underline">
                      {inc.id.substring(0, 14)}
                    </td>
                    <td className="py-3 px-4 text-slate-200 capitalize font-semibold">
                      {inc.serviceName || inc.serviceId}
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
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center w-max gap-1 border ${
                        isResolved ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                        inc.status === 'RECOVERING' ? 'bg-cyan-950 text-cyan-400 border-cyan-800 animate-pulse' :
                        'bg-rose-950 text-rose-400 border-rose-800 animate-pulse'
                      }`}>
                        {isResolved ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {inc.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {duration}
                    </td>
                    {/* AI RCA column */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center w-max gap-1">
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        Diagnosed
                      </span>
                    </td>
                    {/* Recovery column */}
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center w-max gap-1 ${
                        isResolved ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                        'bg-cyan-950 text-cyan-400 border border-cyan-800 animate-pulse'
                      }`}>
                        <RefreshCw className="w-2.5 h-2.5" />
                        {isResolved ? 'Auto-Recovered' : 'Recovering'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {new Date(inc.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectIncident(inc);
                        }}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 hover:text-cyan-400 text-slate-300 transition-colors"
                        title="View Incident RCA Details"
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
