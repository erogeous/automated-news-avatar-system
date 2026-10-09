import sopDocument from "./news-script-sop-v4-7.json";

export const NEWS_SCRIPT_SOP = {
  id: "dghk-news-script-v4-7",
  name: "《點觀香港》新聞口播寫稿 SOP",
  version: "V4.7",
  targetDuration: "4分35秒—4分50秒（常規約1200—1350字符，按題材彈性調整）",
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
  "以下原文中的日期、姓名、案件、9月11日時長標定案例等數字只是格式或寫法示例，不是本期新聞事實。不得將示例套入本期稿件；日期、姓名以本期指定資料為準。",
  `【SOP ${document.version} 完整原文】`,
  document.text,
  "【工作台交付約束】",
  "本階段只輸出繁體中文書面母稿，人工確認後才另行轉正式香港粵語。執行 V4.7 現行校準：常規正文約1200—1350字符、中心約1270；司法、複雜社會事件、深度政策及專訪可到1350—1400；節慶、服務快訊及單純預告1000—1200也可接受，不為湊字數添加背景。統計含標點、開場與結尾，不含標題、空格與換行；本期另有要求時按本期要求。原文中V4.6案例或舊檢查表殘留的1300—1400只作歷史記錄，不作現行每日硬標準。實際配音仍以4分35秒—4分50秒為期望區間，不能只按字符數推定時長。",
  "先在內部完成今日增量卡、来源核對與交稿前25問，不輸出這些檢查過程。",
  "只輸出主播正文。固定首段為「各位好，今天是【本期完整日期星期】，歡迎收看由國泰航空特約呈現的《點觀香港》，我是數字人主播【本期姓名】。今天我們先來關注【第一條新聞導語】」。不得刪減或改寫固定開場；後續按新聞語義分段，末段使用固定結尾。不得輸出提綱、分析、寫作說明、<think>、<analysis>、XML標籤、Markdown、來源編號或文件名；文件命名規則只適用於另行匯出文件。",
].join("\n\n"); }
export const NEWS_SCRIPT_SOP_PROMPT = buildSopPrompt(sopDocument);

// Kept as a re-export for callers; this SOP is never added to writing prompts.
export { CANTONESE_CONVERSION_PROMPT, CANTONESE_CONVERSION_SOP } from "./cantonese-conversion-sop";
