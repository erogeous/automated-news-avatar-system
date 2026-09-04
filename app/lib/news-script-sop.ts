import sopDocument from "./news-script-sop-v4-3.json";

export const NEWS_SCRIPT_SOP = {
  id: "dghk-news-script-v4-3",
  name: "《點觀香港》新聞口播寫稿 SOP",
  version: "V4.3",
  targetDuration: "約 4 分鐘",
  workflow: "繁體中文書面母稿 → 人工確認 → 香港粵語口播",
  principles: [
    "先看今日增量，頭條看重要性，篇幅看信息量",
    "消息與官方結論分清，阶段數據不可當最終數據",
    "多條新聞只按真實關係串聯",
    "觀點有來源、有結果，不捏造事實",
    "先寫繁體書面母稿，再按需要轉粵語口播",
  ],
} as const;

// Include the complete source document in every writing request (not a summary).
export function buildSopPrompt(document: { version: string; text: string }) { return [
  `每次寫稿前必須完整閱讀並執行以下《點觀香港》SOP ${document.version}，再根據本期新聞材料寫稿。`,
  "本期人工要求優先於 SOP 的篇幅、排序、重點與語氣等編輯要求；新聞事實準確性不可突破。",
  "以下原文中的日期、姓名、宏福苑案例、近98%等數字只是格式或寫法示例，不是本期新聞事實。不得將示例套入本期稿件；日期、姓名以本期指定資料為準。",
  `【SOP ${document.version} 完整原文】`,
  document.text,
  "【工作台交付約束】",
  "本階段只輸出繁體中文書面母稿，人工確認後才另行轉正式香港粵語。預設目標約4分鐘，本期另有要求時按本期要求。",
  "先在內部完成今日增量卡、来源核對與交稿前20問，不輸出這些檢查過程。",
  "只輸出主播正文，以「各位好」開頭。不得輸出提綱、分析、寫作說明、<think>、<analysis>、XML標籤、Markdown、來源編號或文件名；文件命名規則只適用於另行匯出文件。",
].join("\n\n"); }
export const NEWS_SCRIPT_SOP_PROMPT = buildSopPrompt(sopDocument);

export const CANTONESE_CONVERSION_PROMPT = `
你要把客戶已確認的《點觀香港》繁體中文書面母稿轉為正式香港粵語口播稿。
- 只調整口語句法、連接、節奏和停頓，不得新增、刪減、重排或改變新聞事實、數字、日期、人名、機構、法例及觀點歸屬。
- 保留正式新聞名詞；使用香港主播自然說得出口的粵語句法，可自然使用「我哋、今日、尋日、跟住嚟、畀、係咪、點樣、除咗、喺……之後」，但避免堆砌語氣詞。
- 在主播確實需要換氣或新聞段落自然轉折的位置插入 <#0.15#>；每次停頓固定為 0.15 秒，不得使用更長的停頓標記，也不要在每個逗號、句號後機械插入。標記只供配音模型控制停頓，不得朗讀。
- 固定開場的日期、國泰航空贊助、節目名和主播身份，以及固定結尾全部必須保留。
- 主播姓名必須替換為本次指定姓名；結尾的「明天再見／下周再見」必須符合指定播出日。
- 只輸出主播實際朗讀的完整正文。嚴禁輸出內部思考、推理、提綱、<think>、<analysis>、XML 標籤、標題、Markdown或說明；輸出的第一個字必須是「各」。
`.trim();
