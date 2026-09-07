require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { buildCanonicalDocument } = require('../services/sentinel-ai/src/retrieval/canonicalDocument');
const { defaultEmbeddingService } = require('../services/sentinel-ai/src/embeddings');
const tools = require('../services/sentinel-ai/src/tools');

async function backfillEmbeddings() {
  console.log('====================================================');
  console.log('  SentinelAI: Backfill Incident Embeddings (RAG V2)');
  console.log('====================================================\n');

  const startTime = Date.now();
  let prisma = null;
  let usePrisma = false;

  try {
    prisma = new PrismaClient({ log: [] });
    await prisma.$queryRaw`SELECT 1`;
    usePrisma = true;
    console.log('[PostgreSQL] Connected to database directly via Prisma.');
  } catch (err) {
    console.log(`[PostgreSQL] Direct connection not available (${err.message}). Falling back to HTTP tools.`);
  }

  let incidents = [];
  const projectId = 'ecommerce-001';

  if (usePrisma) {
    try {
      incidents = await prisma.incident.findMany({
        where: { status: 'RESOLVED' },
        include: { recoveryActions: true }
      });
    } catch (dbErr) {
      console.warn(`[Prisma] Query failed: ${dbErr.message}`);
    }
  }

  // Fallback to HTTP historical incidents endpoint if DB query returned nothing or failed
  if (incidents.length === 0) {
    console.log(`[HTTP] Fetching historical incidents via incident-service for project ${projectId}...`);
    try {
      incidents = await tools.getHistoricalIncidents(projectId, { limit: 50 });
    } catch (httpErr) {
      console.warn(`[HTTP] Could not fetch historical incidents: ${httpErr.message}`);
    }
  }

  console.log(`[Backfill] Found ${incidents.length} historical incident(s) to process.\n`);

  if (incidents.length === 0) {
    console.log('No historical incidents found. Backfill completed (0 indexed).');
    if (prisma) await prisma.$disconnect();
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < incidents.length; i++) {
    const inc = incidents[i];
    const incidentId = inc.incidentId || inc.id;
    const sId = inc.serviceId || 'unknown';

    try {
      // 1. Build canonical document
      const doc = buildCanonicalDocument(inc);

      // 2. Generate 1536-dimensional embedding
      const vector = await defaultEmbeddingService.embed(doc);

      // 3. Upsert into database
      if (usePrisma) {
        const vectorStr = `[${vector.join(',')}]`;
        const sql = `
          INSERT INTO "IncidentEmbedding" ("id", "incidentId", "projectId", "serviceId", "content", "embeddingModel", "embedding", "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
          ON CONFLICT ("incidentId") DO UPDATE
          SET "content" = EXCLUDED."content",
              "embedding" = EXCLUDED."embedding",
              "embeddingModel" = EXCLUDED."embeddingModel",
              "updatedAt" = NOW();
        `;
        await prisma.$queryRawUnsafe(sql, incidentId, projectId, sId, doc, 'text-embedding-3-small', vectorStr);
      } else {
        await tools.saveIncidentEmbedding(projectId, incidentId, {
          content: doc,
          embedding: vector,
          embeddingModel: 'text-embedding-3-small',
          serviceId: sId
        });
      }

      successCount++;
      console.log(`[${i + 1}/${incidents.length}] ✅ Indexed ${incidentId} (${sId})`);
    } catch (err) {
      failCount++;
      console.error(`[${i + 1}/${incidents.length}] ❌ Failed to index ${incidentId}: ${err.message}`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log('\n====================================================');
  console.log(`Backfill Summary:`);
  console.log(`- Total Candidates: ${incidents.length}`);
  console.log(`- Successfully Indexed: ${successCount}`);
  console.log(`- Failed: ${failCount}`);
  console.log(`- Duration: ${durationMs}ms`);
  console.log('====================================================\n');

  if (prisma) {
    await prisma.$disconnect();
  }
}

backfillEmbeddings().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
