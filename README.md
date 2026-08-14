# SentinelFlow — Distributed Incident Management & Automated Recovery Platform

SentinelFlow is an event-driven SRE & DevOps Incident Management platform built with Node.js microservices, Apache Kafka (KRaft mode), Redis, PostgreSQL, Prisma, Socket.IO, and React.

---

## 🏛️ Event Flow Architecture

```text
Payment Service failure (Port 3003)
        │
        ▼
Monitoring Service (Port 3005)
        │
        ▼ (Publishes to Kafka topic: service-events)
      Kafka (Port 9092 - KRaft Mode)
        │
        ▼
Incident Service (Port 3006)
        │
        ├── Redis (Port 6379 - Active deduplication key: incident:active:{service})
        └── PostgreSQL (Port 5432 - History DB via Prisma)
        │
        ▼ (Publishes to Kafka topic: incident-events)
WebSocket Gateway (Port 3009)
        │
        ▼ (Socket.IO Real-time Stream)
React Dashboard (Port 5173)
```

---

## 🚀 Quick Setup & Run Guide

### 1. Start Infrastructure Dependencies (Docker Only)
Launch PostgreSQL, Redis, and Kafka in KRaft mode using Docker:

```bash
docker compose up -d
```

### 2. Push Database Schema
Apply the Prisma database schema to PostgreSQL:

```bash
npm run db:push
```

### 3. Start SentinelFlow Services
Start all 9 microservices and the React frontend concurrently:

```bash
npm run dev
```

*(Note: `npm run dev:all` is also available as an alias).*

### 4. Check Health & Connectivity
To verify infrastructure (PostgreSQL, Redis, Kafka) and microservices status:

```bash
npm run health
```

---

## ⚙️ Environment Configuration (`.env`)

All credentials and ports are managed centrally in `.env`:

```env
# Infrastructure Connections
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sentinelflow?schema=public"
KAFKA_BROKER="127.0.0.1:9092"
KAFKA_CLIENT_ID="sentinelflow"
REDIS_URL="redis://127.0.0.1:6379"

# Microservice Ports
PORT_USER=3001
PORT_ORDER=3002
PORT_PAYMENT=3003
PORT_INVENTORY=3004
PORT_MONITORING=3005
PORT_INCIDENT=3006
PORT_RECOVERY=3007
PORT_NOTIFICATION=3008
PORT_GATEWAY=3009
```

---

## 🛠️ Port Allocation Table

| Service | Port | Endpoint | Description |
|:---|:---|:---|:---|
| **User Service** | 3001 | `http://localhost:3001/health` | Business Microservice |
| **Order Service** | 3002 | `http://localhost:3002/health` | Business Microservice |
| **Payment Service** | 3003 | `http://localhost:3003/health` | Main Demo Target Microservice |
| **Inventory Service** | 3004 | `http://localhost:3004/health` | Business Microservice |
| **Monitoring Service**| 3005 | `http://localhost:3005/api/monitors` | Polling & Failure Detection |
| **Incident Service** | 3006 | `http://localhost:3006/incidents` | Kafka Consumer, Redis & PostgreSQL DB |
| **Recovery Service** | 3007 | `http://localhost:3007/health` | Automated Backoff Recovery |
| **Notification Service** | 3008 | `http://localhost:3008/notifications` | Alert Manager & Redis Buffer |
| **WebSocket Gateway**| 3009 | `http://localhost:3009/api/events` | Kafka-to-Socket.IO Bridge |
| **React Dashboard** | 5173 | `http://localhost:5173` | Real-time SRE UI |

---

## 🎯 Failure Simulation Workflow

1. Open **`http://localhost:5173`** in your browser.
2. In the **Interactive Demo Controls**, click **Simulate Service Failure** on **Payment Service**.
3. **Execution Cascade:**
   - Payment Service returns `503 Service Unavailable`.
   - Monitoring Service detects consecutive health check failures and publishes `SERVICE_DOWN` event to Kafka.
   - Incident Service consumes the Kafka event, checks Redis for deduplication, writes incident record to PostgreSQL, and publishes `INCIDENT_CREATED` to Kafka.
   - Recovery Service consumes the Kafka event and initiates automated exponential backoff recovery attempts.
   - WebSocket Gateway receives the Kafka events and pushes them via Socket.IO to the React Dashboard.
4. Open **`http://localhost:5173`** in your browser.
5. In the **Interactive Demo Controls**, click **Simulate Service Failure** on **Payment Service**.
6. **Execution Cascade:**
   - Payment Service returns `503 Service Unavailable`.
   - Monitoring Service detects consecutive health check failures and publishes `SERVICE_DOWN` event to Kafka.
   - Incident Service consumes the Kafka event, checks Redis for deduplication, writes incident record to PostgreSQL, and publishes `INCIDENT_CREATED` to Kafka.
   - Recovery Service consumes the Kafka event and initiates automated exponential backoff recovery attempts.
   - WebSocket Gateway receives the Kafka events and pushes them via Socket.IO to the React Dashboard.
   - React Dashboard updates in real time showing Payment Service **DOWN** and active incident timeline.

---

## 📊 Prometheus & Grafana Monitoring

SentinelFlow exposes a `/metrics` endpoint on **every microservice** (via `prom-client`). Prometheus scrapes these, and Grafana renders live dashboards.

### Start Monitoring Stack

```bash
npm run monitoring:up
```

Or together with all infrastructure:

```bash
docker compose up -d
```

### Access Points

| Tool | URL | Credentials |
|:---|:---|:---|
| **Grafana Dashboard** | `http://localhost:3000` | `admin` / `sentinelflow` |
| **Prometheus UI** | `http://localhost:9090` | — |

### Dashboard Panels

The **SentinelFlow — Microservice Metrics** dashboard (auto-loaded) includes:

| Panel | Metric |
|:---|:---|
| Service Health Status | `service_up{service="..."}` — UP / DOWN badge for all 9 services |
| Business Services — Request Rate | `rate(http_requests_total[1m])` |
| Platform Services — Request Rate | `rate(http_requests_total[1m])` |
| All Services — Error Rate | `rate(http_errors_total[1m])` |
| Business Services — P95 Latency | `histogram_quantile(0.95, ...)` |
| Platform Services — P95 Latency | `histogram_quantile(0.95, ...)` |
| Payment Service — Error Rate % | Gauge with failure threshold markers |
| Payment Service — P95 Latency | Gauge with latency threshold markers |
| Payment Service — Health | Background colour stat (red = DOWN) |

> Dashboard auto-refreshes every **10 seconds** and shows the last **30 minutes** by default.

### Port Allocation (Monitoring)

| Service | Port |
|:---|:---|
| Prometheus | 9090 |
| Grafana | 3000 |
| Node.js `/metrics` endpoints | 3001–3009 |
