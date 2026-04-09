import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Embedder } from '../src/lib/embedder.js';

describe('Embedder', () => {
  let embedder: Embedder;

  beforeAll(async () => {
    embedder = new Embedder();
    await embedder.init();
  }, 120000);

  afterAll(async () => {
    await embedder.dispose();
  });

  it('generates a 384-dimensional embedding', async () => {
    const embedding = await embedder.embed('Hello world');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384);
  });

  it('generates similar embeddings for similar text', async () => {
    const a = await embedder.embed('knowledge graph traversal');
    const b = await embedder.embed('graph traversal in knowledge bases');
    const c = await embedder.embed('chocolate cake recipe');
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('builds embedding text from title, tags, and first paragraph', () => {
    const text = Embedder.buildEmbeddingText(
      'Widget Theory',
      ['concept', 'framework'],
      'A theoretical framework for understanding component interactions.\n\nMore details here.',
    );
    expect(text).toContain('Widget Theory');
    expect(text).toContain('concept');
    expect(text).toContain('theoretical framework');
    expect(text).not.toContain('More details here');
  });
});

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
