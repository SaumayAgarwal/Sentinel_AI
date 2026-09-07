const axios = require('axios');
const { createLogger } = require('@sentinelflow/shared');

const logger = createLogger('sentinel-ai-embeddings');
const DEFAULT_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = parseInt(process.env.AI_EMBEDDING_DIMENSIONS, 10) || 1536;

/**
 * Deterministic pseudo-embedding generator (for offline / test environments)
 * Generates an L2-normalized 1536-dimensional vector based on token hashing.
 * Semantically similar texts with overlapping tokens produce higher cosine similarity.
 */
function generateDeterministicEmbedding(text, dimensions = DEFAULT_DIMENSIONS) {
  const vector = new Float64Array(dimensions);
  const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    tokens.push('empty_token');
  }

  // Distribute token weights into pseudo-dimensions
  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const token = tokens[tIdx];
    let h1 = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      h1 ^= token.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    const idx1 = h1 % dimensions;
    const idx2 = (h1 * 31 + 7) % dimensions;
    const idx3 = (h1 * 17 + 13) % dimensions;
    
    vector[idx1] += 1.0;
    vector[idx2] += 0.5;
    vector[idx3] += 0.25;
  }

  // Compute L2 norm for unit normalization
  let sumSquares = 0;
  for (let i = 0; i < dimensions; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares) || 1.0;

  const result = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    result[i] = parseFloat((vector[i] / norm).toFixed(6));
  }
  return result;
}

class OpenAIEmbeddingProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = options.model || DEFAULT_MODEL;
    this.dimensions = options.dimensions || DEFAULT_DIMENSIONS;
    this.timeout = options.timeout || 5000;
  }

  async embed(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Embedding input text must be a non-empty string');
    }

    // If in test mode, no API key, or explicitly configured for local/deterministic embeddings, use offline fallback
    const useLocal = process.env.NODE_ENV === 'test'
      || !this.apiKey
      || this.apiKey.trim() === ''
      || (process.env.AI_EMBEDDING_PROVIDER || 'openai').toLowerCase() === 'local';
    if (useLocal) {
      return generateDeterministicEmbedding(text, this.dimensions);
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: text,
          model: this.model,
          dimensions: this.dimensions
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );

      const embedding = response.data?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error('Malformed embedding response from OpenAI API');
      }
      return embedding;
    } catch (err) {
      logger.warn(`OpenAI embedding API call failed: ${err.message}. Falling back to deterministic embedding.`);
      return generateDeterministicEmbedding(text, this.dimensions);
    }
  }

  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

module.exports = {
  OpenAIEmbeddingProvider,
  generateDeterministicEmbedding
};
