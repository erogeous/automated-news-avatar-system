export type SubtitleStats = { cueCount: number; audioDuration: number; pauseCount?: number; snappedCueCount?: number; maxCharsPerLine: number; maxLines: number; alignment: "draft" | "audio-pauses" };
const MAX_CHARS_PER_LINE = 16;
const MAX_CHARS_PER_CUE = 30;
const PUNCTUATION = /[\s，。！？；：、,.!?;:“”‘’《》〈〉「」『』（）()【】\[\]—…]/gu;
function visibleLength(value: string) { return [...value.replace(PUNCTUATION, "")].length; }

export function subtitleChunks(text: string) {
  const cleaned = text
    .replace(/<#\s*\d+(?:\.\d+)?\s*#>/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) return [];

  const atoms = cleaned.split(/\n+|(?<=[。！？!?，、；：,;:])/u).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const atom of atoms) {
    const chars = [...atom];
    const parts = Array.from({ length: Math.ceil(chars.length / MAX_CHARS_PER_CUE) }, (_, index) => chars.slice(index * MAX_CHARS_PER_CUE, (index + 1) * MAX_CHARS_PER_CUE).join(""));
    for (const part of parts) {
      const combinedLength = [...current, ...part].length;
      if (current && (/[。！？!?]$/u.test(current) || combinedLength > MAX_CHARS_PER_CUE || (/[，、；：,;:]$/u.test(current) && combinedLength > MAX_CHARS_PER_LINE))) { chunks.push(current); current = part; }
      else current += part;
    }
  }
  if (current) chunks.push(current);
  if (chunks.length > 1 && visibleLength(chunks.at(-1) || "") <= 1 && [...chunks.at(-2)!, ...chunks.at(-1)!].length <= MAX_CHARS_PER_CUE) chunks[chunks.length - 2] += chunks.pop();
  return chunks.map((chunk) => {
    const chars = [...chunk];
    if (chars.length <= MAX_CHARS_PER_LINE) return chunk;
    const target = Math.ceil(chars.length / 2);
    let cut = target;
    const safeBoundary = (index: number) => {
      const before = chars[index - 1] || "", after = chars[index] || "";
      if (/[A-Za-z0-9]/u.test(before) && /[A-Za-z0-9年月日號号時时分秒%％萬万億亿元]/u.test(after)) return false;
      if (/[年月日號号時时分秒]/u.test(before) && /[0-9]/u.test(after)) return false;
      return true;
    };
    for (let radius = 0; radius <= 5; radius += 1) {
      const found = [target - radius, target + radius].find((index) => index > 0 && index < chars.length && safeBoundary(index) && /[，、；：,;:]/u.test(chars[index - 1] || ""));
      if (found) { cut = found; break; }
    }
    if (!safeBoundary(cut) || Math.max(cut, chars.length - cut) > MAX_CHARS_PER_LINE) {
      for (let radius = 0; radius <= target; radius += 1) {
        const found = [target - radius, target + radius].find((index) => index > 0 && index < chars.length && safeBoundary(index) && Math.max(index, chars.length - index) <= MAX_CHARS_PER_LINE);
        if (found) { cut = found; break; }
      }
    }
    return `${chars.slice(0, cut).join("")}\n${chars.slice(cut).join("")}`;
  });
}

function srtClock(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

/**
 * Browser preview only. Final output uses audio-pause alignment in the media service.
 */
export function createDraftSrt(text: string, totalDurationSeconds = 0) {
  const chunks = subtitleChunks(text);
  if (!chunks.length) return "";
  const weights = chunks.map((chunk) => Math.max(1, visibleLength(chunk)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const duration = totalDurationSeconds > 0 ? totalDurationSeconds : chunks.length * 4;
  let cursor = 0;

  return chunks.map((chunk, index) => {
    const remaining = Math.max(0.8, duration - cursor);
    const cueDuration = index === chunks.length - 1
      ? remaining
      : Math.max(0.8, duration * (weights[index] / totalWeight));
    const end = Math.min(duration, cursor + cueDuration);
    const entry = `${index + 1}\n${srtClock(cursor)} --> ${srtClock(end)}\n${chunk}`;
    cursor = end;
    return entry;
  }).join("\n\n") + "\n";
}

export function srtDataUrlFromContent(content: string) {
  return `data:application/x-subrip;charset=utf-8,${encodeURIComponent(content)}`;
}

/** @deprecated Historical studio compatibility; new work uses audio-aligned SRT content. */
export function srtDataUrl(text: string, totalDurationSeconds = 0) {
  return srtDataUrlFromContent(createDraftSrt(text, totalDurationSeconds));
}
