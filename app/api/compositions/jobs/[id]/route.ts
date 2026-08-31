import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id)) return Response.json({ error: "合片任务编号无效" }, { status: 400 });
    const job = JSON.parse(await readFile(path.join(process.cwd(), ".composition-jobs", id, "job.json"), "utf8"));
    return Response.json({ ...job, download_url: job.status === "completed" ? `/api/compositions/jobs/${id}/download` : "" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "没有找到该合片任务" }, { status: 404 });
  }
}
