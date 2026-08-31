const MAX_LINKS = 10;
const MAX_ARTICLE_CHARS = 18_000;
const MAX_MEDIA_PER_ARTICLE = 30;

export type NewsMedia = {
  id: string;
  articleId: string;
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  caption: string;
  source: string;
  sourceUrl: string;
  origin: "article" | "page-cover" | "video";
};

export type NewsArticleSource = {
  id: string;
  index: number;
  url: string;
  title: string;
  source: string;
  text: string;
  sourceText: string;
  media: NewsMedia[];
};

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1"
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function decodeHtml(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    }
    return named[entity.toLowerCase()] ?? " ";
  }).replace(/\s+/g, " ").trim();
}

function extractArticleText(html: string) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/article|\/section|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(cleaned).split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 8).join("\n").slice(0, MAX_ARTICLE_CHARS);
}

function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function metaContent(html: string, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return attrs.content;
  }
  return "";
}

function absoluteMediaUrl(value: string | undefined, baseUrl: string) {
  if (!value) return "";
  const candidate = decodeHtml(value).replace(/\\\//g, "/").trim();
  if (!candidate || /["'\\]/.test(candidate) || /^(data|blob|javascript):/i.test(candidate)) return "";
  try {
    const url = new URL(candidate, baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) return "";
    return url.href;
  } catch { return ""; }
}

function bestSrcset(value: string | undefined) {
  if (!value) return "";
  return value.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || "";
}

function looksLikePageChrome(url: string, attrs: Record<string, string>) {
  const hint = `${url} ${attrs.class || ""} ${attrs.id || ""} ${attrs.alt || ""}`.toLowerCase();
  const width = Number.parseInt(attrs.width || "0", 10);
  const height = Number.parseInt(attrs.height || "0", 10);
  return /dotnews-static\.dotdotnews\.com\/img/.test(hint)
    || /(logo|icon|avatar|emoji|sprite|button|badge|qr(code)?|loading|placeholder|advert|banner-ad|facebook|twitter|youtube|weibo|搜索|用戶)/.test(hint)
    || /(defaultpicture|maxpicclose)/.test(hint)
    || (width > 0 && height > 0 && (width < 180 || height < 100));
}

function extractMedia(html: string, article: { id: string; url: string; source: string }) {
  const items: NewsMedia[] = [];
  const seen = new Set<string>();
  const add = (type: "image" | "video", rawUrl: string | undefined, options: { caption?: string; thumbnailUrl?: string; origin?: NewsMedia["origin"] } = {}) => {
    let url = absoluteMediaUrl(rawUrl, article.url);
    if (type === "video" && url) {
      try {
        const embeddedSource = new URL(url).searchParams.get("src");
        url = absoluteMediaUrl(embeddedSource || url, article.url);
      } catch { /* keep the original media URL */ }
    }
    const dedupeKey = type === "video" ? `${type}:${url.split("/").at(-1)?.split("?")[0]}` : url;
    if (!url || seen.has(dedupeKey) || items.length >= MAX_MEDIA_PER_ARTICLE) return;
    seen.add(dedupeKey);
    items.push({ id: `${article.id}-media-${items.length + 1}`, articleId: article.id, type, url,
      thumbnailUrl: absoluteMediaUrl(options.thumbnailUrl, article.url) || undefined,
      caption: decodeHtml(options.caption || ""), source: article.source, sourceUrl: article.url,
      origin: options.origin || (type === "video" ? "video" : "article") });
  };

  const pageCover = metaContent(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  add("image", pageCover, { caption: "新闻封面", origin: "page-cover" });
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const rawUrl = attrs["data-original"] || attrs["data-src"] || attrs["data-lazy-src"] || attrs.src || bestSrcset(attrs.srcset || attrs["data-srcset"]);
    const url = absoluteMediaUrl(rawUrl, article.url);
    if (!url || looksLikePageChrome(url, attrs)) continue;
    add("image", url, { caption: attrs.alt || attrs.title || "新闻图片" });
  }

  const socialVideo = metaContent(html, ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]);
  add("video", socialVideo, { thumbnailUrl: pageCover, caption: "新闻视频", origin: "video" });
  for (const match of html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/?\s*>/gi)) {
    const openTag = match[0].match(/<video\b[^>]*>/i)?.[0] || match[0];
    const attrs = attributes(openTag);
    const sourceTag = match[0].match(/<source\b[^>]*>/i)?.[0];
    const sourceAttrs = sourceTag ? attributes(sourceTag) : {};
    add("video", attrs.src || attrs["data-src"] || sourceAttrs.src || sourceAttrs["data-src"], {
      thumbnailUrl: attrs.poster || pageCover, caption: attrs.title || "新闻视频", origin: "video" });
  }
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|m3u8)(?:\?[^"'<>\s]*)?/gi)) {
    add("video", match[0], { thumbnailUrl: pageCover, caption: "新闻视频", origin: "video" });
  }
  return items;
}

export async function readNewsLinks(input: unknown): Promise<NewsArticleSource[]> {
  if (!Array.isArray(input)) return [];
  const urls = [...new Set(input.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim()).filter(Boolean).slice(0, MAX_LINKS);
  return Promise.all(urls.map(async (rawUrl, index) => {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) throw new Error(`第 ${index + 1} 条链接不是可读取的公开网页`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { redirect: "follow", signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 NewsAvatarWorkbench/1.0" } });
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("不是新闻网页格式");
      const html = await response.text();
      const text = extractArticleText(html);
      if (text.length < 80) throw new Error("没有提取到足够的新闻正文");
      const id = `article-${index + 1}`;
      const source = metaContent(html, ["og:site_name", "application-name"]) || url.hostname.replace(/^www\./, "");
      const rawTitle = metaContent(html, ["og:title", "twitter:title", "headline"])
        || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || `新闻来源 ${index + 1}`;
      const title = decodeHtml(rawTitle).slice(0, 180);
      const article = { id, index: index + 1, url: response.url || url.href, title, source };
      return { ...article, text, sourceText: `【来源 ${index + 1}｜${title}｜${article.url}】\n${text}`,
        media: extractMedia(html, article) };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "读取超时" : error instanceof Error ? error.message : "读取失败";
      throw new Error(`第 ${index + 1} 条新闻链接${message}`);
    } finally { clearTimeout(timer); }
  }));
}
