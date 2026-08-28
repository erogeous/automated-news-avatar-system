export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const baseUrl = process.env.INFINITETALK_API_URL?.replace(/\/+$/, "");
    const token = process.env.INFINITETALK_API_TOKEN;
    if (!baseUrl || !token) throw new Error("远程 InfiniteTalk 服务尚未配置");
    const { id } = await context.params;
    if (!/^[a-f0-9]{16,64}$/i.test(id)) return Response.json({ error: "任务编号无效" }, { status: 400 });
    const response = await fetch(`${baseUrl}/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数字人任务查询失败" }, { status: 502 });
  }
}
