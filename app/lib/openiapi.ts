import { CANTONESE_CONVERSION_PROMPT, NEWS_SCRIPT_SOP, NEWS_SCRIPT_SOP_PROMPT } from "./news-script-sop";

const REQUIRED_MODELS = ["MiniMax-Voice-Clone", "speech-2.8-hd", "speech-2.8-turbo"] as const;

type ProviderError = {
  error?: { message?: string };
  base_resp?: { status_code?: number; status_msg?: string };
};

function cleanScriptOutput(raw: string) {
  let content = raw.trim();
  // Some compatible model gateways expose internal reasoning using XML-like
  // tags. None of it is editorial content and it must never reach the UI/TTS.
  content = content
    .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/```(?:markdown|text)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // The approved script format always begins with this fixed greeting. Taking
  // the text from here also handles malformed or unclosed reasoning wrappers
  // without risking their inclusion in the editor or the speech request.
  const scriptStart = content.indexOf("各位好");
  if (scriptStart >= 0) content = content.slice(scriptStart).trim();

  // Reject a response which contains only reasoning or unexpected metadata.
  // It is safer to ask for regeneration than to expose it as broadcast copy.
  if (!content.startsWith("各位好")) return "";
  return content;
}

function config() {
  const baseUrl = process.env.OPENIAPI_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.OPENIAPI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("尚未配置 OpenIAPI 地址或 API Key");
  return { baseUrl, apiKey, origin: baseUrl.replace(/\/v1$/, "") };
}

async function providerFetch(url: string, init?: RequestInit) {
  const { apiKey } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getModelStatus() {
  const { baseUrl } = config();
  const response = await providerFetch(`${baseUrl}/models`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> } & ProviderError;
  if (!response.ok) throw new Error(payload.error?.message || `模型接口返回 ${response.status}`);

  const ids = new Set((payload.data || []).map((item) => item.id).filter((id): id is string => Boolean(id)));
  return {
    connected: true,
    modelCount: ids.size,
    models: Object.fromEntries(REQUIRED_MODELS.map((model) => [model, ids.has(model)])),
  };
}

export async function synthesizeCantonesePreview(input: {
  text: string;
  voiceId: string;
  speed?: number;
}) {
  const { origin } = config();
  const text = input.text.trim().slice(0, 260);
  if (!text) throw new Error("试听文本不能为空");
  const speed = Math.min(1.2, Math.max(0.8, input.speed ?? 1));

  const response = await providerFetch(`${origin}/minimax/v1/t2a_v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "speech-2.8-hd",
      text,
      stream: false,
      language_boost: "Chinese,Yue",
      voice_setting: { voice_id: input.voiceId, speed, vol: 1, pitch: 0 },
      // 64 kbps mono is sufficient for speech and lip-sync, while keeping the
      // multipart upload below the proxy limit used by the remote GPU worker.
      audio_setting: { sample_rate: 32000, bitrate: 64000, format: "mp3", channel: 1 },
    }),
  });

  const payload = (await response.json()) as ProviderError & {
    data?: { audio?: string };
    extra_info?: { audio_length?: number; usage_characters?: number };
  };
  const providerStatus = payload.base_resp?.status_code ?? 0;
  if (!response.ok || providerStatus !== 0 || !payload.data?.audio) {
    throw new Error(payload.base_resp?.status_msg || payload.error?.message || `配音接口返回 ${response.status}`);
  }

  const hex = payload.data.audio;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("配音接口返回了无效音频");
  const audio = new Uint8Array(hex.length / 2);
  for (let i = 0; i < audio.length; i += 1) audio[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  return {
    audio,
    durationMs: payload.extra_info?.audio_length ?? 0,
    characters: payload.extra_info?.usage_characters ?? text.length,
  };
}

export async function generateCantoneseNewsScript(sourceText: string, context?: {
  anchorName?: string;
  airDate?: string;
  farewell?: string;
}) {
  const { baseUrl } = config();
  const source = sourceText.trim().slice(0, 40_000);
  if (source.length < 80) throw new Error("新闻材料太短，请提供更完整的正文或事实摘要");

  const response = await providerFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "gpt-5.4",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content: [
            "你是香港电视新闻节目《點觀香港》的资深口播编辑。",
            "只可使用用户提供的新闻材料，不得加入外部知识、推测、评价或未经材料支持的因果关系。",
            "如果来源之间有冲突或关键信息不足，必须采用审慎表达，不可自行裁决或补写。",
            NEWS_SCRIPT_SOP_PROMPT,
          ].join("\n\n"),
        },
        {
          role: "user",
          content: [
            `本期播出日期：${context?.airDate || "按今天香港日期"}`,
            `本期數字人主播：${context?.anchorName || "梁正言"}`,
            `固定結尾：我們${context?.farewell || "明天再見"}！`,
            `以下是本期新聞材料：\n\n${source}`,
          ].join("\n"),
        },
      ],
    }),
  });

  const payload = (await response.json()) as ProviderError & {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = payload.choices?.[0]?.message?.content;
  const content = rawContent ? cleanScriptOutput(rawContent) : "";
  if (!response.ok || !content) {
    throw new Error(payload.error?.message || `稿件模型返回 ${response.status}`);
  }
  return {
    content,
    model: process.env.LLM_MODEL || "gpt-5.4",
    sop: NEWS_SCRIPT_SOP,
  };
}

export async function convertApprovedScriptToCantonese(input: {
  script: string;
  anchorName: string;
  airDate: string;
  farewell: string;
}) {
  const { baseUrl } = config();
  const script = input.script.trim().slice(0, 20_000);
  if (script.length < 100) throw new Error("確認稿內容太短，無法轉換粵語口播");
  const model = process.env.LLM_MODEL || "gpt-5.4";
  const response = await providerFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      messages: [
        { role: "system", content: CANTONESE_CONVERSION_PROMPT },
        {
          role: "user",
          content: [
            `指定播出日期：${input.airDate}`,
            `指定主播姓名：${input.anchorName}`,
            `指定結尾：我們${input.farewell}！`,
            `以下是客戶已確認的繁體中文書面母稿：\n\n${script}`,
          ].join("\n"),
        },
      ],
    }),
  });
  const payload = (await response.json()) as ProviderError & {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = payload.choices?.[0]?.message?.content;
  const content = rawContent ? cleanScriptOutput(rawContent) : "";
  if (!response.ok || !content) throw new Error(payload.error?.message || `粵語轉寫模型返回 ${response.status}`);
  return { content, model, sop: NEWS_SCRIPT_SOP };
}
