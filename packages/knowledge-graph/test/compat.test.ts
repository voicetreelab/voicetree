import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@huggingface/transformers';

describe('sqlite-vec + onnxruntime compatibility', () => {
  it('can load sqlite-vec and insert vectors after loading transformers', async () => {
    // Load the embedding model first (this loads onnxruntime)
    const extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' }
    );

    // Generate an embedding
    const output = await extractor('test sentence', {
      pooling: 'mean',
      normalize: true,
    });
    const embedding = output.tolist()[0] as number[];

    // Now create a sqlite-vec database and insert the vector
    const db = new Database(':memory:');
    sqliteVec.load(db);

    db.exec('CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[384])');

    const insert = db.prepare('INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)');
    const float32 = new Float32Array(embedding);
    // sqlite-vec requires BigInt for rowid with better-sqlite3 (plain numbers are passed as REAL)
    insert.run(BigInt(1), Buffer.from(float32.buffer));

    // Query it back
    const results = db.prepare(
      'SELECT rowid, distance FROM test_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1'
    ).all(Buffer.from(float32.buffer));

    expect(results).toHaveLength(1);
    expect((results[0] as any).rowid).toBe(1);
    expect((results[0] as any).distance).toBeCloseTo(0, 4);

    db.close();
    await extractor.dispose();
  }, 120000);
});
