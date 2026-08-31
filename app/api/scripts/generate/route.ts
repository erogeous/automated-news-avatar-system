import { generateCantoneseNewsScript } from "../../../lib/openiapi";
import { readNewsLinks } from "../../../lib/news-source";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { writingRequirements?: unknown; sourceText?: unknown; urls?: unknown; anchorName?: unknown };
    const writingRequirements = typeof body.writingRequirements === "string" ? body.writingRequirements.trim().slice(0, 2000) : "";
    const legacySourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";
    const validUrls = Array.isArray(body.urls)
      ? body.urls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url.trim()))
      : [];
    if (!validUrls.length && legacySourceText.length < 80) {
      return Response.json({ error: "请至少填写 1 条有效新闻链接" }, { status: 400 });
    }
    const linkedArticles = validUrls.length ? await readNewsLinks(validUrls) : [];
    const combinedSource = [
      ...linkedArticles.map((article) => article.sourceText),
      legacySourceText ? `【人工补充的正文或事实摘要】\n${legacySourceText}` : "",
    ].filter(Boolean).join("\n\n");
    const now = new Date();
    const airDate = new Intl.DateTimeFormat("zh-HK", {
      timeZone: "Asia/Hong_Kong", year: "numeric", month: "long", day: "numeric", weekday: "long",
    }).format(now).replace(/年|月/g, (value) => value).replace(/星期/, "星期");
    const weekday = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", weekday: "long" }).format(now);
    const anchorName = typeof body.anchorName === "string" && body.anchorName.trim()
      ? body.anchorName.trim().slice(0, 30) : "梁正言";
    const result = await generateCantoneseNewsScript(combinedSource, {
      anchorName,
      airDate: `今天是${airDate}`,
      farewell: weekday === "星期五" ? "下周再見" : "明天再見",
      writingRequirements,
    });
    return Response.json({
      ...result,
      articles: linkedArticles.map((article) => ({ id: article.id, index: article.index, url: article.url,
        title: article.title, source: article.source, mediaCount: article.media.length })),
      media: linkedArticles.flatMap((article) => article.media),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "口播稿生成失败" },
      { status: 502 },
    );
  }
}
