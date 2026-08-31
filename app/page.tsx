"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Step = 1 | 2 | 3 | 4;
type OutputLayout = "landscape" | "portrait";
type NewsArticle = { id: string; index: number; url: string; title: string; source: string; mediaCount: number };
type NewsMedia = { id: string; articleId: string; type: "image" | "video"; url: string; thumbnailUrl?: string;
  caption: string; source: string; sourceUrl: string; origin: "article" | "page-cover" | "video" };
type SceneSetting = { duration: number; cue: string };
type AudioSlice = { id: string; index: number; start: number; end: number; duration: number; url: string };
type AvatarSliceJob = { sliceId: string; label: string; start: number; end: number; id: string; status: "queued" | "running" | "completed" | "failed"; progress: number; videoUrl?: string; error?: string };
type PackagingAssetId = "background" | "logo" | "nameplate";

function matchingTokens(text: string) {
  const compact = text.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
  const tokens = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) tokens.add(compact.slice(index, index + 2));
  return tokens;
}

function matchScore(reference: string, paragraph: string) {
  const referenceTokens = matchingTokens(reference);
  const paragraphTokens = matchingTokens(paragraph);
  let score = 0;
  referenceTokens.forEach((token) => { if (paragraphTokens.has(token)) score += 1; });
  return score;
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

const initialUrls = Array.from({ length: 10 }, () => "");
const anchors = {
  male: {
    id: "male",
    name: "梁正言",
    role: "青年男主播",
    voiceId: "male-qn-qingse",
    voiceName: "粤语男声 · 沉稳清晰",
    portrait: "/anchors/hk-male-anchor-vertical.png",
    renderInput: "/anchors/hk-male-anchor-render.jpg",
    greenScreenInput: "/anchors/hk-male-anchor-greenscreen-v1.png",
    greenScreenSubmit: "/anchors/hk-male-anchor-greenscreen-submit.jpg",
    turnaround: "/anchors/hk-male-anchor-turnaround.png",
  },
  female: {
    id: "female",
    name: "林嘉晴",
    role: "青年女主播",
    voiceId: "female-shaonv",
    voiceName: "粤语女声 · 自然亲和",
    portrait: "/anchors/hk-female-anchor-vertical.png",
    renderInput: "/anchors/hk-female-anchor-render.jpg",
    greenScreenInput: "/anchors/hk-female-anchor-greenscreen-v1.png",
    greenScreenSubmit: "/anchors/hk-female-anchor-greenscreen-submit.jpg",
    turnaround: "/anchors/hk-female-anchor-turnaround.png",
  },
} as const;
const stepNames = ["输入新闻", "确认口播稿", "确认配音", "生成数字人"];
const MEDIA_SERVICE_URL = "http://127.0.0.1:3101";

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [urls, setUrls] = useState(initialUrls);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [avatarJobId, setAvatarJobId] = useState("");
  const [avatarStatus, setAvatarStatus] = useState<"idle" | "queued" | "running" | "completed" | "failed">("idle");
  const [avatarProgress, setAvatarProgress] = useState(0);
  const [avatarError, setAvatarError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [compositionJobId, setCompositionJobId] = useState("");
  const [compositionStatus, setCompositionStatus] = useState<"idle" | "queued" | "downloading" | "rendering" | "completed" | "failed">("idle");
  const [compositionProgress, setCompositionProgress] = useState(0);
  const [compositionError, setCompositionError] = useState("");
  const [compositionUrl, setCompositionUrl] = useState("");
  const [projectName, setProjectName] = useState("今日新闻口播");
  const [connection, setConnection] = useState<"checking" | "ready" | "error">("checking");
  const [connectionNote, setConnectionNote] = useState("正在检测模型…");
  const [anchorId, setAnchorId] = useState<keyof typeof anchors>("male");
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [writingRequirements, setWritingRequirements] = useState("");
  const [scriptError, setScriptError] = useState("");
  const [scriptModel, setScriptModel] = useState("");
  const [scriptSop, setScriptSop] = useState("《點觀香港》V4.1");
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsMedia, setNewsMedia] = useState<NewsMedia[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [sceneSettings, setSceneSettings] = useState<Record<string, SceneSetting>>({});
  const [outputLayout, setOutputLayout] = useState<OutputLayout>("landscape");
  const [chromaSimilarity, setChromaSimilarity] = useState(0.14);
  const [chromaBlend, setChromaBlend] = useState(0.055);
  const greenScreenPreviewRef = useRef<HTMLCanvasElement>(null);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [audioSlices, setAudioSlices] = useState<AudioSlice[]>([]);
  const [audioSliceJobId, setAudioSliceJobId] = useState("");
  const [selectedSliceIds, setSelectedSliceIds] = useState<string[]>([]);
  const [slicingBusy, setSlicingBusy] = useState(false);
  const [avatarSliceJobs, setAvatarSliceJobs] = useState<AvatarSliceJob[]>([]);
  const [packagingAssetIds, setPackagingAssetIds] = useState<PackagingAssetId[]>(["background", "logo", "nameplate"]);
  const selectedAnchor = anchors[anchorId];
  const voiceId = selectedAnchor.voiceId;
  const validCount = urls.filter((url) => /^https?:\/\//i.test(url.trim())).length;
  const charCount = useMemo(() => (script.match(/[\u3400-\u9fff]/g) || []).length, [script]);
  const minutes = charCount ? (charCount / 250).toFixed(1) : "0.0";
  const imageCount = newsMedia.filter((item) => item.type === "image").length;
  const videoCount = newsMedia.filter((item) => item.type === "video").length;
  const selectedMedia = selectedMediaIds.map((id) => newsMedia.find((item) => item.id === id)).filter((item): item is NewsMedia => Boolean(item));
  const storyboardDuration = selectedMedia.reduce((total, item) => total + (sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6)), 0);

  useEffect(() => {
    let active = true;
    fetch("/api/models/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "连接失败");
        const modelsReady = Object.values(data.models || {}).every(Boolean);
        if (!modelsReady) throw new Error("所需语音模型不完整");
        if (active) {
          setConnection("ready");
          setConnectionNote(`模型已连接 · ${data.modelCount} 个可用`);
        }
      })
      .catch((error) => {
        if (active) {
          setConnection("error");
          setConnectionNote(error instanceof Error ? error.message : "连接失败");
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  useEffect(() => {
    if (step !== 3 || outputLayout !== "landscape" || !greenScreenPreviewRef.current) return;
    let cancelled = false;
    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    Promise.all([loadImage("/studio-newsroom-bg-v1.png"), loadImage(selectedAnchor.greenScreenInput)]).then(([background, anchor]) => {
      if (cancelled) return;
      const canvas = greenScreenPreviewRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const width = canvas.width;
      const height = canvas.height;
      const backgroundScale = Math.max(width / background.width, height / background.height);
      context.clearRect(0, 0, width, height);
      context.drawImage(background, (width - background.width * backgroundScale) / 2, (height - background.height * backgroundScale) / 2, background.width * backgroundScale, background.height * backgroundScale);
      context.fillStyle = "rgba(8,18,30,.72)";
      context.fillRect(24, 94, 314, 176);
      context.strokeStyle = "rgba(69,190,255,.75)";
      context.lineWidth = 2;
      context.strokeRect(24, 94, 314, 176);
      context.fillStyle = "rgba(255,255,255,.7)";
      context.font = "12px system-ui";
      context.fillText("新闻素材区域", 38, 116);
      const anchorHeight = 374;
      const anchorWidth = Math.round(anchor.width / anchor.height * anchorHeight);
      const layer = document.createElement("canvas");
      layer.width = anchorWidth;
      layer.height = anchorHeight;
      const layerContext = layer.getContext("2d", { willReadFrequently: true });
      if (!layerContext) return;
      layerContext.filter = "brightness(1.16) contrast(1.04) saturate(1.03)";
      layerContext.drawImage(anchor, 0, 0, anchorWidth, anchorHeight);
      layerContext.filter = "none";
      const pixels = layerContext.getImageData(0, 0, anchorWidth, anchorHeight);
      const feather = Math.max(0.001, chromaBlend);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const red = pixels.data[offset];
        const green = pixels.data[offset + 1];
        const blue = pixels.data[offset + 2];
        const distance = Math.sqrt(red * red + (255 - green) ** 2 + blue * blue) / 441.67;
        pixels.data[offset + 3] = Math.round(Math.max(0, Math.min(1, (distance - chromaSimilarity) / feather)) * 255);
      }
      layerContext.putImageData(pixels, 0, 0);
      context.drawImage(layer, width - anchorWidth - 8, -22);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [step, outputLayout, selectedAnchor, chromaSimilarity, chromaBlend]);

  useEffect(() => {
    if (!avatarJobId || !["queued", "running"].includes(avatarStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/avatar/jobs/${avatarJobId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || "数字人任务查询失败");
        if (cancelled) return;
        setAvatarStatus(data.status);
        setAvatarProgress(Number(data.progress || 0));
        if (data.status === "completed" && data.video_url) {
          setVideoUrl(data.video_url);
          setVideoReady(true);
        } else if (data.status === "failed") {
          setAvatarError(data.error || "HeyGen 渲染失败");
        }
      } catch (error) {
        if (!cancelled) setAvatarError(error instanceof Error ? error.message : "数字人任务查询失败");
      }
    };
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [avatarJobId, avatarStatus, avatarProgress]);

  useEffect(() => {
    if (!avatarSliceJobs.some((job) => ["queued", "running"].includes(job.status))) return;
    let cancelled = false;
    const poll = async () => {
      const updates = await Promise.all(avatarSliceJobs.map(async (job) => {
        if (!["queued", "running"].includes(job.status)) return job;
        try {
          const response = await fetch(`/api/avatar/jobs/${job.id}`, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || data.detail || "数字人切片查询失败");
          return { ...job, status: data.status, progress: Number(data.progress || 0), videoUrl: data.video_url || job.videoUrl, error: data.status === "failed" ? (data.error || "渲染失败") : undefined } as AvatarSliceJob;
        } catch (error) {
          return { ...job, error: error instanceof Error ? error.message : "查询失败" };
        }
      }));
      if (cancelled) return;
      setAvatarSliceJobs(updates);
      const completed = updates.filter((job) => job.status === "completed");
      const failed = updates.filter((job) => job.status === "failed");
      const totalProgress = Math.round(updates.reduce((sum, job) => sum + job.progress, 0) / Math.max(1, updates.length));
      setAvatarProgress(totalProgress);
      if (completed.length === updates.length) {
        setAvatarStatus("completed");
        const previewVideo = completed.find((job) => job.videoUrl)?.videoUrl || "";
        if (previewVideo) setVideoUrl(previewVideo);
        setVideoReady(completed.every((job) => Boolean(job.videoUrl)));
      } else if (failed.length && failed.length + completed.length === updates.length) setAvatarStatus("failed");
      else setAvatarStatus("running");
    };
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [avatarSliceJobs]);

  useEffect(() => {
    if (!compositionJobId || !["queued", "downloading", "rendering"].includes(compositionStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`${MEDIA_SERVICE_URL}/compositions/${compositionJobId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "合片任务查询失败");
        if (cancelled) return;
        setCompositionStatus(data.status);
        setCompositionProgress(Number(data.progress || 0));
        if (data.status === "completed") setCompositionUrl(data.download_url);
        if (data.status === "failed") setCompositionError(data.error || "自动合片失败");
      } catch (error) {
        if (!cancelled) setCompositionError(error instanceof Error ? error.message : "合片任务查询失败");
      }
    };
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [compositionJobId, compositionStatus, compositionProgress]);

  function updateUrl(index: number, value: string) {
    setUrls((current) => current.map((url, i) => (i === index ? value : url)));
  }

  function toggleMedia(id: string) {
    if (selectedMediaIds.includes(id)) {
      setSelectedMediaIds((current) => current.filter((item) => item !== id));
      return;
    }
    const media = newsMedia.find((item) => item.id === id);
    setSceneSettings((settings) => ({ ...settings, [id]: settings[id] || { duration: media?.type === "video" ? 10 : 6, cue: "" } }));
    setSelectedMediaIds((current) => current.includes(id) ? current : [...current, id]);
  }

  function updateScene(id: string, patch: Partial<SceneSetting>) {
    const media = newsMedia.find((item) => item.id === id);
    setSceneSettings((current) => ({ ...current, [id]: { duration: media?.type === "video" ? 10 : 6, cue: "", ...current[id], ...patch } }));
  }

  function moveMedia(id: string, direction: -1 | 1) {
    setSelectedMediaIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function autoArrangeStoryboard() {
    const paragraphs = script.split(/\n{2,}|(?<=[。！？])\s*/).map((part) => part.trim()).filter((part) => part.length >= 18);
    const candidates = newsArticles.flatMap((article) => newsMedia.filter((item) => item.articleId === article.id).slice(0, 4)).slice(0, 16);
    const settings: Record<string, SceneSetting> = {};
    candidates.forEach((item) => {
      const article = newsArticles.find((entry) => entry.id === item.articleId);
      const reference = `${article?.title || ""}${item.caption}`;
      const bestParagraph = paragraphs.reduce((best, paragraph) => matchScore(reference, paragraph) > matchScore(reference, best) ? paragraph : best, paragraphs[0] || article?.title || "");
      settings[item.id] = {
        duration: item.type === "video" ? 10 : 6,
        cue: bestParagraph.length > 48 ? `${bestParagraph.slice(0, 48)}…` : bestParagraph,
      };
    });
    setSelectedMediaIds(candidates.map((item) => item.id));
    setSceneSettings(settings);
  }

  async function generateScript() {
    if (!validCount) return;
    setBusy(true);
    setScriptError("");
    try {
      const response = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writingRequirements, urls: urls.filter((url) => /^https?:\/\//i.test(url.trim())), anchorName: selectedAnchor.name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "口播稿生成失败");
      setScript(data.content);
      setScriptModel(data.model);
      setNewsArticles(Array.isArray(data.articles) ? data.articles : []);
      setNewsMedia(Array.isArray(data.media) ? data.media : []);
      setSelectedMediaIds([]);
      setSceneSettings({});
      if (data.sop?.version) setScriptSop(`《點觀香港》${data.sop.version}`);
      setBusy(false);
      setStep(2);
    } catch (error) {
      setScriptError(error instanceof Error ? error.message : "口播稿生成失败");
      setBusy(false);
    }
  }

  async function generateVoice() {
    setBusy(true);
    setVoiceError("");
    setAvatarError("");
    setVideoReady(false);
    setVideoUrl("");
    setAvatarSliceJobs([]);
    try {
      const conversionResponse = await fetch("/api/scripts/cantonese", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, anchorName: selectedAnchor.name }),
      });
      const conversion = await conversionResponse.json();
      if (!conversionResponse.ok) throw new Error(conversion.error || "粵語口播轉寫失敗");
      const cantoneseScript = conversion.content as string;
      setScript(cantoneseScript);
      const response = await fetch("/api/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cantoneseScript, voiceId, speed: 1 }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "配音生成失败");
      }
      const blob = await response.blob();
      let storeResponse: Response;
      try {
        storeResponse = await fetch(`${MEDIA_SERVICE_URL}/audio/store`, {
          method: "POST",
          headers: { "Content-Type": "audio/mpeg" },
          body: blob,
        });
      } catch {
        throw new Error("完整配音已生成，但本地媒体服务未启动，请启动后重新生成配音");
      }
      const storeText = await storeResponse.text();
      let stored: { id?: string; error?: string } = {};
      try { stored = storeText ? JSON.parse(storeText) : {}; }
      catch { throw new Error(`本地媒体服务返回异常（HTTP ${storeResponse.status}）`); }
      if (!storeResponse.ok || !stored.id) throw new Error(stored.error || "完整配音保存失败");
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(blob);
      });
      setVoiceDuration(Number(response.headers.get("X-Audio-Duration-Ms") || 0));
      setAudioSlices([]);
      setAudioSliceJobId(stored.id);
      setSelectedSliceIds([]);
      setAvatarSliceJobs([]);
      setVoiceReady(true);
      setStep(3);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "配音生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function sliceAudio() {
    if (!audioUrl || !audioSliceJobId) {
      setAvatarError("没有找到完整配音任务，请返回上一步重新生成配音");
      return;
    }
    setSlicingBusy(true);
    setAvatarError("");
    try {
      const segmentSeconds = 30;
      const response = await fetch(`${MEDIA_SERVICE_URL}/audio/slices`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_job_id: audioSliceJobId, segment_seconds: segmentSeconds, duration_ms: voiceDuration }) });
      const responseText = await response.text();
      let data: { id?: string; slices?: AudioSlice[]; error?: string } = {};
      try { data = responseText ? JSON.parse(responseText) : {}; }
      catch { throw new Error(response.status === 413 || /payload too large/i.test(responseText) ? "完整配音文件过大，服务端无法处理" : `音频切片服务返回异常（HTTP ${response.status}）`); }
      if (!response.ok) throw new Error(data.error || "音频切片失败");
      const slices = Array.isArray(data.slices) ? data.slices : [];
      if (!slices.length) throw new Error("音频切片服务没有返回任何片段");
      setAudioSlices(slices);
      setAudioSliceJobId(String(data.id || ""));
      setSelectedSliceIds(slices.length ? [slices[0].id] : []);
      setAvatarSliceJobs([]);
      setVideoReady(false);
      setVideoUrl("");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "音频切片失败");
    } finally {
      setSlicingBusy(false);
    }
  }

  function toggleAudioSlice(id: string) {
    setSelectedSliceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function togglePackagingAsset(id: PackagingAssetId) {
    setPackagingAssetIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function generateAvatar() {
    if (!audioSlices.length || !selectedSliceIds.length) {
      setAvatarError("请先把完整配音切片，并至少选择一段音频");
      return;
    }
    setBusy(true);
    setAvatarError("");
    try {
      const chosen = audioSlices.filter((slice) => selectedSliceIds.includes(slice.id));
      const anchorInput = outputLayout === "landscape" ? selectedAnchor.greenScreenSubmit : selectedAnchor.renderInput;
      const submitted: AvatarSliceJob[] = [];
      for (const slice of chosen) {
        const form = new FormData();
        form.set("audio_url", slice.url);
        form.set("image_url", anchorInput);
        form.set("anchor_id", selectedAnchor.id);
        form.set("green_screen", outputLayout === "landscape" ? "true" : "false");
        form.set("layout", outputLayout);
        const response = await fetch("/api/avatar/jobs", { method: "POST", body: form });
        const responseText = await response.text();
        let data: { id?: string; status?: "queued" | "running"; progress?: number; error?: string; detail?: string } = {};
        try { data = responseText ? JSON.parse(responseText) : {}; }
        catch { throw new Error(response.status === 413 || /payload too large/i.test(responseText) ? `第 ${slice.index + 1} 段仍超过服务上限` : `数字人服务返回异常（HTTP ${response.status}）`); }
        if (!response.ok) throw new Error(data.error || data.detail || `第 ${slice.index + 1} 段提交失败`);
        if (!data.id) throw new Error(`第 ${slice.index + 1} 段没有返回任务编号`);
        submitted.push({ sliceId: slice.id, label: `${formatClock(slice.start)}–${formatClock(slice.end)}`, start: slice.start, end: slice.end, id: data.id, status: data.status || "queued", progress: Number(data.progress || 0) });
        setAvatarSliceJobs([...submitted]);
      }
      setAvatarJobId("");
      setAvatarStatus("queued");
      setAvatarProgress(0);
      setStep(4);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "数字人任务提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function startComposition() {
    const completedAvatarSegments = avatarSliceJobs.filter((job) => job.status === "completed" && job.videoUrl);
    if (!audioSliceJobId || !completedAvatarSegments.length || !selectedMedia.length) return;
    setCompositionError("");
    setCompositionUrl("");
    try {
      let start = 0;
      const scenes = selectedMedia.map((item) => {
        const duration = sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6);
        const scene = { url: item.url, type: item.type, start, duration, cue: sceneSettings[item.id]?.cue || "" };
        start += duration;
        return scene;
      });
      const response = await fetch(`${MEDIA_SERVICE_URL}/compositions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioJobId: audioSliceJobId, audioDuration: voiceDuration / 1000,
          avatarSegments: completedAvatarSegments.map((job) => ({ url: job.videoUrl, start: job.start, end: job.end })),
          projectName, scenes, layout: outputLayout,
          greenScreen: outputLayout === "landscape", chromaSimilarity, chromaBlend,
          anchorName: selectedAnchor.name, packagingAssets: packagingAssetIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "合片任务创建失败");
      setCompositionJobId(data.id);
      setCompositionStatus(data.status || "queued");
      setCompositionProgress(0);
    } catch (error) {
      setCompositionError(error instanceof Error ? error.message : "合片任务创建失败");
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brandMark">播</div>
        <div>
          <h1>新闻数字人工作台</h1>
          <p>从新闻链接到数字人口播视频</p>
        </div>
        <span className={`prototypeBadge connection ${connection}`} title={connectionNote}>
          {connection === "checking" ? "检测模型中" : connection === "ready" ? "模型已连接" : "模型连接失败"}
        </span>
      </header>

      <section className="shell">
        <nav className="steps" aria-label="制作步骤">
          {stepNames.map((name, index) => {
            const number = index + 1;
            const state = number < step ? "done" : number === step ? "active" : "";
            return (
              <button key={name} className={`step ${state}`} onClick={() => number <= step && setStep(number as Step)}>
                <span>{number < step ? "✓" : number}</span>
                <b>{name}</b>
              </button>
            );
          })}
        </nav>

        {step === 1 && (
          <section className="workspace">
            <div className="sectionHead">
              <div><span className="eyebrow">STEP 01</span><h2>输入新闻</h2><p>粘贴 1–10 条公开新闻链接，后台将读取正文并合并成口播稿。</p></div>
              <div className="counter"><b>{validCount}</b><span>/ 10 条可用</span></div>
            </div>
            <label className="fieldLabel" htmlFor="project-name">本期名称</label>
            <input id="project-name" className="titleInput" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            <div className="urlList">
              {urls.map((url, index) => (
                <label className="urlRow" key={index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <input value={url} onChange={(e) => updateUrl(index, e.target.value)} placeholder="https://example.com/news/article" aria-label={`新闻链接 ${index + 1}`} />
                  <i className={/^https?:\/\//i.test(url.trim()) ? "valid" : ""}>{url ? (/^https?:\/\//i.test(url.trim()) ? "可用" : "格式错误") : "待填写"}</i>
                </label>
              ))}
            </div>
            <label className="fieldLabel sourceLabel" htmlFor="writing-requirements">本期写稿要求 <span>选填 · 优先于固定 SOP</span></label>
            <textarea id="writing-requirements" className="sourceEditor requirementsEditor" value={writingRequirements} maxLength={2000} onChange={(e) => setWritingRequirements(e.target.value)} placeholder="填写本期稿件的特殊要求，例如：重点突出第一条新闻；整体控制在 4 分钟；第二条只作简讯；语气保持客观克制；结尾不要额外总结。系统会先执行本期要求，再阅读固定 SOP，最后依据新闻原文写稿。" />
            <div className="requirementsMeta"><span>执行顺序：本期人工要求 → 《點觀香港》SOP V4.1 → 新闻事实材料 → 生成母稿</span><b>{writingRequirements.length} / 2000</b></div>
            <div className="anchorSection scheduleAnchor">
              <div className="anchorSectionHead"><div><b>选择本期排班主播</b><span>写稿前锁定主播姓名、形象和粤语音色，开场将直接写入正确姓名。</span></div><em>写稿基础配置</em></div>
              <div className="anchorGrid" aria-label="本期排班主播选择">
                {Object.values(anchors).map((anchor) => (
                  <button key={anchor.id} className={`anchorCard ${anchorId === anchor.id ? "selected" : ""}`} onClick={() => setAnchorId(anchor.id)}>
                    <img src={anchor.portrait} alt={`${anchor.name}，${anchor.role}`} />
                    <span className="anchorCardBody"><span className="anchorCheck">{anchorId === anchor.id ? "✓" : ""}</span><b>{anchor.name}</b><small>{anchor.role}</small><i>{anchor.voiceName}</i></span>
                  </button>
                ))}
              </div>
            </div>
            {scriptError && <div className="errorNotice" role="alert">{scriptError}</div>}
            <div className="actionBar"><p>填写至少 1 条有效链接即可；本期要求将优先应用，同时提取正文、图片和视频候选素材。</p><button className="primary" disabled={!validCount || busy || connection !== "ready"} onClick={generateScript}>{busy ? "正在读取要求、SOP 与新闻…" : "按本期要求读取新闻并生成母稿"}</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="workspace">
            <div className="sectionHead"><div><span className="eyebrow">STEP 02</span><h2>修改并确认书面母稿</h2><p>{scriptModel ? `由 ${scriptModel} 按 V4.1 生成繁体中文母稿，请人工核对事实；确认后系统再转正式香港粤语。` : "请检查并修改书面母稿。"}</p></div><button className="secondary" onClick={() => setStep(1)}>返回新闻</button></div>
            <details className="sopCard">
              <summary><span className="sopStatus">写稿规范已启用</span><b>{scriptSop}</b><small>查看核心规则</small></summary>
              <div className="sopRules">
                <span>先写今日增量，再决定排序与篇幅</span><span>头条排序不等于篇幅排序</span><span>多条新闻只按真实关系串联</span><span>事实、数据及权威信息优先</span><span>固定开场、赞助、主播和结尾齐全</span><span>先确认繁体母稿，再转香港粤语</span>
              </div>
            </details>
            <div className="metricRow"><div><b>{charCount}</b><span>汉字</span></div><div><b>{minutes}</b><span>预计分钟</span></div><div><b>{validCount}</b><span>条新闻来源</span></div><div><b className={charCount >= 900 && charCount <= 1100 ? "good" : "warn"}>{charCount >= 900 && charCount <= 1100 ? "合适" : "需调整"}</b><span>稿件长度</span></div></div>
            <textarea className="scriptEditor" value={script} onChange={(e) => setScript(e.target.value)} aria-label="口播稿" />
            {newsArticles.length > 0 && (
              <section className="mediaLibrary" aria-label="新闻素材库预览">
                <div className="mediaLibraryHead">
                  <div><span className="eyebrow">MEDIA LIBRARY</span><h3>新闻素材库预览</h3><p>从原新闻页自动提取，并保留新闻与素材的来源关系。</p></div>
                  <div className="mediaCounts"><span><b>{imageCount}</b> 图片</span><span><b>{videoCount}</b> 视频</span><span><b>{selectedMediaIds.length}</b> 已选</span></div>
                </div>
                {newsArticles.map((article) => {
                  const articleMedia = newsMedia.filter((item) => item.articleId === article.id);
                  return (
                    <details className="mediaSource" key={article.id} open>
                      <summary><span>{String(article.index).padStart(2, "0")}</span><div><b>{article.title}</b><small>{article.source} · {articleMedia.length} 项素材</small></div><a href={article.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>查看原文 ↗</a></summary>
                      {articleMedia.length ? (
                        <div className="mediaGrid">
                          {articleMedia.map((item) => {
                            const sequence = selectedMediaIds.indexOf(item.id);
                            return (
                            <article className={`mediaCard ${sequence >= 0 ? "selected" : ""}`} key={item.id}>
                              <a className="mediaPreview" href={item.url} target="_blank" rel="noreferrer" title="打开原始素材">
                                {item.type === "image" || item.thumbnailUrl ? <img src={item.thumbnailUrl || item.url} alt={item.caption || article.title} loading="lazy" referrerPolicy="no-referrer" /> : <video src={item.url} controls preload="metadata" />}
                                <span className={`mediaType ${item.type}`}>{item.type === "video" ? "视频" : item.origin === "page-cover" ? "封面" : "图片"}</span>
                                {item.type === "video" && item.thumbnailUrl && <i className="videoBadge">▶</i>}
                                {sequence >= 0 && <strong className="sequenceBadge">{sequence + 1}</strong>}
                              </a>
                              <div className="mediaMeta"><div><b>{item.caption || (item.type === "video" ? "新闻视频" : "新闻图片")}</b><span>{item.source}</span></div><button onClick={() => toggleMedia(item.id)}>{sequence >= 0 ? "移除" : "加入分镜"}</button></div>
                            </article>
                          );})}
                        </div>
                      ) : <div className="mediaEmpty">该新闻已读取正文，但页面未发现可直接提取的图片或视频。</div>}
                    </details>
                  );
                })}
                <section className="storyboard" aria-label="分镜排序">
                  <div className="storyboardHead"><div><h4>分镜序列</h4><p>设置素材顺序、画面时长和对应的口播提示。</p></div><div className="storyboardSummary"><button className="autoArrange" onClick={autoArrangeStoryboard}>自动匹配稿件</button><span><b>{selectedMedia.length}</b> 镜头</span><span><b>{storyboardDuration}</b> 秒素材覆盖</span>{selectedMediaIds.length > 0 && <button onClick={() => setSelectedMediaIds([])}>清空</button>}</div></div>
                  {selectedMedia.length ? (
                    <ol className="storyboardList">
                      {selectedMedia.map((item, index) => {
                        const startAt = selectedMedia.slice(0, index).reduce((total, scene) => total + (sceneSettings[scene.id]?.duration ?? (scene.type === "video" ? 10 : 6)), 0);
                        const duration = sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6);
                        return (<li key={item.id}>
                          <span className="storyIndex"><b className="storyNumber">{String(index + 1).padStart(2, "0")}</b><small>{formatClock(startAt)}–{formatClock(startAt + duration)}</small></span>
                          <img src={item.thumbnailUrl || item.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          <div className="storyContent"><b>{item.caption || (item.type === "video" ? "新闻视频" : "新闻图片")}</b><small>{item.source} · {item.type === "video" ? "视频" : "图片"}</small><div className="storyFields"><label><span>时长</span><input type="number" min="2" max="60" step="1" value={sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6)} onChange={(event) => updateScene(item.id, { duration: Math.min(60, Math.max(2, Number(event.target.value) || 2)) })} /><i>秒</i></label><label className="cueField"><span>口播提示</span><input value={sceneSettings[item.id]?.cue || ""} onChange={(event) => updateScene(item.id, { cue: event.target.value.slice(0, 80) })} placeholder="例如：讲到独角兽大会时出现" /></label></div></div>
                          <div className="storyActions"><button disabled={index === 0} onClick={() => moveMedia(item.id, -1)} aria-label="向前移动">↑</button><button disabled={index === selectedMedia.length - 1} onClick={() => moveMedia(item.id, 1)} aria-label="向后移动">↓</button><button className="remove" onClick={() => toggleMedia(item.id)}>移除</button></div>
                        </li>);
                      })}
                    </ol>
                  ) : <div className="storyboardEmpty"><b>尚未选择素材</b><span>点击上方素材卡片中的“加入分镜”，即可开始编排画面顺序。</span></div>}
                </section>
                <section className="packagingLibrary" aria-label="固定包装素材库">
                  <div className="packagingHead"><div><span className="eyebrow">PACKAGE LIBRARY</span><h4>固定包装素材库</h4><p>这些是节目级固定资产，不参与新闻分镜排序；合片时由 FFmpeg 自动叠加。</p></div><span>{packagingAssetIds.length} 项启用</span></div>
                  <div className="packagingGrid">
                    <button className={packagingAssetIds.includes("background") ? "selected" : ""} onClick={() => togglePackagingAsset("background")}><img src="/studio-newsroom-bg-v1.png" alt="演播室背景" /><span><b>横屏演播室背景</b><small>循环动态推拉 · 主背景层</small></span><i>{packagingAssetIds.includes("background") ? "✓" : ""}</i></button>
                    <button className={packagingAssetIds.includes("logo") ? "selected" : ""} onClick={() => togglePackagingAsset("logo")}><span className="assetMock logoMock">點<br/>觀</span><span><b>节目 Logo</b><small>左上角常驻标识</small></span><i>{packagingAssetIds.includes("logo") ? "✓" : ""}</i></button>
                    <button className={packagingAssetIds.includes("nameplate") ? "selected" : ""} onClick={() => togglePackagingAsset("nameplate")}><span className="assetMock nameplateMock">主播｜{selectedAnchor.name}</span><span><b>主播人名条</b><small>自动绑定本期排班主播</small></span><i>{packagingAssetIds.includes("nameplate") ? "✓" : ""}</i></button>
                    <button disabled><span className="assetMock introMock">片头<br/><small>INTRO</small></span><span><b>标准节目片头</b><small>等待导入正式片头视频</small></span><em>待入库</em></button>
                  </div>
                </section>
                <div className="mediaDisclaimer">素材仅作为原新闻页的候选预览；正式合片前仍需核对内容对应关系、清晰度及使用授权。</div>
              </section>
            )}
            {voiceError && <div className="errorNotice" role="alert">{voiceError}</div>}
            <div className="notice"><span>i</span><p>确认后将锁定书面母稿，按本期主播姓名转成正式香港粤语，再调用固定音色生成配音。</p></div>
            <div className="actionBar"><p>排班主播：{selectedAnchor.name}，自动匹配“{selectedAnchor.voiceName}”；如需更换，请返回第一页重新写稿。</p><button className="primary" disabled={script.trim().length < 100 || busy || connection !== "ready"} onClick={generateVoice}>{busy ? "正在转写粤语并生成完整配音…" : `确认母稿并生成完整配音`}</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 03</span><h2>试听并确认配音</h2><p>配音已完成，请确认语速、停顿和专有名词发音。</p></div><span className="status success">配音已就绪</span></div>
            <div className="audioCard realAudio">
              {audioUrl ? <audio controls src={audioUrl} aria-label="完整粤语配音" /> : <p>尚未生成完整配音</p>}
            </div>
            <div className="voiceIdentity"><img src={selectedAnchor.portrait} alt={selectedAnchor.name} /><div><span>本期主播</span><b>{selectedAnchor.name}</b><small>{selectedAnchor.role} · {selectedAnchor.voiceName}</small></div></div>
            <div className="summaryCard"><div><span>音色绑定</span><b>{selectedAnchor.voiceName}</b></div><div><span>语言</span><b>粤语</b></div><div><span>模型</span><b>speech-2.8-hd</b></div><div><span>完整时长</span><b>{voiceDuration ? `${Math.floor(voiceDuration / 60000)}分${Math.round((voiceDuration % 60000) / 1000)}秒` : "—"}</b></div></div>
            <div className="notice"><span>i</span><p>这是整篇稿件的正式粤语配音。可按时间轴选择主播需要出镜的片段，再交给 HeyGen 生成；不会重新消耗配音额度。</p></div>
            <section className="audioSlicer">
              <div className="audioSlicerHead"><div><span className="eyebrow">AUDIO SLICES</span><h3>音频切片与主播出镜选择</h3><p>工作台按约 30 秒建立时间轴片段，便于选择主播出镜区间；HeyGen 本身不受原先 35 秒限制。</p></div><button className="secondary" disabled={slicingBusy || !audioUrl || !audioSliceJobId} onClick={sliceAudio}>{slicingBusy ? "FFmpeg 正在切片…" : !audioSliceJobId ? "请重新生成配音" : audioSlices.length ? "重新切片" : "开始自动切片"}</button></div>
              {audioSlices.length ? <div className="audioSliceGrid">{audioSlices.map((slice) => {
                const selected = selectedSliceIds.includes(slice.id);
                return <article key={slice.id} className={selected ? "selected" : ""}><label><input type="checkbox" checked={selected} onChange={() => toggleAudioSlice(slice.id)} /><span><b>片段 {String(slice.index + 1).padStart(2, "0")}</b><small>{formatClock(slice.start)}–{formatClock(slice.end)} · {slice.duration.toFixed(1)} 秒</small></span></label><audio controls preload="metadata" src={slice.url} /></article>;
              })}</div> : <div className="audioSliceEmpty">尚未切片。确认完整配音后，点击“开始自动切片”。</div>}
              {audioSlices.length > 0 && <div className="sliceSelectionBar"><span>已选择 <b>{selectedSliceIds.length}</b> / {audioSlices.length} 段</span><button onClick={() => setSelectedSliceIds(audioSlices.map((slice) => slice.id))}>全选</button><button onClick={() => setSelectedSliceIds([])}>清空</button></div>}
            </section>
            <section className="providerSection">
              <div className="providerHead"><b>数字人模型</b><span>使用当前主播图片与已确认粤语配音生成对口型视频。</span></div>
              <div className="providerGrid single"><div className="providerCard selected"><span className="providerCheck">✓</span><b>HeyGen Photo Avatar</b><small>官方 API · 单图＋粤语音频驱动</small><i>支持异步任务与长音频</i></div></div>
              <div className="layoutGrid" aria-label="成片画面模式">
                <button className={outputLayout === "landscape" ? "selected" : ""} onClick={() => setOutputLayout("landscape")}><b>横屏演播室</b><small>16:9 · 动态背景＋右侧主播＋左侧素材窗</small></button>
                <button className={outputLayout === "portrait" ? "selected" : ""} onClick={() => setOutputLayout("portrait")}><b>竖屏口播</b><small>9:16 · 数字人主轨＋全屏新闻素材</small></button>
              </div>
              {outputLayout === "landscape" && <section className="chromaCalibration"><div className="chromaPreview"><canvas ref={greenScreenPreviewRef} width="640" height="360" aria-label="绿幕抠像合成预览" /></div><div className="chromaControls"><div><b>绿幕校准</b><span>实时预览仅用于估算边缘；最终参数会传给 FFmpeg。</span></div><label><span>相似度 <b>{chromaSimilarity.toFixed(3)}</b></span><input type="range" min="0.05" max="0.35" step="0.005" value={chromaSimilarity} onChange={(event) => setChromaSimilarity(Number(event.target.value))} /><small>提高可去除更多绿色，过高会侵蚀人物。</small></label><label><span>边缘柔化 <b>{chromaBlend.toFixed(3)}</b></span><input type="range" min="0.01" max="0.2" step="0.005" value={chromaBlend} onChange={(event) => setChromaBlend(Number(event.target.value))} /><small>提高可让发丝边缘更柔和，过高会产生半透明。</small></label><button onClick={() => { setChromaSimilarity(0.14); setChromaBlend(0.055); }}>恢复推荐值</button></div></section>}
            </section>
            {avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}
            <div className="actionBar"><button className="secondary" onClick={() => { setVoiceReady(false); setStep(2); }}>返回更换主播或稿件</button><button className="primary" disabled={!voiceReady || !selectedSliceIds.length || busy || slicingBusy} onClick={generateAvatar}>{busy ? "正在逐段提交 HeyGen 任务…" : `生成已选 ${selectedSliceIds.length} 段数字人`}</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 04</span><h2>数字人分段对口型</h2><p>{selectedAnchor.name} 正在为已选的 {avatarSliceJobs.length} 段音频分别生成口型视频。</p></div><span className={`status ${avatarStatus === "completed" ? "success" : avatarStatus === "failed" ? "error" : "pending"}`}>{avatarStatus === "completed" ? "切片视频已完成" : avatarStatus === "failed" ? "部分或全部失败" : avatarStatus === "running" ? `渲染中 ${avatarProgress}%` : "任务排队中"}</span></div>
            {avatarSliceJobs.length > 0 && <section className="avatarSliceResults"><h3>数字人切片任务</h3><div>{avatarSliceJobs.map((job, index) => <article key={job.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{job.label}</b><small>{job.status === "completed" ? "生成完成" : job.status === "failed" ? (job.error || "生成失败") : `${job.status === "running" ? "渲染中" : "排队中"} ${job.progress}%`}</small></div>{job.videoUrl ? <a href={job.videoUrl} target="_blank" rel="noreferrer">预览视频</a> : <i>{job.progress}%</i>}</article>)}</div>{avatarSliceJobs.length > 1 && <p>多段视频将保留各自原始时间位置；下一阶段由合片时间轴把数字人片段与新闻素材拼接，不会误把未选区间连在一起。</p>}</section>}
            <div className="videoLayout">
              <div className="videoPlaceholder anchorPreview">{videoReady && videoUrl ? <video controls src={videoUrl} poster={selectedAnchor.portrait} /> : <img src={selectedAnchor.portrait} alt={`${selectedAnchor.name}竖版播报形象`} />}<div className="previewCaption"><b>{projectName}</b><span>{selectedAnchor.name} · {avatarSliceJobs.length > 1 ? "首段数字人预览" : videoReady ? "数字人口播视频" : "9:16 播报画面"}</span></div></div>
              <aside className="resultPanel"><div className="resultAnchor"><img src={selectedAnchor.turnaround} alt={`${selectedAnchor.name}三视图`} /><div><span>数字人资产</span><b>{selectedAnchor.name}</b><small>三视图与播报图已就绪</small></div></div><h3>对口型任务</h3><dl><div><dt>生成模型</dt><dd>HeyGen Photo Avatar</dd></div><div><dt>任务状态</dt><dd>{avatarStatus === "completed" ? "已完成" : avatarStatus === "failed" ? "失败" : avatarStatus === "running" ? `渲染中 ${avatarProgress}%` : "排队中"}</dd></div><div><dt>主播音色</dt><dd>{selectedAnchor.voiceName}</dd></div><div><dt>驱动音频</dt><dd>{voiceReady ? "已确认" : "未确认"}</dd></div><div><dt>画面比例</dt><dd>{outputLayout === "landscape" ? "16:9 · 横屏" : "9:16 · 竖屏"}</dd></div></dl>{avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}{videoReady && videoUrl ? <a className="primary full downloadLink" href={videoUrl} download>下载首段口播视频</a> : <button className="primary full" disabled>{avatarStatus === "running" ? `HeyGen 渲染中 ${avatarProgress}%` : "等待 HeyGen 输出"}</button>}<button className="secondary full" onClick={() => setStep(3)}>返回配音确认</button></aside>
            </div>
            <section className="compositionPanel">
              <div className="compositionHead"><div><span className="eyebrow">AUTO EDIT</span><h3>自动合片任务</h3><p>完整粤语配音作为主轨，按原始时间码插入数字人片段，再叠加新闻素材和固定包装。</p></div><span className={`status ${compositionStatus === "completed" ? "success" : compositionStatus === "failed" ? "error" : "pending"}`}>{compositionStatus === "idle" ? "尚未开始" : compositionStatus === "completed" ? "成片完成" : compositionStatus === "failed" ? "合片失败" : `${compositionStatus === "downloading" ? "下载素材" : compositionStatus === "rendering" ? "FFmpeg 合成" : "任务排队"} ${compositionProgress}%`}</span></div>
              <div className="compositionStats"><div><span>完整音频主轨</span><b>{audioSliceJobId ? "已就绪" : "等待切片"}</b></div><div><span>数字人出镜</span><b>{avatarSliceJobs.filter((job) => job.status === "completed" && job.videoUrl).length} 个片段</b></div><div><span>新闻分镜</span><b>{selectedMedia.length} 个镜头</b></div><div><span>输出规格</span><b>{outputLayout === "landscape" ? "1920 × 1080" : "720 × 1280"} MP4</b></div></div>
              {compositionError && <div className="errorNotice" role="alert">{compositionError}</div>}
              <div className="actionBar"><p>{!selectedMedia.length ? "请返回稿件页选择并编排素材。" : outputLayout === "landscape" ? "完整配音全程连续；数字人只在已选切片时间段出镜。" : "竖屏按时间轴叠加数字人和全屏新闻素材，完整配音连续。"}</p>{compositionUrl ? <a className="primary downloadLink" href={compositionUrl}>下载自动剪辑成片</a> : <button className="primary" disabled={!videoReady || !audioSliceJobId || !selectedMedia.length || ["queued", "downloading", "rendering"].includes(compositionStatus)} onClick={startComposition}>{["queued", "downloading", "rendering"].includes(compositionStatus) ? `正在合片 ${compositionProgress}%` : compositionStatus === "failed" ? "重新提交合片" : "开始自动合片"}</button>}</div>
            </section>
          </section>
        )}
      </section>
      <footer>自动化新闻数字人系统 · V1 交互原型</footer>
    </main>
  );
}
