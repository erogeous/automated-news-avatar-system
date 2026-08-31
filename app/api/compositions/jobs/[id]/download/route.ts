import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id)) return Response.json({ error: "合片任务编号无效" }, { status: 400 });
    const root = path.join(process.cwd(), ".composition-jobs", id);
    const job = JSON.parse(await readFile(path.join(root, "job.json"), "utf8"));
    if (job.status !== "completed") return Response.json({ error: "成片尚未完成" }, { status: 409 });
    const video = await readFile(path.join(root, "final.mp4"));
    return new Response(video, { headers: { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="news-avatar-${id.slice(0, 8)}.mp4"`, "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "成片文件不存在" }, { status: 404 });
  }
}
