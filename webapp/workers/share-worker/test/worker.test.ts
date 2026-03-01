import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

function createUploadForm(files: Record<string, string>, folderName = 'test-vault'): FormData {
  const form = new FormData();
  form.append('folderName', folderName);
  for (const [name, content] of Object.entries(files)) {
    form.append('files', new File([content], name, { type: 'text/markdown' }));
  }
  return form;
}

describe('share-worker E2E', () => {
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

  // 1. Valid upload
  it('returns 201 with 21-char shareId on valid upload', async () => {
    const form = createUploadForm({
      'note1.md': '# Hello\nWorld',
      'note2.md': '# Second\nNote',
    });

    const res = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { shareId: string };
    expect(body.shareId).toBeDefined();
    expect(body.shareId).toHaveLength(21);
  });

  // 2. Retrieve manifest
  it('serves manifest with correct cache headers after upload', async () => {
    const form = createUploadForm({
      'doc.md': '# Doc',
    }, 'my-vault');

    const uploadRes = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    const { shareId } = await uploadRes.json() as { shareId: string };

    const res = await worker.fetch(`http://worker/share/${shareId}/manifest.json`);
    expect(res.status).toBe(200);

    const manifest = await res.json() as { files: string[]; folderName: string; createdAt: string };
    expect(manifest.files).toContain('doc.md');
    expect(manifest.folderName).toBe('my-vault');
    expect(manifest.createdAt).toBeDefined();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  // 3. Retrieve file
  it('serves uploaded file content with 24h cache', async () => {
    const content = '# My Note\n\nSome content here.';
    const form = createUploadForm({ 'readme.md': content });

    const uploadRes = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    const { shareId } = await uploadRes.json() as { shareId: string };

    const res = await worker.fetch(`http://worker/share/${shareId}/readme.md`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(content);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  // 4. File count reject
  it('rejects upload with more than 1000 files', async () => {
    const form = new FormData();
    form.append('folderName', 'big-vault');
    for (let i = 0; i < 1001; i++) {
      form.append('files', new File([`# File ${i}`], `file${i}.md`, { type: 'text/markdown' }));
    }

    const res = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  // 5. Oversized reject
  it('rejects upload exceeding 20MB total', async () => {
    const bigContent = 'x'.repeat(11_000_000);
    const form = createUploadForm({
      'big1.md': bigContent,
      'big2.md': bigContent,
    });

    const res = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  // 6. Path traversal reject
  it('rejects file paths containing ".."', async () => {
    const form = createUploadForm({ '../etc/passwd.md': '# Evil' });

    const res = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });

  // 7. Backslash reject
  it('rejects file paths containing backslashes', async () => {
    // FormData strips backslashes (multipart escape char), so construct raw multipart body
    const boundary = '----TestBoundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="folderName"',
      '',
      'test-vault',
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="sub\\\\dir\\\\file.md"',
      'Content-Type: text/markdown',
      '',
      '# Windows path',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await worker.fetch('http://worker/upload', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(res.status).toBe(400);
  });

  // 8. 404 for non-existent share
  it('returns 404 for non-existent share', async () => {
    const res = await worker.fetch('http://worker/share/nonexistent123456789/manifest.json');
    expect(res.status).toBe(404);
  });

  // 9. CORS preflight
  it('handles OPTIONS preflight with CORS headers', async () => {
    const res = await worker.fetch('http://worker/upload', {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const methods = res.headers.get('Access-Control-Allow-Methods') ?? '';
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
  });

  // 10. Positions retrieval
  it('serves .voicetree/positions.json after upload', async () => {
    const positions = JSON.stringify({ 'node1.md': { x: 100, y: 200 } });
    const form = new FormData();
    form.append('folderName', 'pos-vault');
    form.append('files', new File(['# Node 1'], 'node1.md', { type: 'text/markdown' }));
    form.append('files', new File([positions], '.voicetree/positions.json', { type: 'application/json' }));

    const uploadRes = await worker.fetch('http://worker/upload', {
      method: 'POST',
      body: form,
    });
    const { shareId } = await uploadRes.json() as { shareId: string };

    const res = await worker.fetch(`http://worker/share/${shareId}/.voicetree/positions.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ 'node1.md': { x: 100, y: 200 } });
  });
});
