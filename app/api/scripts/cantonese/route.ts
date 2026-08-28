import { convertApprovedScriptToCantonese } from "../../../lib/openiapi";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { script?: unknown; anchorName?: unknown };
    if (typeof body.script !== "string" || body.script.trim().length < 100) {
      return Response.json({ error: "請先確認完整的繁體中文書面母稿" }, { status: 400 });
    }
    if (typeof body.anchorName !== "string" || !body.anchorName.trim()) {
      return Response.json({ error: "請先選擇本期主播" }, { status: 400 });
    }
    const now = new Date();
    const airDate = new Intl.DateTimeFormat("zh-HK", {
      timeZone: "Asia/Hong_Kong", year: "numeric", month: "long", day: "numeric", weekday: "long",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", weekday: "long" }).format(now);
    return Response.json(await convertApprovedScriptToCantonese({
      script: body.script,
      anchorName: body.anchorName.trim().slice(0, 30),
      airDate: `今天是${airDate}`,
      farewell: weekday === "星期五" ? "下周再見" : "明天再見",
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "粵語口播轉寫失敗" },
      { status: 502 },
    );
  }
}
