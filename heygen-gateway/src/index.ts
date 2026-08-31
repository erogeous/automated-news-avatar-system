interface Env {
  HEYGEN_API_KEY: string;
  GATEWAY_TOKEN: string;
}

const HEYGEN_ORIGIN = "https://api.heygen.com";
const allowedPaths = [
  /^\/v3\/users\/me$/,
  /^\/v3\/videos$/,
  /^\/v3\/videos\/[A-Za-z0-9_-]{6,160}$/,
];

function json(status: number, value: unknown) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);
    if (request.method === "GET" && incoming.pathname === "/health") {
      return json(200, { ready: true, service: "heygen-gateway" });
    }
    if (!env.HEYGEN_API_KEY || !env.GATEWAY_TOKEN) return json(503, { error: "Gateway secrets are not configured" });
    if (request.headers.get("Authorization") !== `Bearer ${env.GATEWAY_TOKEN}`) return json(401, { error: "Unauthorized" });
    if (!allowedPaths.some((pattern) => pattern.test(incoming.pathname))) return json(404, { error: "Not found" });
    if (!(["GET", "POST"].includes(request.method))) return json(405, { error: "Method not allowed" });

    const upstream = new URL(incoming.pathname, HEYGEN_ORIGIN);
    const headers = new Headers({ "X-Api-Key": env.HEYGEN_API_KEY, "Content-Type": "application/json" });
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  },
};
