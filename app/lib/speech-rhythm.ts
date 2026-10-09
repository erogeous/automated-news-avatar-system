// Workbench rhythm policy: punctuation supplies pauses. Artificial pause tags
// are removed before TTS because providers already pause at punctuation and can
// otherwise create a second, audible break at the same semantic boundary.
export const DEFAULT_NEWS_SPEECH_SPEED = 1.08;

export function normalizeSpeechPauses(content: string) {
  return content
    .replace(/<#\s*\d+(?:\.\d+)?\s*#>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unwrapEditorialMarks(content: string) {
  return content
    .replace(/《([^《》\n]+)》/g, "$1")
    .replace(/〈([^〈〉\n]+)〉/g, "$1")
    .replace(/“([^“”\n]+)”/g, "$1")
    .replace(/「([^「」\n]+)」/g, "$1")
    .replace(/『([^『』\n]+)』/g, "$1");
}

// Apply only at TTS submission: retain editorial typography in the approved script.
export function prepareSpeechText(content: string) {
  const gap = String.raw`(?:\s|<#\s*\d+(?:\.\d+)?\s*#>)*`;
  const number = String.raw`[0-9０-９零〇一二三四五六七八九十兩两]+`;
  const date = new RegExp(
    `${number}${gap}年${gap}${number}${gap}月${gap}${number}${gap}[日號号](?:${gap}[，,、]?${gap}(?:星期|禮拜|礼拜|週|周)${gap}[一二三四五六日天])?`,
    "g",
  );
  const shortDateWithWeekday = new RegExp(
    `${number}${gap}月${gap}${number}${gap}[日號号]${gap}[，,、]?${gap}(?:星期|禮拜|礼拜|週|周)${gap}[一二三四五六日天]`,
    "g",
  );
  const joinDate = (value: string) => value.replace(/\s|[，,、]|<#\s*\d+(?:\.\d+)?\s*#>/g, "");
  const continuousDates = content.replace(date, joinDate).replace(shortDateWithWeekday, joinDate);
  // Book-title and quotation marks are editorial typography, not spoken words.
  // Their inner punctuation remains, so direct speech and sentence boundaries
  // keep their semantic rhythm without adding pauses at both sides of the marks.
  return normalizeSpeechPauses(unwrapEditorialMarks(continuousDates));
}

export const SPEECH_CONTINUITY_RULES = [
  "【語義連讀規則】目標是意思清楚、自然連貫，不是消除所有停頓。",
  "完整日期與星期是一個語義單位，內部不插入空格、換行、逗號或停頓標記；日期結束後按句法保留標點。不改數值或擅自改寫數字讀法。",
  "節目名、書名及活動名與前後短語按句法自然連讀，書名號本身不是換氣指令。轉寫文本保留排版符號，提交配音時程序去除書名號，保留名稱內真正需要的標點。",
  "完整引語保留原有文字、信源及語義邊界。引述提示語、引語內容、返回主播敘述使用已有冒號、逗號和句號分層；提交配音時程序去除中文引號，避免在引號兩側额外停頓。",
  "逗號是短語邊界，句號是完整意思結束，段落是話題轉換；只在確有語義需要時停頓。不得把每個書名號或引號變成逗號，不拆專名、數字和單位，不按字數加停頓。",
  "不刪必要標點來強行連讀，不添加 SSML、人工停頓、音效或未支持的韻律標籤。實際自然停頓由句法、標點和 TTS 共同決定，須經試聽確認。",
].join("\n");
