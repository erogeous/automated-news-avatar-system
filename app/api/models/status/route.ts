import { getModelStatus } from "../../../lib/openiapi";

export async function GET() {
  try {
    return Response.json(await getModelStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { connected: false, error: error instanceof Error ? error.message : "模型连接检测失败" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
