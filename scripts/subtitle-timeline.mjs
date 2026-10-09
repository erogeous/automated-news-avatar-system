const STRONG_END = /[。！？!?]$/u;
const SOFT_END = /[，、；：,;:]$/u;
const PUNCTUATION = /[\s，。！？；：、,.!?;:“”‘’《》〈〉「」『』（）()【】\[\]—…]/gu;

export const SUBTITLE_RULES = Object.freeze({
  maxCharsPerLine: 16,
  maxLines: 2,
  maxCharsPerCue: 30,
  minCueSeconds: 0.85,
  maxCueSeconds: 6,
  snapWindowSeconds: 1.35,
});

function visibleLength(value) {
  return [...String(value).replace(PUNCTUATION, "")].length;
}

function cleanScript(value) {
  return String(value || "")
    .replace(/<#\s*\d+(?:\.\d+)?\s*#>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function splitLongClause(clause, limit) {
  const chars = [...clause];
  if (chars.length <= limit) return [clause];
  const result = [];
  let cursor = 0;
  while (cursor < chars.length) {
    let end = Math.min(chars.length, cursor + limit);
    if (end < chars.length) {
      const floor = cursor + Math.max(6, Math.floor(limit * 0.55));
      for (let index = end; index >= floor; index -= 1) {
        if (/[，、；：,;:]/u.test(chars[index - 1] || "")) { end = index; break; }
      }
    }
    result.push(chars.slice(cursor, end).join(""));
    cursor = end;
  }
  return result;
}

export function subtitleChunks(text, rules = SUBTITLE_RULES) {
  const cleaned = cleanScript(text);
  if (!cleaned) return [];
  const atoms = cleaned
    .split(/\n+|(?<=[。！？!?])|(?<=[，、；：,;:])/u)
    .map((part) => part.trim()).filter(Boolean)
    .flatMap((part) => splitLongClause(part, rules.maxCharsPerCue));
  const cues = [];
  let current = "";
  for (const atom of atoms) {
    if (!current) { current = atom; continue; }
    const combined = [...current, ...atom].length;
    if (STRONG_END.test(current) || combined > rules.maxCharsPerCue) {
      cues.push(current); current = atom;
    } else if (SOFT_END.test(current) && combined > rules.maxCharsPerLine) {
      cues.push(current); current = atom;
    } else current += atom;
  }
  if (current) cues.push(current);
  // Avoid a visually isolated one-character tail by moving it to the previous cue.
  if (cues.length > 1 && visibleLength(cues.at(-1)) <= 1 && [...cues.at(-2), ...cues.at(-1)].length <= rules.maxCharsPerCue) {
    cues[cues.length - 2] += cues.pop();
  }
  return cues.map((cue) => {
    const chars = [...cue];
    if (chars.length <= rules.maxCharsPerLine) return cue;
    const target = Math.ceil(chars.length / 2);
    let cut = target;
    const safeBoundary = (index) => {
      const before = chars[index - 1] || "", after = chars[index] || "";
      if (/[A-Za-z0-9]/u.test(before) && /[A-Za-z0-9年月日號号時时分秒%％萬万億亿元]/u.test(after)) return false;
      if (/[年月日號号時时分秒]/u.test(before) && /[0-9]/u.test(after)) return false;
      return true;
    };
    for (let radius = 0; radius <= 5; radius += 1) {
      const found = [target - radius, target + radius].find((index) => index > 0 && index < chars.length && safeBoundary(index) && /[，、；：,;:]/u.test(chars[index - 1] || ""));
      if (found) { cut = found; break; }
    }
    if (!safeBoundary(cut) || Math.max(cut, chars.length - cut) > rules.maxCharsPerLine) {
      for (let radius = 0; radius <= target; radius += 1) {
        const found = [target - radius, target + radius].find((index) => index > 0 && index < chars.length && safeBoundary(index) && Math.max(index, chars.length - index) <= rules.maxCharsPerLine);
        if (found) { cut = found; break; }
      }
    }
    return `${chars.slice(0, cut).join("")}\n${chars.slice(cut).join("")}`;
  });
}

function srtClock(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function boundariesFromSilences(silences, duration) {
  return silences
    .filter((item) => item.duration >= 0.12 && item.start > 0.05 && item.end < duration - 0.05)
    .map((item) => (item.start + item.end) / 2)
    .sort((a, b) => a - b);
}

export function createAudioAlignedSrt(text, duration, silences = [], rules = SUBTITLE_RULES) {
  const chunks = subtitleChunks(text, rules);
  if (!chunks.length || !(duration > 0)) return { srt: "", cues: [], stats: { cueCount: 0, audioDuration: duration || 0, alignment: "audio-pauses" } };
  const weights = chunks.map((chunk) => Math.max(1, visibleLength(chunk)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const orderedSilences = [...silences].sort((a, b) => a.start - b.start);
  const speechStart = orderedSilences[0]?.start <= 0.05 ? Math.min(duration, orderedSilences[0].end) : 0;
  const lastSilence = orderedSilences.at(-1);
  const speechEnd = lastSilence && lastSilence.end >= duration - 0.08 ? Math.max(speechStart, lastSilence.start) : duration;
  const speechDuration = Math.max(0.1, speechEnd - speechStart);
  const minimumCue = Math.min(rules.minCueSeconds, speechDuration / chunks.length * 0.8);
  const boundaries = boundariesFromSilences(orderedSilences, duration).filter((point) => point > speechStart && point < speechEnd);
  const used = new Set();
  const points = [speechStart];
  let cumulative = 0;
  for (let index = 0; index < chunks.length - 1; index += 1) {
    cumulative += weights[index];
    const ideal = speechStart + speechDuration * cumulative / totalWeight;
    const prior = points.at(-1);
    let point = ideal;
    let best = -1;
    let bestDistance = rules.snapWindowSeconds + 1;
    boundaries.forEach((candidate, boundaryIndex) => {
      const distance = Math.abs(candidate - ideal);
      if (!used.has(boundaryIndex) && candidate - prior >= minimumCue && distance <= rules.snapWindowSeconds && distance < bestDistance) {
        best = boundaryIndex; bestDistance = distance; point = candidate;
      }
    });
    if (best >= 0) used.add(best);
    const remaining = chunks.length - index - 1;
    const latest = speechEnd - remaining * minimumCue;
    points.push(Math.max(prior + minimumCue, Math.min(latest, point)));
  }
  points.push(speechEnd);
  const cues = chunks.map((textValue, index) => ({ index: index + 1, start: points[index], end: points[index + 1], text: textValue }));
  const srt = cues.map((cue) => `${cue.index}\n${srtClock(cue.start)} --> ${srtClock(cue.end)}\n${cue.text}`).join("\n\n") + "\n";
  return { srt, cues, stats: {
    cueCount: cues.length,
    audioDuration: duration,
    speechStart,
    speechEnd,
    pauseCount: boundaries.length,
    snappedCueCount: used.size,
    maxCharsPerLine: rules.maxCharsPerLine,
    maxLines: rules.maxLines,
    alignment: "audio-pauses",
  } };
}

export function parseSilenceDetect(stderr) {
  const events = [];
  let open = null;
  for (const line of String(stderr).split("\n")) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) open = Number(start[1]);
    const end = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (end) {
      const finish = Number(end[1]);
      const duration = Number(end[2]);
      events.push({ start: open ?? Math.max(0, finish - duration), end: finish, duration });
      open = null;
    }
  }
  return events;
}
