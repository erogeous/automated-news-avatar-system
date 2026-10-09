export function compositionMediaUrl(value, port) {
  if (typeof value !== "string") return "";
  const local = value.match(/^\/api\/media\/(library\/downloads\/[a-f0-9]{32}\/file|avatar-outputs\/slice-\d{3}-[a-f0-9]{32}\.mp4)$/);
  return local ? `http://127.0.0.1:${port}/${local[1]}` : value;
}
