import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PUBLIC_ASSET_PROXY_PORT || 3200);
const allowedImages = new Set([
  "/anchors/hk-male-anchor-render.jpg",
  "/anchors/hk-male-anchor-greenscreen-submit.jpg",
  "/anchors/hk-female-anchor-render.jpg",
  "/anchors/hk-female-anchor-greenscreen-submit.jpg",
  "/studio-newsroom-bg-v1.png",
]);
const audioPattern = /^\/audio\/[a-f0-9]{32}\/slice-\d{3}\.mp3$/;

function sendMedia(request, response, data, contentType) {
  const range = request.headers.range;
  const common = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { ...common, "Content-Range": `bytes */${data.length}` });
      response.end(); return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    if (start > end || start >= data.length) {
      response.writeHead(416, { ...common, "Content-Range": `bytes */${data.length}` });
      response.end(); return;
    }
    response.writeHead(206, { ...common, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${data.length}` });
    response.end(request.method === "HEAD" ? undefined : data.subarray(start, end + 1));
    return;
  }
  response.writeHead(200, { ...common, "Content-Length": String(data.length) });
  response.end(request.method === "HEAD" ? undefined : data);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ready: true, scope: "anchors-and-audio-slices-only" }));
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && allowedImages.has(url.pathname)) {
      const data = await readFile(path.join(root, "public", url.pathname));
      sendMedia(request, response, data, url.pathname.endsWith(".png") ? "image/png" : "image/jpeg"); return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && audioPattern.test(url.pathname)) {
      const upstream = await fetch(`http://127.0.0.1:3101${url.pathname}`);
      if (!upstream.ok) throw Object.assign(new Error("Audio slice not found"), { status: upstream.status });
      const data = Buffer.from(await upstream.arrayBuffer());
      sendMedia(request, response, data, "audio/mpeg"); return;
    }
    response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    response.writeHead(Number(error?.status) || 500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Restricted asset proxy: http://127.0.0.1:${port}`));
