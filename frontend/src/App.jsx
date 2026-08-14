import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Header from './components/Header';
import ServiceGrid from './components/ServiceGrid';
import ServiceDependencyGraph from './components/ServiceDependencyGraph';
import IncidentTable from './components/IncidentTable';
import IncidentDetailModal from './components/IncidentDetailModal';
import EventStream from './components/EventStream';
import DemoControls from './components/DemoControls';
import SreMetricsSummary from './components/SreMetricsSummary';
import { fetchServices, fetchIncidents, fetchEvents, acknowledgeIncident, fetchSreMetrics, fetchInfraStatus } from './services/api';

const SOCKET_URL = 'http://localhost:3009';
const POLL_INTERVAL = 5000;
const FAST_POLL_INTERVAL = 1000;
const FAST_POLL_DURATION = 15000;
const SRE_POLL_INTERVAL = 10000;   // refresh SRE metrics every 10s
const INFRA_POLL_INTERVAL = 15000; // refresh infra status every 15s

export default function App() {
  const [services, setServices] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [sreMetrics, setSreMetrics] = useState({});
  const [infraStatus, setInfraStatus] = useState({});
  const [showTopologyGraph, setShowTopologyGraph] = useState(false);

  const pollIntervalRef = useRef(null);
  const fastPollTimerRef = useRef(null);
  const selectedIncidentRef = useRef(selectedIncident);
  selectedIncidentRef.current = selectedIncident;

  const refreshAllData = useCallback(async () => {
    const [svcData, incData, evtData] = await Promise.all([
      fetchServices(),
      fetchIncidents(),
      fetchEvents()
    ]);
    if (svcData.length > 0) setServices(svcData);
    setIncidents(incData);
    setEvents(evtData);
  }, []);

  const refreshSreMetrics = useCallback(async () => {
    const data = await fetchSreMetrics();
    setSreMetrics(data);
  }, []);

  const refreshInfraStatus = useCallback(async () => {
    const data = await fetchInfraStatus();
    setInfraStatus(data);
  }, []);

  const triggerFastPoll = useCallback(() => {
    if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(refreshAllData, FAST_POLL_INTERVAL);

    fastPollTimerRef.current = setTimeout(() => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(refreshAllData, POLL_INTERVAL);
    }, FAST_POLL_DURATION);
  }, [refreshAllData]);

  useEffect(() => {
    // Initial data load
    refreshAllData();
    refreshSreMetrics();
    refreshInfraStatus();

    // Polling intervals
    pollIntervalRef.current = setInterval(refreshAllData, POLL_INTERVAL);
    const sreTimer = setInterval(refreshSreMetrics, SRE_POLL_INTERVAL);
    const infraTimer = setInterval(refreshInfraStatus, INFRA_POLL_INTERVAL);

    // Socket.IO
    const socket = io(SOCKET_URL, {
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      timeout: 5000
    });

    socket.on('connect', () => {
      setIsConnected(true);
      refreshAllData();
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('service:update', (data) => {
      setServices(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(s => s.name === data.service);
        if (idx !== -1) {
          copy[idx] = {
            ...copy[idx],
            status: data.eventType === 'SERVICE_RECOVERED' ? 'HEALTHY' :
                    data.eventType === 'SERVICE_DEGRADED' ? 'DEGRADED' : 'DOWN',
            lastLatencyMs: data.latencyMs || copy[idx].lastLatencyMs,
            consecutiveFailures: data.consecutiveFailures ?? copy[idx].consecutiveFailures
          };
        }
        return copy;
      });
    });

    socket.on('incident:created', (newInc) => {
      setIncidents(prev => [newInc, ...prev.filter(i => i.id !== newInc.id)]);
      setTimeout(refreshAllData, 500);
    });

    socket.on('incident:updated', (updatedInc) => {
      if (!updatedInc) return;
      setIncidents(prev => prev.map(i => i.id === updatedInc.id ? updatedInc : i));
      if (selectedIncidentRef.current?.id === updatedInc.id) {
        setSelectedIncident(updatedInc);
      }
    });

    socket.on('event:stream', (newEvent) => {
      setEvents(prev => [newEvent, ...prev.slice(0, 99)]);
    });

    socket.on('recovery:attempt', () => {
      setTimeout(refreshAllData, 300);
      setTimeout(refreshSreMetrics, 1000);
    });

    return () => {
      socket.disconnect();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (fastPollTimerRef.current) clearTimeout(fastPollTimerRef.current);
      clearInterval(sreTimer);
      clearInterval(infraTimer);
    };
  }, [refreshAllData, refreshSreMetrics, refreshInfraStatus]);

  const handleAcknowledge = async (incidentId) => {
    const updated = await acknowledgeIncident(incidentId);
    if (updated) {
      setIncidents(prev => prev.map(i => i.id === incidentId ? updated : i));
      if (selectedIncident?.id === incidentId) setSelectedIncident(updated);
      setTimeout(refreshSreMetrics, 500);
    }
  };

  const handleActionTriggered = useCallback(() => {
    triggerFastPoll();
    setTimeout(refreshAllData, 300);
    setTimeout(refreshAllData, 1500);
    setTimeout(refreshAllData, 3500);
    setTimeout(refreshSreMetrics, 5000);
  }, [triggerFastPoll, refreshAllData, refreshSreMetrics]);

  return (
    <div className="min-h-screen pb-12">
      <Header
        services={services}
        incidents={incidents}
        isConnected={isConnected}
        onOpenGraph={() => setShowTopologyGraph(true)}
      />

      <main className="max-w-7xl mx-auto px-6 space-y-8">
        {/* SRE Metrics Summary + Infra Status Badges */}
        <SreMetricsSummary sreMetrics={sreMetrics} infraStatus={infraStatus} />

        {/* Interactive Demo Control Bar */}
        <DemoControls onActionTriggered={handleActionTriggered} />

        {/* Monitored Microservices Grid */}
        <ServiceGrid services={services} />

        {/* Incidents Dashboard */}
        <IncidentTable
          incidents={incidents}
          onSelectIncident={setSelectedIncident}
          onAcknowledge={handleAcknowledge}
        />

        {/* Live Kafka Event Stream */}
        <EventStream events={events} />
      </main>

      {/* Service Dependency & Topology Graph Modal */}
      {showTopologyGraph && (
        <ServiceDependencyGraph
          services={services}
          infraStatus={infraStatus}
          incidents={incidents}
          events={events}
          onClose={() => setShowTopologyGraph(false)}
        />
      )}

      {/* Incident Detail Modal */}
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
