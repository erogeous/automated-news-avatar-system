const HEYGEN_ORIGIN = "https://api.heygen.com";
const HEYGEN_UPLOAD_ORIGIN = "https://upload.heygen.com";

const allowedPaths = [
  /^\/v3\/users\/me$/,
  /^\/v3\/videos$/,
  /^\/v3\/videos\/[A-Za-z0-9_-]{6,160}$/,
  /^\/v1\/asset$/,
];

export const config = { api: { bodyParser: false } };

async function rawBody(request, limit = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Asset exceeds 50MB gateway limit"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

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
    const isAssetUpload = path === "/v1/asset";
    const headers = { "X-Api-Key": apiKey, "Content-Type": isAssetUpload ? (request.headers["content-type"] || "application/octet-stream") : "application/json" };
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey === "string") headers["Idempotency-Key"] = idempotencyKey;
    const body = request.method === "POST" ? await rawBody(request) : undefined;
    const upstream = await fetch(`${isAssetUpload ? HEYGEN_UPLOAD_ORIGIN : HEYGEN_ORIGIN}${path}`, {
      method: request.method,
      headers,
      body,
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    response.setHeader("Cache-Control", "no-store");
    return response.send(text);
  } catch (error) {
    return send(response, Number(error?.status) || 502, { error: error instanceof Error ? error.message : "HeyGen upstream request failed" });
  }
}
