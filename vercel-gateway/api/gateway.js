const HEYGEN_ORIGIN = "https://api.heygen.com";

const allowedPaths = [
  /^\/v3\/users\/me$/,
  /^\/v3\/videos$/,
  /^\/v3\/videos\/[A-Za-z0-9_-]{6,160}$/,
];

function send(response, status, value) {
  response.setHeader("Cache-Control", "no-store");
  response.status(status).json(value);
}

export default async function handler(request, response) {
  const path = typeof request.query.path === "string" ? `/${request.query.path.replace(/^\/+/, "")}` : "/";
  if (request.method === "GET" && path === "/health") {
    return send(response, 200, { ready: true, service: "heygen-vercel-gateway" });
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return send(response, 503, { error: "Gateway secret is not configured" });
  if (request.headers.authorization !== `Bearer ${apiKey}`) return send(response, 401, { error: "Unauthorized" });
  if (!allowedPaths.some((pattern) => pattern.test(path))) return send(response, 404, { error: "Not found" });
  if (!(["GET", "POST"].includes(request.method))) return send(response, 405, { error: "Method not allowed" });

  try {
    const headers = { "X-Api-Key": apiKey, "Content-Type": "application/json" };
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey === "string") headers["Idempotency-Key"] = idempotencyKey;
    const upstream = await fetch(`${HEYGEN_ORIGIN}${path}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? JSON.stringify(request.body ?? {}) : undefined,
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", "no-store");
    return response.send(text);
  } catch (error) {
    return send(response, 502, { error: error instanceof Error ? error.message : "HeyGen upstream request failed" });
  }
}
