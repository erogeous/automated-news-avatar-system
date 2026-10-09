import { safeBytes } from "../../scripts/library-download.mjs";
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
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
    }
    return named[entity.toLowerCase()] ?? " ";
  }).replace(/\s+/g, " ").trim();
}

function articleBody(html: string) {
  // Prefer publisher-defined body containers, retaining nested elements.
  const candidates = [
    /<(div|section)\b[^>]*(?:id=["'](?:paragraph|articleBody|article-content|content_area|Content|content)["']|class=["'][^"']*(?:article-content|post-content|entry-content|article__content|cnt_bd|left_zw)[^"']*["'])[^>]*>/gi,
    /<(article)\b[^>]*>/gi,
    /<(main)\b[^>]*>/gi,
  ];
  for (const pattern of candidates) {
    for (const opening of html.matchAll(pattern)) {
      const tag = opening[1];
      const start = (opening.index || 0) + opening[0].length;
      const rest = html.slice(start);
      const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
      let depth = 1;
      for (const token of rest.matchAll(tags)) {
        depth += token[0].startsWith("</") ? -1 : token[0].endsWith("/>") ? 0 : 1;
        if (depth === 0) {
          const content = rest.slice(0, token.index);
          if (content.replace(/<[^>]*>/g, "").trim().length >= 80) return content;
          break;
        }
      }
    }
  }
  return html;
}

function extractArticleText(html: string) {
  const cleaned = articleBody(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/article|\/section|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return cleaned.split(/\n+/).map(decodeHtml).filter((line) => line.length >= 8).join("\n").slice(0, MAX_ARTICLE_CHARS);
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

export async function readNewsLinks(input: unknown, requireBodyParagraphs = false): Promise<NewsArticleSource[]> {
  if (!Array.isArray(input)) return [];
  const urls = [...new Set(input.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim().replace(/^[“”‘’]+|[“”‘’]+$/g, "").trim()).filter(Boolean).slice(0, MAX_LINKS);
  return Promise.all(urls.map(async (rawUrl, index) => {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) throw new Error(`第 ${index + 1} 条链接不是可读取的公开网页`);
    try {
      const response = await safeBytes(url.href, { left: 3_000_000 });
      const contentType = response.type;
      if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) throw new Error("不是新闻网页格式");
      const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]
        || response.bytes.toString("ascii", 0, 1500).match(/charset=["']?([\w-]+)/i)?.[1] || "utf-8";
      const html = new TextDecoder(charset).decode(response.bytes);
      let text = extractArticleText(html);
      if (requireBodyParagraphs) {
        const paragraphs = [...articleBody(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
          .map(match => decodeHtml(match[1].replace(/<[^>]+>/g, " ")))
          .filter(line => line.length >= 25);
        const body = paragraphs.join("\n");
        if (body.length < 120) throw new Error("没有足够的正文段落，可能是图集、视频页或访问限制；请换一条文字报道链接");
        text = body.slice(0, MAX_ARTICLE_CHARS);
      }
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
    }
  }));
}
