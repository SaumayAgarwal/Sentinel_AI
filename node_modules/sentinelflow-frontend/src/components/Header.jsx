import React, { useState, useRef, useEffect } from 'react';
import { ShieldAlert, Activity, CheckCircle2, AlertTriangle, XCircle, Radio, Network, Globe, FolderGit2, ChevronDown, Check } from 'lucide-react';
import { PROJECTS, getProjectById } from '../data/projects';

export default function Header({ 
  services = [], 
  incidents = [], 
  isConnected, 
  onOpenGraph, 
  selectedProject = 'ecommerce-001',
  onSelectProject,
  selectedEnv = 'Production',
  onSelectEnv
}) {
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const projectDropdownRef = useRef(null);

  const currentProject = getProjectById(selectedProject);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target)) {
        setIsProjectOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const healthy = services.filter(s => s.status === 'HEALTHY').length;
  const down = services.filter(s => s.status === 'DOWN').length;
  const degraded = services.filter(s => s.status === 'DEGRADED').length;
  const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED').length;

  const isSystemHealthy = down === 0 && degraded === 0 && activeIncidents === 0;

  return (
    <header className="glass-panel sticky top-0 z-40 border-b border-slate-800 px-6 py-3.5 mb-6 bg-slate-950/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        
        {/* Left: Brand & Context Selectors */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white font-mono">SentinelAI</h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-mono font-semibold">
                  AIOps v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Autonomous SRE & Incident Resolution</p>
            </div>
          </div>

          <div className="h-6 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Project & Environment Context Selectors */}
          <div className="flex items-center gap-2 text-xs font-mono">
            {/* Project Selector Dropdown */}
            <div className="relative" ref={projectDropdownRef}>
              <button
                type="button"
                onClick={() => setIsProjectOpen(prev => !prev)}
                className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-lg px-3 py-1.5 transition-all text-slate-200 font-semibold cursor-pointer select-none"
                aria-expanded={isProjectOpen}
                aria-haspopup="true"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>{currentProject.name} ({currentProject.id})</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isProjectOpen ? 'rotate-180 text-cyan-400' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {isProjectOpen && (
                <div className="absolute left-0 mt-1.5 w-72 rounded-xl bg-slate-950 border border-slate-800 shadow-2xl z-50 overflow-hidden backdrop-blur-xl">
                  {/* Header */}
                  <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/60">
                    <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                      PROJECTS
                    </span>
                  </div>

                  {/* Project Items */}
                  <div className="p-1.5 space-y-1">
                    {PROJECTS.map((proj) => {
                      const isSelected = proj.id === selectedProject;
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => {
                            if (onSelectProject) onSelectProject(proj.id);
                            setIsProjectOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-all flex items-start justify-between group ${
                            isSelected
                              ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/80 shadow-sm'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="w-4 mt-0.5 flex-shrink-0">
                              {isSelected ? (
                                <Check className="w-4 h-4 text-cyan-400" />
                              ) : (
                                <span className="w-4 h-4 inline-block" />
                              )}
                            </span>
                            <div>
                              <div className={`font-semibold ${isSelected ? 'text-cyan-200' : 'text-slate-200 group-hover:text-white'}`}>
                                {proj.name}
                              </div>
                              <div className="text-[11px] text-slate-500 font-normal">
                                {proj.id}
                              </div>
                            </div>
                          </div>

                          {proj.isMonitoredLive ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 font-semibold mt-0.5">
                              LIVE
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-semibold mt-0.5">
                              DEMO
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Environment Selector */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 hover:border-purple-500/40 transition-colors">
              <Globe className="w-3.5 h-3.5 text-purple-400" />
              <select 
                value={selectedEnv}
                onChange={(e) => onSelectEnv && onSelectEnv(e.target.value)}
                className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer"
              >
                {(currentProject.environments || ['Production', 'Staging']).map(env => (
                  <option key={env} value={env} className="bg-slate-900 text-slate-200">
                    {env}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right: Operational Status, Topology Trigger & Connection */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          
          {/* Global System Status Pill */}
          <div className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 font-bold ${
            isSystemHealthy
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800 text-rose-300 animate-pulse'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isSystemHealthy ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span>{isSystemHealthy ? 'ALL SYSTEMS HEALTHY' : `${activeIncidents} ACTIVE INCIDENT${activeIncidents > 1 ? 'S' : ''}`}</span>
          </div>

          {/* Topology Graph Trigger */}
          <button
            onClick={onOpenGraph}
            className="px-3 py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300 font-semibold flex items-center gap-1.5 transition-all shadow-sm hover:border-cyan-500"
          >
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span>Topology Graph</span>
          </button>

          {/* Socket.IO Connection Badge */}
          <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-lg">
            <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
            <span className={isConnected ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
              {isConnected ? 'LIVE' : 'RECONNECTING'}
            </span>
          </div>

          {/* Quick Counters */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="bg-emerald-950/40 px-2.5 py-1.5 rounded-lg border border-emerald-900/50 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-300 text-[11px] font-bold">{healthy} UP</span>
            </div>

            {down > 0 && (
              <div className="bg-rose-950/50 px-2.5 py-1.5 rounded-lg border border-rose-900/60 flex items-center gap-1.5 animate-pulse">
                <XCircle className="w-3 h-3 text-rose-400" />
                <span className="text-rose-300 text-[11px] font-bold">{down} DOWN</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </header>
  );
}
