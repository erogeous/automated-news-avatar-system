import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PUBLIC_ASSET_PROXY_PORT || 3200);
const allowedAnchors = new Set([
  "/anchors/hk-male-anchor-render.jpg",
  "/anchors/hk-male-anchor-greenscreen-submit.jpg",
  "/anchors/hk-female-anchor-render.jpg",
  "/anchors/hk-female-anchor-greenscreen-submit.jpg",
]);
const audioPattern = /^\/audio\/[a-f0-9]{32}\/slice-\d{3}\.mp3$/;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ready: true, scope: "anchors-and-audio-slices-only" }));
      return;
    }
    if (request.method === "GET" && allowedAnchors.has(url.pathname)) {
      const data = await readFile(path.join(root, "public", url.pathname));
      response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(data.length), "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
      response.end(data); return;
    }
    if (request.method === "GET" && audioPattern.test(url.pathname)) {
      const upstream = await fetch(`http://127.0.0.1:3101${url.pathname}`);
      if (!upstream.ok) throw Object.assign(new Error("Audio slice not found"), { status: upstream.status });
      const data = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": String(data.length), "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
      response.end(data); return;
    }
    response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    response.writeHead(Number(error?.status) || 500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Restricted asset proxy: http://127.0.0.1:${port}`));
