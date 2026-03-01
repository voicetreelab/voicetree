import { nanoid } from "nanoid";

// Minimal R2 types — full types provided by @cloudflare/workers-types at build time
interface R2ObjectBody {
  readonly body: ReadableStream;
}
interface R2Bucket {
  put(key: string, value: ArrayBuffer | string | ReadableStream): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Env {
  SHARES_BUCKET: R2Bucket;
}

const MAX_FILE_COUNT = 1000;
const MAX_TOTAL_SIZE = 20_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const folderName = (formData.get("folderName") as string) || "Untitled";

  const files: { name: string; data: ArrayBuffer }[] = [];
  let totalSize = 0;

  const entries = Array.from(formData.entries());
  for (const [key, value] of entries) {
    if (key === "folderName") continue;
    if (typeof value === "string") continue;
    const file = value as unknown as File;
    const name = file.name || key;

    if (name.includes("..")) {
      return jsonResponse({ error: `Invalid path: ${name}` }, 400);
    }
    if (name.includes("\\")) {
      return jsonResponse({ error: `Invalid path: ${name}` }, 400);
    }

    const data = await file.arrayBuffer();
    totalSize += data.byteLength;
    files.push({ name, data });
  }

  if (files.length > MAX_FILE_COUNT) {
    return jsonResponse({ error: `Too many files: ${files.length} (max ${MAX_FILE_COUNT})` }, 400);
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return jsonResponse({ error: `Total size ${totalSize} exceeds limit of ${MAX_TOTAL_SIZE} bytes` }, 400);
  }

  const shareId = nanoid(21);

  const fileNames: string[] = [];
  for (const file of files) {
    await env.SHARES_BUCKET.put(`shares/${shareId}/${file.name}`, file.data);
    fileNames.push(file.name);
  }

  const manifest = {
    files: fileNames,
    folderName,
    createdAt: new Date().toISOString(),
  };
  await env.SHARES_BUCKET.put(
    `shares/${shareId}/manifest.json`,
    JSON.stringify(manifest),
  );

  return jsonResponse({ shareId }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // POST /upload
    if (request.method === "POST" && path === "/upload") {
      return handleUpload(request, env);
    }

    // GET /share/:id/manifest.json
    const manifestMatch = path.match(/^\/share\/([^/]+)\/manifest\.json$/);
    if (request.method === "GET" && manifestMatch) {
      const id = manifestMatch[1];
      const object = await env.SHARES_BUCKET.get(`shares/${id}/manifest.json`);
      if (!object) return jsonResponse({ error: "Not found" }, 404);

      return new Response(object.body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders,
        },
      });
    }

    // GET /share/:id/:path+
    const fileMatch = path.match(/^\/share\/([^/]+)\/(.+)$/);
    if (request.method === "GET" && fileMatch) {
      const id = fileMatch[1];
      const filePath = fileMatch[2];
      const object = await env.SHARES_BUCKET.get(`shares/${id}/${filePath}`);
      if (!object) return jsonResponse({ error: "Not found" }, 404);

      let contentType = "text/plain";
      if (filePath.endsWith(".md")) contentType = "text/markdown";
      else if (filePath.endsWith(".json")) contentType = "application/json";

      return new Response(object.body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
          ...corsHeaders,
        },
      });
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};
