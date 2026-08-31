import { readNewsLinks } from "../../../lib/news-source";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { urls?: unknown };
    const articles = await readNewsLinks(body.urls);
    if (!articles.length) return Response.json({ error: "请至少填写 1 条公开新闻链接" }, { status: 400 });
    return Response.json({
      articles: articles.map((article) => ({ id: article.id, index: article.index, url: article.url,
        title: article.title, source: article.source, mediaCount: article.media.length })),
      media: articles.flatMap((article) => article.media),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "新闻素材提取失败" }, { status: 502 });
  }
}
