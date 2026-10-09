import assert from "node:assert/strict";
import { compositionMediaUrl } from "./composition-media-url.mjs";

const port = 3101;
assert.equal(
  compositionMediaUrl("/api/media/avatar-outputs/slice-000-33f8d4908e24622752ec17de63e95c1c.mp4", port),
  "http://127.0.0.1:3101/avatar-outputs/slice-000-33f8d4908e24622752ec17de63e95c1c.mp4",
);
assert.equal(
  compositionMediaUrl("/api/media/library/downloads/696a017551fc029415bb23123d62dd22/file", port),
  "http://127.0.0.1:3101/library/downloads/696a017551fc029415bb23123d62dd22/file",
);
assert.equal(compositionMediaUrl("https://example.com/video.mp4", port), "https://example.com/video.mp4");
assert.equal(compositionMediaUrl("/api/media/avatar-outputs/not-safe.mp4", port), "/api/media/avatar-outputs/not-safe.mp4");

console.log("composition media URL tests passed");
