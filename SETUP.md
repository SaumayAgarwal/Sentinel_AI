# SentinelFlow Infrastructure Setup

## Prerequisites
- Docker Desktop (or Docker Engine) installed and running.
- Node.js (>=18) and npm installed.
- `git` (optional, for cloning the repo).

## Steps
```bash
# 1️⃣ Start the required infrastructure (PostgreSQL, Redis, Kafka) in Docker
docker compose up -d

# 2️⃣ Apply the Prisma schema to PostgreSQL (creates tables)
npm run db:push

# 3️⃣ Verify connectivity to all infra components
npm run health

# 4️⃣ Start all Node.js/React services (locally, not containerized)
npm run dev
```

The `npm run health` script runs `node scripts/health-check.js` which checks the connectivity of:
- PostgreSQL (`localhost:5432`)
- Redis (`localhost:6379`)
- Kafka (`localhost:9092`)

You should see output similar to:
```
PostgreSQL: CONNECTED
Redis: CONNECTED
Kafka: CONNECTED
```
If any service reports `OFFLINE`, the script logs a clear error indicating which dependency could not be reached.

## Verifying the End‑to‑End Flow
1. Simulate a failure of the **Payment Service** using the PowerShell script:
   ```powershell
   .\scripts\failure_flow.ps1
   ```
2. Observe the following pipeline in the logs / dashboard:
   - Payment Service failure → Monitoring Service → Kafka → Incident Service → Redis + PostgreSQL → Socket.IO → React Dashboard.
3. Run the recovery step included in the script to bring the service back to `NORMAL`.

All micro‑services connect to the infrastructure using the variables defined in the `.env` file, never hard‑coded.
