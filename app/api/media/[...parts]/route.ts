const service = `http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}`;
const MAX_BODY_BYTES = 55 * 1024 * 1024;

function safeParts(parts: string[]) {
  return parts.length > 0 && parts.every((part) => /^[a-zA-Z0-9._-]+$/.test(part));
}

async function requestBody(request: Request) {
  if (!request.body || ["GET", "HEAD"].includes(request.method)) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("上传文件超过 55MB 上限"), { status: 413 });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function proxy(request: Request, context: { params: Promise<{ parts: string[] }> }) {
  try {
    const { parts } = await context.params;
    if (!safeParts(parts)) return Response.json({ error: "媒体路径无效" }, { status: 400 });
    if (!["GET", "HEAD", "POST"].includes(request.method)) {
      return Response.json({ error: "不支持此请求方式" }, { status: 405 });
    }
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) {
        return Response.json({ error: "不允许跨站写入" }, { status: 403 });
      }
    }

    const headers = new Headers();
    for (const name of ["content-type", "x-file-name", "range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(`${service}/${parts.join("/")}`, {
      method: request.method,
      headers,
      body: await requestBody(request) as BodyInit | undefined,
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");

    if (upstream.headers.get("content-type")?.includes("application/json")) {
      const publicBase = `${new URL(request.url).origin}/api/media`;
      const text = (await upstream.text()).replaceAll(service, publicBase);
      responseHeaders.delete("content-length");
      return new Response(text, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 503;
    return Response.json({ error: error instanceof Error ? error.message : "媒体服务暂不可用" }, { status });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
