import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Header from './components/Header';
import ServiceGrid from './components/ServiceGrid';
import ServiceDependencyGraph from './components/ServiceDependencyGraph';
import ServiceDetailModal from './components/ServiceDetailModal';
import IncidentTable from './components/IncidentTable';
import IncidentDetailModal from './components/IncidentDetailModal';
import EventStream from './components/EventStream';
import DemoControls from './components/DemoControls';
import SreMetricsSummary from './components/SreMetricsSummary';
import AiInsightsPanel from './components/AiInsightsPanel';
import { fetchServices, fetchIncidents, fetchEvents, acknowledgeIncident, fetchSreMetrics, fetchInfraStatus } from './services/api';
import { getProjectById, BANKING_PROJECT_DATA } from './data/projects';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3009';
const POLL_INTERVAL = 5000;
const FAST_POLL_INTERVAL = 1000;
const FAST_POLL_DURATION = 15000;
const SRE_POLL_INTERVAL = 10000;   // refresh SRE metrics every 10s
const INFRA_POLL_INTERVAL = 15000; // refresh infra status every 15s

// Project data providers: live projects use backend APIs; demo projects use static mock data
const PROJECT_MOCK_DATA = {
  // 'banking-001' is now backed by live microservices on ports 3021-3025
};

export default function App() {
  const [services, setServices] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [selectedProject, setSelectedProject] = useState('ecommerce-001');
  const [selectedEnv, setSelectedEnv] = useState('Production');
  const [sreMetrics, setSreMetrics] = useState({});
  const [infraStatus, setInfraStatus] = useState({});
  const [showTopologyGraph, setShowTopologyGraph] = useState(false);
  const [loading, setLoading] = useState(false);

  // True when the active project is backed by live backend APIs
  const isLiveProject = !PROJECT_MOCK_DATA[selectedProject];

  const pollIntervalRef = useRef(null);
  const fastPollTimerRef = useRef(null);
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const selectedIncidentRef = useRef(selectedIncident);
  selectedIncidentRef.current = selectedIncident;
  const selectedServiceRef = useRef(selectedService);
  selectedServiceRef.current = selectedService;

  // Project-scoped data refresh
  const refreshAllData = useCallback(async (projId) => {
    const targetProject = projId || selectedProjectRef.current;
    
    // Non-live / demo projects: load from local mock registry, do NOT call backend
    if (PROJECT_MOCK_DATA[targetProject]) {
      const mockData = PROJECT_MOCK_DATA[targetProject];
      if (selectedProjectRef.current === targetProject) {
        setServices(mockData.services || []);
        setIncidents(mockData.incidents || []);
        setEvents(mockData.events || []);
      }
      return;
    }

    // Live projects: fetch project-scoped data from gateway
    try {
      const [svcData, incData, evtData] = await Promise.all([
        fetchServices(targetProject),
        fetchIncidents(targetProject),
        fetchEvents(targetProject)
      ]);

      // Guard against race condition: only update state if user is still on this project
      if (selectedProjectRef.current === targetProject) {
        setServices(svcData || []);
        if (selectedServiceRef.current) {
          const updated = (svcData || []).find(s => s.name === selectedServiceRef.current.name);
          if (updated) setSelectedService(updated);
        }
        setIncidents(incData || []);
        setEvents(evtData || []);
      }
    } catch (err) {
      console.error(`[Project ${targetProject}] refreshAllData error:`, err);
    }
  }, []);

  const refreshSreMetrics = useCallback(async (projId) => {
    const targetProject = projId || selectedProjectRef.current;
    if (PROJECT_MOCK_DATA[targetProject]) {
      if (selectedProjectRef.current === targetProject) {
        setSreMetrics(PROJECT_MOCK_DATA[targetProject].sreMetrics || {});
      }
      return;
    }
    try {
      const data = await fetchSreMetrics(targetProject);
      if (selectedProjectRef.current === targetProject) {
        setSreMetrics(data || {});
      }
    } catch (err) {
      console.error(`[Project ${targetProject}] refreshSreMetrics error:`, err);
    }
  }, []);

  const refreshInfraStatus = useCallback(async (projId) => {
    const targetProject = projId || selectedProjectRef.current;
    if (PROJECT_MOCK_DATA[targetProject]) {
      if (selectedProjectRef.current === targetProject) {
        setInfraStatus(PROJECT_MOCK_DATA[targetProject].infraStatus || {});
      }
      return;
    }
    try {
      const data = await fetchInfraStatus();
      if (selectedProjectRef.current === targetProject) {
        setInfraStatus(data || {});
      }
    } catch (err) {
      console.error(`[Project ${targetProject}] refreshInfraStatus error:`, err);
    }
  }, []);

  const triggerFastPoll = useCallback(() => {
    if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(() => {
      refreshAllData();
    }, FAST_POLL_INTERVAL);

    fastPollTimerRef.current = setTimeout(() => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => {
        refreshAllData();
      }, POLL_INTERVAL);
    }, FAST_POLL_DURATION);
  }, [refreshAllData]);

  // Project-aware Socket.IO and Polling Effect: Re-runs whenever selectedProject changes
  useEffect(() => {
    const currentProj = selectedProject;

    // 1. Initial Load for this project
    refreshAllData(currentProj);
    refreshSreMetrics(currentProj);
    refreshInfraStatus(currentProj);

    // 2. Setup project-aware polling intervals
    pollIntervalRef.current = setInterval(() => {
      refreshAllData(currentProj);
    }, POLL_INTERVAL);

    const sreTimer = setInterval(() => {
      refreshSreMetrics(currentProj);
    }, SRE_POLL_INTERVAL);

    const infraTimer = setInterval(() => {
      refreshInfraStatus(currentProj);
    }, INFRA_POLL_INTERVAL);

    // 3. Socket.IO connection with strict project-scoping and race-condition filtering
    const socket = io(SOCKET_URL, {
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      timeout: 5000
    });

    socket.on('connect', () => {
      setIsConnected(true);
      refreshAllData(currentProj);
    });

    socket.on('disconnect', () => setIsConnected(false));

    // Helper: checks if an incoming payload belongs to the currently active project
    // Legacy events without projectId default to 'ecommerce-001' for backward compatibility
    const isEventForCurrentProject = (payload) => {
      const eventProjId = payload?.projectId || payload?.data?.projectId || 'ecommerce-001';
      return eventProjId === currentProj;
    };

    socket.on('service:update', (data) => {
      if (!isEventForCurrentProject(data)) return;

      setServices(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(s => s.name === data.service || s.serviceId === data.serviceId);
        if (idx !== -1) {
          copy[idx] = {
            ...copy[idx],
            status: data.eventType === 'SERVICE_RECOVERED' ? 'HEALTHY' :
                    data.eventType === 'SERVICE_DEGRADED' ? 'DEGRADED' : 'DOWN',
            lastLatencyMs: data.latencyMs || copy[idx].lastLatencyMs,
            consecutiveFailures: data.consecutiveFailures ?? copy[idx].consecutiveFailures
          };
          if (selectedServiceRef.current?.name === data.service) {
            setSelectedService(copy[idx]);
          }
        }
        return copy;
      });
    });

    socket.on('incident:created', (newInc) => {
      if (!isEventForCurrentProject(newInc)) return;

      setIncidents(prev => [newInc, ...prev.filter(i => i.id !== newInc.id)]);
      setTimeout(() => refreshAllData(currentProj), 400);
      setTimeout(() => refreshSreMetrics(currentProj), 800);
    });

    socket.on('incident:updated', (updatedInc) => {
      if (!updatedInc || !isEventForCurrentProject(updatedInc)) return;

      setIncidents(prev => prev.map(i => i.id === updatedInc.id ? updatedInc : i));
      if (selectedIncidentRef.current?.id === updatedInc.id) {
        setSelectedIncident(updatedInc);
      }
    });

    socket.on('event:stream', (newEvent) => {
      if (!isEventForCurrentProject(newEvent?.data || newEvent)) return;
      setEvents(prev => [newEvent, ...prev.slice(0, 99)]);
    });

    socket.on('recovery:attempt', (recoveryPayload) => {
      if (!isEventForCurrentProject(recoveryPayload)) return;
      setTimeout(() => refreshAllData(currentProj), 300);
      setTimeout(() => refreshSreMetrics(currentProj), 1000);
    });

    return () => {
      socket.disconnect();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
      clearInterval(sreTimer);
      clearInterval(infraTimer);
    };
  }, [selectedProject, refreshAllData, refreshSreMetrics, refreshInfraStatus]);

  const handleAcknowledge = async (incidentId) => {
    const updated = await acknowledgeIncident(incidentId);
    if (updated) {
      setIncidents(prev => prev.map(i => i.id === incidentId ? updated : i));
      if (selectedIncident?.id === incidentId) setSelectedIncident(updated);
      setTimeout(() => refreshSreMetrics(selectedProject), 500);
    }
  };

  // Immediate Project Context Switch
  const handleSelectProject = useCallback((projectId) => {
    if (projectId === selectedProject) return;

    // Step 1: Immediate reset of transient and selected states
    setSelectedProject(projectId);
    setSelectedIncident(null);
    setSelectedService(null);
    setShowTopologyGraph(false);
    setLoading(true);

    // Step 2: Reset environment to project's default
    const projectMeta = getProjectById(projectId);
    setSelectedEnv(projectMeta?.defaultEnvironment || 'Production');

    // Step 3: Clear stale data immediately to prevent data leakage during transition
    const mockData = PROJECT_MOCK_DATA[projectId];
    if (mockData) {
      // Demo / scoped project: immediate assignment from project data
      setServices(mockData.services || []);
      setIncidents(mockData.incidents || []);
      setEvents(mockData.events || []);
      setSreMetrics(mockData.sreMetrics || {});
      setInfraStatus(mockData.infraStatus || {});
      setLoading(false);
    } else {
      // Reset state to empty before fetching live project
      setServices([]);
      setIncidents([]);
      setEvents([]);
      setSreMetrics({});
      setInfraStatus({});

      // Fetch new project's data immediately without waiting for polling cycle
      Promise.all([
        refreshAllData(projectId),
        refreshSreMetrics(projectId),
        refreshInfraStatus(projectId)
      ]).finally(() => {
        setLoading(false);
      });
    }
  }, [selectedProject, refreshAllData, refreshSreMetrics, refreshInfraStatus]);

  const handleActionTriggered = useCallback(() => {
    triggerFastPoll();
    setTimeout(() => refreshAllData(selectedProject), 300);
    setTimeout(() => refreshAllData(selectedProject), 1500);
    setTimeout(() => refreshAllData(selectedProject), 3500);
    setTimeout(() => refreshSreMetrics(selectedProject), 5000);
  }, [triggerFastPoll, refreshAllData, refreshSreMetrics, selectedProject]);

  return (
    <div className="min-h-screen pb-12">
      {/* Global Header & Navigation */}
      <Header
        services={services}
        incidents={incidents}
        isConnected={isConnected}
        onOpenGraph={() => setShowTopologyGraph(true)}
        selectedProject={selectedProject}
        onSelectProject={handleSelectProject}
        selectedEnv={selectedEnv}
        onSelectEnv={setSelectedEnv}
      />

      <main className="max-w-7xl mx-auto px-6 space-y-6">
        {/* Demo Project Banner — shown for non-live projects */}
        {!isLiveProject && (
          <div className="flex items-center justify-between gap-3 bg-amber-950/30 border border-amber-800/60 rounded-xl px-4 py-2.5 font-mono text-xs">
            <div className="flex items-center gap-2 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-semibold">DEMO MODE</span>
              <span className="text-amber-400/70">—</span>
              <span className="text-amber-200/80">
                {getProjectById(selectedProject).name} is a scoped demo project. Data shown is representative, not live.
              </span>
            </div>
            <button
              onClick={() => handleSelectProject('ecommerce-001')}
              className="px-3 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300 text-[11px] font-semibold transition-all"
            >
              Switch to Live Project →
            </button>
          </div>
        )}

        {/* SRE Metrics Summary + Infrastructure Connectivity */}
        <SreMetricsSummary 
          sreMetrics={sreMetrics} 
          infraStatus={infraStatus}
          services={services}
          incidents={incidents}
        />

        {/* Dedicated SentinelAI Insights & Pattern Identification Panel */}
        <AiInsightsPanel 
          incidents={incidents} 
          services={services} 
        />

        {/* Interactive Chaos & SRE Control Bar */}
        <DemoControls 
          onActionTriggered={handleActionTriggered} 
          disabled={!isLiveProject}
          projectId={selectedProject}
        />

        {/* Monitored Microservices Grid with Sparklines */}
        <ServiceGrid 
          services={services} 
          onSelectService={setSelectedService}
          incidents={incidents}
          loading={loading}
        />

        {/* Searchable & Filterable Incidents Dashboard */}
        <IncidentTable
          incidents={incidents}
          onSelectIncident={setSelectedIncident}
          onAcknowledge={handleAcknowledge}
          loading={loading}
        />

        {/* Live Kafka Event Bus Stream */}
        <EventStream events={events} loading={loading} />
      </main>

      {/* Service Dependency & Topology Graph Modal */}
      {showTopologyGraph && (
        <ServiceDependencyGraph
          services={services}
          infraStatus={infraStatus}
          incidents={incidents}
          events={events}
          onClose={() => setShowTopologyGraph(false)}
          onSelectService={setSelectedService}
        />
      )}

      {/* Dedicated Service Detail Observability Modal */}
      {selectedService && (
        <ServiceDetailModal
          service={selectedService}
          projectId={selectedProject}
          incidents={incidents}
          onClose={() => setSelectedService(null)}
          onSelectIncident={(inc) => {
            setSelectedService(null);
            setSelectedIncident(inc);
          }}
          onActionTriggered={handleActionTriggered}
        />
      )}

      {/* SentinelAI Incident Detail & RCA Modal */}
      {selectedIncident && (
        <IncidentDetailModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onAcknowledge={handleAcknowledge}
        />
      )}
    </div>
  );
}
