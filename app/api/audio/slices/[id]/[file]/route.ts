import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id) || !/^slice-\d{3}\.mp3$/.test(file)) return Response.json({ error: "音频切片地址无效" }, { status: 400 });
    const audio = await readFile(path.join(process.cwd(), ".audio-slices", id, file));
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.length), "Cache-Control": "private, max-age=3600" } });
  } catch {
    return Response.json({ error: "音频切片不存在" }, { status: 404 });
  }
}
