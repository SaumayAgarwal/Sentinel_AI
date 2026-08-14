import React from 'react';
import ServiceCard from './ServiceCard';

export default function ServiceGrid({ services }) {
  const defaultServices = [
    { name: 'user-service', status: 'HEALTHY', lastLatencyMs: 12, url: 'http://localhost:3001/health' },
    { name: 'order-service', status: 'HEALTHY', lastLatencyMs: 18, url: 'http://localhost:3002/health' },
    { name: 'payment-service', status: 'HEALTHY', lastLatencyMs: 25, url: 'http://localhost:3003/health' },
    { name: 'inventory-service', status: 'HEALTHY', lastLatencyMs: 15, url: 'http://localhost:3004/health' }
  ];

  const displayServices = services && services.length > 0 ? services : defaultServices;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
          Monitored Microservices
        </h2>
        <span className="text-xs font-mono text-slate-400">Auto-polled every 5 seconds</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {displayServices.map(s => (
          <ServiceCard key={s.name} service={s} />
        ))}
      </div>
    </section>
  );
}
