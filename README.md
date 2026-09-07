# SentinelAI — Autonomous AIOps & Incident Intelligence Platform

> **SentinelAI** is the AI-powered product layer built on top of **SentinelFlow**, an event-driven distributed platform for real-time microservice monitoring, automated incident management, and autonomous recovery. Built with Node.js microservices, Apache Kafka (KRaft mode), Redis, PostgreSQL, Prisma, Socket.IO, and React.

---

## ? Key Capabilities

| Capability | Description |
|:---|:---|
| **Multi-Project Monitoring** | Monitor multiple isolated projects simultaneously (E-Commerce & Banking Platform) |
| **Real-Time Incident Detection** | Kafka-driven pipeline detects failures in seconds and raises incidents automatically |
| **SentinelAI — RCA Agent** | LLM-powered root-cause analysis using live health, dependency graph, and real service logs |
| **RAG V1 — Deterministic Retrieval** | Scores historical incidents by service, failure mode, and severity for grounded AI diagnosis |
| **RAG V2 — Semantic Search** | pgvector cosine similarity retrieval over embedded canonical incident documents |
| **Autonomous Recovery** | Exponential backoff recovery with AI-gated approval before execution |
| **Dead Letter Queue (DLQ)** | Failed Kafka events are captured, inspectable, and manually replayable |
| **Project-Scoped Log Analysis** | Real structured logs tagged per project and service, fed directly into AI RCA context |
| **Prometheus + Grafana** | Every microservice exposes `/metrics`; pre-built Grafana dashboard auto-loads |
| **Failure Simulation** | Inject `DOWN`, `HIGH_LATENCY`, or `HIGH_ERROR_RATE` on any service via the UI |

---

## ??? Architecture Overview

```
+---------------------------------------------------------+
¦                   React Dashboard (5173)                 ¦
¦         Multi-Project UI · Real-Time Socket.IO           ¦
+---------------------------------------------------------+
                       ¦ Socket.IO / REST
+----------------------?----------------------------------+
¦         SentinelFlow — WebSocket Gateway (3009)          ¦
¦   Project-Scoped REST API · Kafka-to-Socket.IO Bridge    ¦
¦   Log Proxy (banking) · Admin Failure/Recovery Router    ¦
+---------------------------------------------------------+
   ¦          ¦          ¦          ¦          ¦
   ?          ?          ?          ?          ?
Kafka      Monitor    Incident   Recovery  SentinelAI
(9092)     (3005)     (3006)     (3007)    (3011)
   ¦          ¦          ¦          ¦          ¦
   ¦     PostgreSQL    Redis     PostgreSQL  Groq LLM
   ¦       (5433)     (6379)      (5433)   + pgvector
   ¦
   +-- E-Commerce Services (3001–3004)
   ¦   user · order · payment · inventory
   ¦
   +-- Banking Platform Services (3021–3025)
       auth · account · transaction · fraud-detection · notification
```

---

## ??? Project Structure

```
sentinelflow-platform/           ? SentinelFlow: the underlying platform
+-- services/
¦   +-- shared/                  # Shared logger, logStore, registry, Kafka, metrics
¦   +-- user-service/            # E-Commerce: User management (Port 3001)
¦   +-- order-service/           # E-Commerce: Order processing (Port 3002)
¦   +-- payment-service/         # E-Commerce: Payment gateway (Port 3003)
¦   +-- inventory-service/       # E-Commerce: Inventory management (Port 3004)
¦   +-- banking-services/        # Banking Platform: 5 services (Ports 3021–3025)
¦   +-- monitoring-service/      # Health poller for all projects (Port 3005)
¦   +-- incident-service/        # Kafka consumer, Redis dedup, PostgreSQL (Port 3006)
¦   +-- recovery-service/        # Exponential backoff recovery engine (Port 3007)
¦   +-- notification-service/    # Alert dispatch & Redis buffer (Port 3008)
¦   +-- websocket-gateway/       # Central API gateway & Socket.IO bridge (Port 3009)
¦   +-- sentinel-ai/             # SentinelAI: AI RCA agent · RAG V1 · RAG V2 (Port 3011)
+-- frontend/                    # React SPA — SentinelAI Dashboard (Vite, Port 5173)
+-- scripts/                     # Health checks, test suites, embedding backfill
+-- grafana/                     # Pre-built Grafana dashboard provisioning
+-- prometheus/                  # Prometheus scrape config
+-- docker-compose.yml
+-- package.json                 # Workspace root with concurrently runner
```

---

## ?? Quick Start

### 1. Start Infrastructure (Docker)

```bash
docker compose up -d
```

Starts: PostgreSQL (5433), Redis (6379), Kafka (9092 — KRaft mode), Prometheus (9090), Grafana (3000).

### 2. Push Database Schema

```bash
npm run db:push
```

### 3. Start All Services

```bash
npm run dev
```

Starts all 12 processes concurrently: 4 e-commerce services, 5 banking services, 4 platform services (SentinelFlow), SentinelAI agent, and the React frontend.

### 4. Open the SentinelAI Dashboard

```
http://localhost:5173
```

### 5. Verify Health

```bash
npm run health
```

---

## ?? Environment Configuration (`.env`)

```env
# Infrastructure
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sentinelflow?schema=public"
KAFKA_BROKER="127.0.0.1:9092"
KAFKA_CLIENT_ID="sentinelflow"
REDIS_URL="redis://127.0.0.1:6379"

# AI Provider (Groq)
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# E-Commerce Service Ports
PORT_USER=3001
PORT_ORDER=3002
PORT_PAYMENT=3003
PORT_INVENTORY=3004

# Platform Service Ports
PORT_MONITORING=3005
PORT_INCIDENT=3006
PORT_RECOVERY=3007
PORT_NOTIFICATION=3008
PORT_GATEWAY=3009
PORT_SENTINEL_AI=3011

# Banking Platform Ports
PORT_BANKING_AUTH=3021
PORT_BANKING_ACCOUNT=3022
PORT_BANKING_TRANSACTION=3023
PORT_BANKING_FRAUD=3024
PORT_BANKING_NOTIFICATION=3025
```

---

## ??? Port Allocation

### E-Commerce Project (`ecommerce-001`)

| Service | Port | Description |
|:---|:---|:---|
| User Service | 3001 | Customer & session management |
| Order Service | 3002 | Order lifecycle |
| Payment Service | 3003 | Payment gateway (primary demo target) |
| Inventory Service | 3004 | Stock & warehouse management |

### Banking Platform (`banking-001`)

| Service | Port | Description |
|:---|:---|:---|
| Auth Service | 3021 | JWT issuance & session verification |
| Account Service | 3022 | Balance ledger & account debiting |
| Transaction Service | 3023 | Settlement orchestration |
| Fraud Detection Service | 3024 | AI risk scoring & anomaly detection |
| Notification Service | 3025 | SMS/email alert dispatch |

### SentinelFlow — Platform Services

| Service | Port | Description |
|:---|:---|:---|
| Monitoring Service | 3005 | Health poller for all projects (2s interval) |
| Incident Service | 3006 | Kafka consumer · Redis dedup · PostgreSQL |
| Recovery Service | 3007 | Exponential backoff recovery engine |
| Notification Service | 3008 | Alert manager & Redis buffer |
| WebSocket Gateway | 3009 | REST API · Kafka?Socket.IO bridge |
| **SentinelAI** | 3011 | AI RCA agent · RAG · Recovery gating |
| SentinelAI Dashboard | 5173 | Real-time AIOps UI |

### Monitoring Stack

| Tool | Port | Credentials |
|:---|:---|:---|
| Prometheus | 9090 | — |
| Grafana | 3000 | `admin` / `sentinelflow` |

---

## ?? SentinelAI — AI RCA Engine

SentinelAI is an autonomous investigation agent that activates the moment an incident is created by SentinelFlow.

### Investigation Pipeline

```
Incident Created (by SentinelFlow)
      ¦
      ?
 Tool: getServiceHealth        ? Live HTTP health status
 Tool: getServiceDependencies  ? Dependency graph from registry
 Tool: getServiceLogs          ? Last 50 real structured logs (per project)
      ¦
      ?
 RAG V2: Semantic Search       ? pgvector cosine similarity over embedded incidents
      ¦ (fallback if 0 results)
 RAG V1: Deterministic Search  ? Score historical incidents by service + failure mode
      ¦
      ?
 LLM (Groq / llama-3.3-70b)   ? Root-cause analysis with grounded historical evidence
      ¦
      ?
 Confidence >= threshold?
      +-- Yes ? Propose recovery action ? AI-gated approval ? SentinelFlow Recovery
      +-- No  ? Flag for human review
```

### Guardrails
- Maximum **4 bounded LLM calls** per investigation
- Hallucination protection: only cited incident IDs from retrieved evidence appear in output
- Deterministic fallback when LLM is unavailable or rate-limited

---

## ??? Project-Scoped Log Analysis

Every service emits structured logs via Winston tagged with `projectId` and `service`. Logs are stored in a per-process in-memory circular buffer (2000 entries max).

| Project | Log Transport |
|:---|:---|
| `ecommerce-001` | Shared in-process `logStore` — gateway reads directly |
| `banking-001` | Each service exposes `GET /internal/logs` — gateway proxies to the correct service port |

**Example log emitted during a failure injection:**
```json
{
  "level": "error",
  "message": "[transaction-service] FAILURE INJECTED — mode=DOWN",
  "cause": "Simulated process crash or out-of-memory condition",
  "impact": "Downstream services depending on transaction-service will receive HTTP 503",
  "recommendation": "SentinelAI recovery agent should issue POST /admin/recovery",
  "projectId": "banking-001",
  "service": "transaction-service"
}
```

SentinelAI's `getServiceLogs` tool fetches these logs and injects them into the LLM RCA prompt as real diagnostic evidence.

---

## ?? Failure Simulation Workflow

1. Open the **SentinelAI Dashboard** at `http://localhost:5173` and select a project.
2. In **Interactive Demo Controls**, pick a service and a failure mode:
   - **DOWN** — service returns `503`, all health checks fail
   - **HIGH_ERROR_RATE** — 80% of requests return `500`
   - **HIGH_LATENCY** — 2500ms artificial delay on all responses
3. Click **Simulate Failure**. The SentinelFlow cascade begins:
   - Monitoring Service detects consecutive failures ? publishes `SERVICE_DOWN` to Kafka
   - Incident Service consumes event ? deduplicates via Redis ? writes to PostgreSQL ? publishes `INCIDENT_CREATED`
   - **SentinelAI Agent triggers** ? fetches health + logs + dependencies ? LLM produces RCA with RAG grounding
   - Recovery Service initiates exponential backoff recovery attempts
   - WebSocket Gateway pushes all events to the SentinelAI Dashboard via Socket.IO in real time
4. Click **Trigger Recovery** (or let autonomous recovery complete) to restore the service to `NORMAL`.

---

## ?? Prometheus & Grafana

Every SentinelFlow microservice exposes `GET /metrics` (via `prom-client`). The Grafana dashboard auto-provisions on startup.

```bash
# Start monitoring stack only
npm run monitoring:up

# View logs
npm run monitoring:logs
```

### Dashboard Panels

| Panel | Metric |
|:---|:---|
| Service Health Status | `service_up{service="..."}` — UP/DOWN for all services |
| Request Rate | `rate(http_requests_total[1m])` |
| Error Rate | `rate(http_errors_total[1m])` |
| P95 Latency | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` |
| Payment Service Health | Stat panel (green = UP, red = DOWN) |

> Dashboard auto-refreshes every **10 seconds**, showing the last **30 minutes** by default.

---

## ?? Test Suites

```bash
# Banking Platform — registry, topology, isolation, live HTTP probing
node scripts/test-banking-demo.js       # 19/19 tests

# SentinelAI — agent, RAG V1, RAG V2 semantic, bounds, hallucination protection
node scripts/test-sentinel-ai.js        # 63/63 tests

# Foundation — registry, Kafka envelopes, log store
node scripts/verify-pre-ai.js          # 12/12 tests

# Infrastructure connectivity
npm run infra:check
```

---

## ?? RAG V2 Embedding Backfill

After incidents accumulate in the database, generate pgvector embeddings for SentinelAI semantic search:

```bash
npm run ai:backfill-embeddings
```

---

## ?? Docker Commands

```bash
npm run infra:up        # Start all infrastructure (docker compose up -d)
npm run infra:down      # Stop all infrastructure
npm run monitoring:up   # Start Prometheus + Grafana only
```
