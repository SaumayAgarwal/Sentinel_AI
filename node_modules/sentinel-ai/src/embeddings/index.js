const { OpenAIEmbeddingProvider, generateDeterministicEmbedding } = require('./providers/openai');
const { createLogger } = require('@sentinelflow/shared');

const logger = createLogger('sentinel-ai-embeddings');

/**
 * Calculates cosine similarity between two numeric vectors.
 * Returns a value between -1.0 and 1.0 (typically 0.0 to 1.0 for normalized text embeddings).
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

class EmbeddingService {
  constructor(options = {}) {
    this.providerType = options.provider || process.env.AI_EMBEDDING_PROVIDER || 'openai';
    this.enabled = process.env.AI_EMBEDDINGS_ENABLED !== 'false';
    this.cache = new Map();
    this.maxCacheSize = 100;

    if (this.providerType === 'openai') {
      this.provider = new OpenAIEmbeddingProvider(options);
    } else {
      // Default to OpenAI provider (which falls back deterministically if no key)
      this.provider = new OpenAIEmbeddingProvider(options);
    }
  }

  async embed(text) {
    if (!this.enabled) {
      return generateDeterministicEmbedding(text);
    }

    const cacheKey = typeof text === 'string' ? text.trim() : '';
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const vector = await this.provider.embed(text);
      if (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, vector);
      return vector;
    } catch (err) {
      logger.warn(`Embedding failed: ${err.message}. Using fallback.`);
      return generateDeterministicEmbedding(text);
    }
  }

  async embedBatch(texts) {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

// Export singleton instance as well as class & helpers
const defaultEmbeddingService = new EmbeddingService();

module.exports = {
  EmbeddingService,
  defaultEmbeddingService,
  cosineSimilarity,
  generateDeterministicEmbedding
};
