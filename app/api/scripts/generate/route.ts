import { generateCantoneseNewsScript } from "../../../lib/openiapi";
import { readNewsLinks } from "../../../lib/news-source";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sourceText?: unknown; urls?: unknown; anchorName?: unknown };
    const sourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";
    const validUrls = Array.isArray(body.urls)
      ? body.urls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url.trim()))
      : [];
    if (!validUrls.length && sourceText.length < 80) {
      return Response.json({ error: "请至少填写 1 条新闻链接，或粘贴至少 80 个字的新闻正文" }, { status: 400 });
    }
    const linkedArticles = validUrls.length ? await readNewsLinks(validUrls) : [];
    const combinedSource = [
      ...linkedArticles,
      sourceText ? `【人工补充的正文或事实摘要】\n${sourceText}` : "",
    ].filter(Boolean).join("\n\n");
    const now = new Date();
    const airDate = new Intl.DateTimeFormat("zh-HK", {
      timeZone: "Asia/Hong_Kong", year: "numeric", month: "long", day: "numeric", weekday: "long",
    }).format(now).replace(/年|月/g, (value) => value).replace(/星期/, "星期");
    const weekday = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", weekday: "long" }).format(now);
    const anchorName = typeof body.anchorName === "string" && body.anchorName.trim()
      ? body.anchorName.trim().slice(0, 30) : "梁正言";
    return Response.json(await generateCantoneseNewsScript(combinedSource, {
      anchorName,
      airDate: `今天是${airDate}`,
      farewell: weekday === "星期五" ? "下周再見" : "明天再見",
    }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "口播稿生成失败" },
      { status: 502 },
    );
  }
}
