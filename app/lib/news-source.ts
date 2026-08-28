const MAX_LINKS = 10;
const MAX_ARTICLE_CHARS = 18_000;

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function decodeHtml(text: string) {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  return text
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
      }
      return named[entity.toLowerCase()] ?? " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function extractArticleText(html: string) {
  const cleaned = html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)\b[^>]*>[^]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/article|\/section|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(cleaned)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .join("\n")
    .slice(0, MAX_ARTICLE_CHARS);
}

export async function readNewsLinks(input: unknown) {
  if (!Array.isArray(input)) return [];
  const urls = [...new Set(input.filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_LINKS);

  return Promise.all(urls.map(async (rawUrl, index) => {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) {
      throw new Error(`第 ${index + 1} 条链接不是可读取的公开网页`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 NewsAvatarWorkbench/1.0",
        },
      });
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        throw new Error("不是新闻网页格式");
      }
      const text = extractArticleText(await response.text());
      if (text.length < 80) throw new Error("没有提取到足够的新闻正文");
      return `【来源 ${index + 1}｜${url.href}】\n${text}`;
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "读取超时"
        : error instanceof Error ? error.message : "读取失败";
      throw new Error(`第 ${index + 1} 条新闻链接${message}`);
    } finally {
      clearTimeout(timer);
    }
  }));
}
