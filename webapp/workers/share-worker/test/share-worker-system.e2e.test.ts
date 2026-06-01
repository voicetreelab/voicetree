import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function uploadForm(): FormData {
  const form = new FormData();
  form.append('folderName', 'product-project');
  form.append('files', new File(['# Root\n\n[[Nested Child]]'], 'Root.md', { type: 'text/markdown' }));
  form.append('files', new File(['# Nested Child'], 'folder/Nested Child.md', { type: 'text/markdown' }));
  form.append(
    'files',
    new File([JSON.stringify({ 'Root.md': { x: 10, y: 20 } })], '.voicetree/positions.json', {
      type: 'application/json',
    }),
  );
  return form;
}

describe('share-worker system boundary', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false,
    });
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
  });

  it('uploads a project and serves its manifest, markdown, positions, and CORS/cache contract', async () => {
    const upload = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: uploadForm(),
    });

    expect(upload.status).toBe(201);
    expect(upload.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const { shareId } = await upload.json() as { shareId: string };
    expect(shareId).toMatch(/^[A-Za-z0-9_-]{21}$/);

    const manifestResponse = await worker.fetch(`http://worker/share/${shareId}/manifest.json`);
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const manifest = await manifestResponse.json() as { folderName: string; files: string[] };
    expect(manifest.folderName).toBe('product-project');
    expect(manifest.files.sort()).toEqual(['.voicetree/positions.json', 'Root.md', 'folder/Nested Child.md'].sort());

    const markdown = await worker.fetch(`http://worker/share/${shareId}/Root.md`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('Content-Type')).toContain('text/markdown');
    expect(markdown.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(await markdown.text()).toContain('[[Nested Child]]');

    const positions = await worker.fetch(`http://worker/share/${shareId}/.voicetree/positions.json`);
    expect(positions.status).toBe(200);
    expect(await positions.json()).toEqual({ 'Root.md': { x: 10, y: 20 } });
  });
});
