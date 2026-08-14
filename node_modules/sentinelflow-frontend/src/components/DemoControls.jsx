import React, { useState } from 'react';
import { Play, AlertTriangle, ShieldCheck, Flame, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { simulateFailure, triggerRecovery } from '../services/api';

export default function DemoControls({ onActionTriggered }) {
  const [selectedService, setSelectedService] = useState('payment-service');
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState(null);

  const servicePorts = {
    'user-service': 3001,
    'order-service': 3002,
    'payment-service': 3003,
    'inventory-service': 3004
  };
  const currentPort = servicePorts[selectedService] || 3003;
  const currentUrl = `http://localhost:${currentPort}/health`;

  const handleSimulate = async (mode) => {
    setLoading(true);
    try {
      if (mode === 'RECOVER') {
        const res = await triggerRecovery(selectedService);
        setLastAction({ type: 'SUCCESS', message: `Recovery sent to ${selectedService}` });
      } else {
        const res = await simulateFailure(selectedService, mode);
        setLastAction({ type: 'WARNING', message: `Simulated ${mode} on ${selectedService}` });
      }
      if (onActionTriggered) onActionTriggered();
    } catch (err) {
      setLastAction({ type: 'ERROR', message: `Failed to trigger action: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel rounded-xl p-5 mb-8 border border-cyan-500/30">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">Interactive Demo Controls</h2>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Triggers actual backend failure modes across the microservice cluster
          </p>
        </div>

        {/* Target Service Selector & Direct Visit Button */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-mono text-slate-300">Target Service:</label>
          <select 
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-cyan-400 font-mono text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
          >
            <option value="payment-service">Payment Service (Primary Demo)</option>
            <option value="user-service">User Service</option>
            <option value="order-service">Order Service</option>
            <option value="inventory-service">Inventory Service</option>
          </select>

          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 font-mono text-xs flex items-center gap-1.5 transition-all shadow-sm"
            title="Open health endpoint in browser"
          >
            <span>Visit /health</span>
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
          </a>
        </div>
      </div>

      {/* Control Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          disabled={loading}
          onClick={() => handleSimulate('DOWN')}
          className="px-4 py-3 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-rose-950/50 disabled:opacity-50"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          Simulate Service Failure
        </button>

        <button
          disabled={loading}
          onClick={() => handleSimulate('HIGH_ERROR_RATE')}
          className="px-4 py-3 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-800 text-amber-300 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-amber-950/50 disabled:opacity-50"
        >
          <Flame className="w-4 h-4 text-amber-400" />
          Simulate High Error Rate
        </button>

        <button
          disabled={loading}
          onClick={() => handleSimulate('HIGH_LATENCY')}
          className="px-4 py-3 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-cyan-950/50 disabled:opacity-50"
        >
          <Clock className="w-4 h-4 text-cyan-400" />
          Simulate High Latency
        </button>

        <button
          disabled={loading}
          onClick={() => handleSimulate('RECOVER')}
          className="px-4 py-3 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-emerald-950/50 disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4 text-emerald-400" />
          Trigger Recovery
        </button>
      </div>

      {/* Action Toast Feedback */}
      {lastAction && (
        <div className={`mt-4 p-3 rounded-lg text-xs font-mono flex items-center justify-between ${
          lastAction.type === 'WARNING' ? 'bg-amber-950/60 border border-amber-800 text-amber-300' :
          lastAction.type === 'SUCCESS' ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300' :
          'bg-rose-950/60 border border-rose-800 text-rose-300'
        }`}>
          <span>{lastAction.message}</span>
          <button onClick={() => setLastAction(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}
    </div>
  );
}
