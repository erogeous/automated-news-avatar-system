import { readNewsLinks } from "../../../lib/news-source";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { urls?: unknown; partial?: unknown };
    if (body.partial === true) {
      const urls = Array.isArray(body.urls) ? [...new Set(body.urls.filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))].slice(0,10) : [];
      const results = await Promise.allSettled(urls.map(url => readNewsLinks([url], true)));
      const articles = results.flatMap((result, index) => result.status === "fulfilled" ? result.value.map(article => ({
        ...article, id: `article-${index+1}`, index: index+1,
        media: article.media.map((item,i) => ({ ...item, id: `article-${index+1}-media-${i+1}`, articleId: `article-${index+1}` })),
      })) : []);
      const errors = results.flatMap((result,index) => result.status === "rejected" ? [{ url: urls[index], error: result.reason instanceof Error ? result.reason.message : "读取失败" }] : []);
      return Response.json({ articles, errors }, { headers: { "Cache-Control": "no-store" } });
    }
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
