const service = `http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}`;

function isLocalRequest(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function proxy(request: Request) {
  try {
    if (!isLocalRequest(request)) {
      return Response.json({ error: "线上 API 配置需要管理员登录" }, { status: 403 });
    }
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) {
        return Response.json({ error: "不允许此来源修改 API 配置" }, { status: 403 });
      }
    }
    const body = request.method === "POST" ? await request.text() : undefined;
    if (body && body.length > 10_000) {
      return Response.json({ error: "API 配置内容过大" }, { status: 413 });
    }
    const upstream = await fetch(`${service}/settings/apis`, {
      method: request.method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "API 配置服务暂不可用，请确认工作台已完整启动" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
