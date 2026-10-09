"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { libraryRequest, useProjectArchive } from "./lib/use-project-archive";
import "./library/style.css";
import { DEFAULT_NEWS_SPEECH_SPEED } from "./lib/speech-rhythm";
import { createDraftSrt, srtDataUrlFromContent, type SubtitleStats } from "./lib/subtitle-srt";

type Step = 1 | 2 | 3 | 4;
type OutputLayout = "landscape" | "portrait";
type NewsArticle = { id: string; index: number; url: string; title: string; source: string; mediaCount: number };
type NewsMedia = { id: string; articleId: string; type: "image" | "video"; url: string; thumbnailUrl?: string;
  caption: string; source: string; sourceUrl: string; origin: "article" | "page-cover" | "video" | "upload" };
type SceneSetting = { duration: number; cue: string };
type AudioSlice = { id: string; index: number; start: number; end: number; duration: number; url: string };
type AvatarSliceJob = { sliceId: string; label: string; start: number; end: number; id: string; status: "queued" | "running" | "completed" | "failed"; progress: number; videoUrl?: string; error?: string };
type PackagingAssetId = "intro" | "background" | "logo" | "nameplate";

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
    greenScreenInput: "/anchors/hk-male-anchor-greenscreen-16x9-v2.png",
    greenScreenSubmit: "/anchors/hk-male-anchor-greenscreen-16x9-v2.png",
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
    greenScreenInput: "/anchors/hk-female-anchor-greenscreen-16x9-v2.png",
    greenScreenSubmit: "/anchors/hk-female-anchor-greenscreen-16x9-v2.png",
    turnaround: "/anchors/hk-female-anchor-turnaround.png",
  },
} as const;
const stepNames = ["输入新闻 / 稿件", "确认口播稿", "确认配音", "生成数字人"];
// Keep media traffic on the same public origin. The server-side proxy forwards it
// to the private media process, so a deployed browser never calls its own localhost.
const MEDIA_SERVICE_URL = "/api/media";
const LEGACY_AVATAR_MOTION_PROMPT = "Professional Hong Kong news anchor facing the camera. Calm, confident and composed expression. Use restrained, natural hand gestures at occasional emphasis points, with hands remaining mostly below chest level. Maintain steady posture, minimal head movement, direct eye contact, and accurate lip sync. No exaggerated gestures, no body turning, no camera movement.";
const DEFAULT_AVATAR_MOTION_PROMPT = "Professional Hong Kong television news anchor facing the camera. Calm, confident and composed expression. Keep both hands naturally visible in the lower frame. Use clear, controlled and varied hand gestures regularly while speaking, approximately one measured open-palm, counting or emphasis gesture every one to two sentences, then return the hands to a relaxed anchor position. Maintain steady upright posture, minimal head movement, direct eye contact and accurate lip sync. Blink infrequently and naturally with long intervals between blinks; avoid rapid, repeated or consecutive blinking. Keep facial movement subtle and professional. No exaggerated gestures, no body turning and no camera movement.";

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [urls, setUrls] = useState(initialUrls);
  const [linkSlots, setLinkSlots] = useState(3);
  const [activeSopLabel, setActiveSopLabel] = useState("正在读取规则…");
  useEffect(() => {
    const refresh = () => libraryRequest("/sops").then(data => setActiveSopLabel(data.active.version)).catch(() => setActiveSopLabel("规则服务待连接"));
    void refresh(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
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
  const [scriptSop, setScriptSop] = useState("《點觀香港》V4.7");
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsMedia, setNewsMedia] = useState<NewsMedia[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [sceneSettings, setSceneSettings] = useState<Record<string, SceneSetting>>({});
  const [outputLayout, setOutputLayout] = useState<OutputLayout>("landscape");
  const [chromaSimilarity, setChromaSimilarity] = useState(0.10);
  const [chromaBlend, setChromaBlend] = useState(0.05);
  const [avatarX, setAvatarX] = useState(930);
  const [avatarY, setAvatarY] = useState(50);
  const [avatarHeight, setAvatarHeight] = useState(1040);
  const [sceneX, setSceneX] = useState(80);
  const [sceneY, setSceneY] = useState(250);
  const [sceneWidth, setSceneWidth] = useState(820);
  const greenScreenPreviewRef = useRef<HTMLCanvasElement>(null);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [audioSlices, setAudioSlices] = useState<AudioSlice[]>([]);
  const [audioSliceJobId, setAudioSliceJobId] = useState("");
  const [selectedSliceIds, setSelectedSliceIds] = useState<string[]>([]);
  const [avatarMotionPrompt, setAvatarMotionPrompt] = useState(DEFAULT_AVATAR_MOTION_PROMPT);
  const [slicingBusy, setSlicingBusy] = useState(false);
  const [avatarSliceJobs, setAvatarSliceJobs] = useState<AvatarSliceJob[]>([]);
  const [packagingAssetIds, setPackagingAssetIds] = useState<PackagingAssetId[]>(["intro", "background", "logo", "nameplate"]);
  const [manuscript, setManuscript] = useState("");
  const [cantoneseScript, setCantoneseScript] = useState("");
  const [cantoneseSopVersion, setCantoneseSopVersion] = useState("");
  const [conversionMissingFacts, setConversionMissingFacts] = useState<string[]>([]);
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [sopSnapshot, setSopSnapshot] = useState<null | {id:string; version:string; text:string; name:string}>(null);
  const [mediaDownloads, setMediaDownloads] = useState<Record<string, {id:string; status:string; progress:number; error?:string}>>({});
  const [downloadError, setDownloadError] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [subtitleSrt, setSubtitleSrt] = useState("");
  const [subtitleStats, setSubtitleStats] = useState<SubtitleStats | null>(null);
  const [subtitleStatus, setSubtitleStatus] = useState<"idle" | "aligning" | "aligned" | "failed">("idle");
  const [subtitleError, setSubtitleError] = useState("");
  const cantoneseSrtUrl = useMemo(
    () => srtDataUrlFromContent(subtitleSrt || createDraftSrt(cantoneseScript, voiceDuration > 0 ? voiceDuration / 1000 : 0)),
    [cantoneseScript, subtitleSrt, voiceDuration],
  );
  const archive = useProjectArchive({step, urls, script, voiceReady, videoReady, avatarJobId, avatarStatus, avatarProgress, videoUrl, compositionJobId, compositionStatus, compositionProgress, compositionUrl, projectName, anchorId, writingRequirements, scriptModel, scriptSop, newsArticles, newsMedia, selectedMediaIds, sceneSettings, outputLayout, chromaSimilarity, chromaBlend, avatarX, avatarY, avatarHeight, sceneX, sceneY, sceneWidth, voiceDuration, audioSlices, audioSliceJobId, selectedSliceIds, avatarMotionPrompt, avatarSliceJobs, packagingAssetIds, manuscript, cantoneseScript, cantoneseSopVersion, conversionMissingFacts, conversionConfirmed, sopSnapshot, mediaDownloads, subtitleSrt, subtitleStats, subtitleStatus}, (saved) => {
    setStep(saved.step ?? step);
    setUrls(saved.urls ?? urls);
    setScript(saved.script ?? script);
    setVoiceReady(saved.voiceReady ?? voiceReady);
    setVideoReady(saved.videoReady ?? videoReady);
    setAvatarJobId(saved.avatarJobId ?? avatarJobId);
    setAvatarStatus(saved.avatarStatus ?? avatarStatus);
    setAvatarProgress(saved.avatarProgress ?? avatarProgress);
    setVideoUrl(saved.videoUrl ?? videoUrl);
    setCompositionJobId(saved.compositionJobId ?? compositionJobId);
    setCompositionStatus(saved.compositionStatus ?? compositionStatus);
    setCompositionProgress(saved.compositionProgress ?? compositionProgress);
    setCompositionUrl(saved.compositionUrl ?? compositionUrl);
    setProjectName(saved.projectName ?? projectName);
    setAnchorId(saved.anchorId ?? anchorId);
    setWritingRequirements(saved.writingRequirements ?? writingRequirements);
    setScriptModel(saved.scriptModel ?? scriptModel);
    setScriptSop(saved.scriptSop ?? scriptSop);
    setNewsArticles(saved.newsArticles ?? newsArticles);
    setNewsMedia(saved.newsMedia ?? newsMedia);
    setSelectedMediaIds(saved.selectedMediaIds ?? selectedMediaIds);
    setSceneSettings(saved.sceneSettings ?? sceneSettings);
    setOutputLayout(saved.outputLayout ?? outputLayout);
    setChromaSimilarity((saved.chromaSimilarity ?? chromaSimilarity) > 0.12 ? 0.10 : Math.max(0.06, saved.chromaSimilarity ?? chromaSimilarity));
    setChromaBlend(Math.max(0.03, Math.min(0.06, saved.chromaBlend ?? chromaBlend)));
    setAvatarX(saved.avatarX === 1280 ? 930 : (saved.avatarX ?? avatarX));
    setAvatarY(saved.avatarY === -40 ? 50 : (saved.avatarY ?? avatarY));
    setAvatarHeight(saved.avatarHeight === 1100 ? 1040 : (saved.avatarHeight ?? avatarHeight));
    setSceneX(saved.sceneX ?? sceneX);
    setSceneY(saved.sceneY ?? sceneY);
    setSceneWidth(saved.sceneWidth ?? sceneWidth);
    setVoiceDuration(saved.voiceDuration ?? voiceDuration);
    setAudioSlices(saved.audioSlices ?? audioSlices);
    setAudioSliceJobId(saved.audioSliceJobId ?? audioSliceJobId);
    setSelectedSliceIds(saved.selectedSliceIds ?? selectedSliceIds);
    setAvatarMotionPrompt(!saved.avatarMotionPrompt || saved.avatarMotionPrompt === LEGACY_AVATAR_MOTION_PROMPT
      ? DEFAULT_AVATAR_MOTION_PROMPT
      : saved.avatarMotionPrompt);
    setAvatarSliceJobs(saved.avatarSliceJobs ?? avatarSliceJobs);
    setPackagingAssetIds(saved.packagingAssetIds
      ? (saved.packagingAssetIds.includes("intro") ? saved.packagingAssetIds : ["intro", ...saved.packagingAssetIds])
      : packagingAssetIds);
    setManuscript(saved.manuscript ?? manuscript);
    setCantoneseScript(saved.cantoneseScript ?? "");
    setCantoneseSopVersion(saved.cantoneseSopVersion ?? "");
    setConversionMissingFacts(saved.conversionMissingFacts ?? []);
    setConversionConfirmed(saved.conversionConfirmed ?? false);
    setSopSnapshot(saved.sopSnapshot ?? sopSnapshot);
    setSubtitleSrt(saved.subtitleSrt ?? "");
    setSubtitleStats(saved.subtitleStats ?? null);
    setSubtitleStatus(saved.subtitleSrt ? "aligned" : (saved.subtitleStatus ?? "idle"));
    setMediaDownloads(saved.mediaDownloads ?? mediaDownloads);
    setAudioUrl(saved.audioSliceJobId ? `${MEDIA_SERVICE_URL}/audio/${saved.audioSliceJobId}/source.mp3` : "");
  });
  const [autoDownload, setAutoDownload] = useState(false);
  const [extractingMedia, setExtractingMedia] = useState(false);
  const downloadSubmitting = useRef(false);
  useEffect(() => {
    if (!autoDownload || downloadSubmitting.current) return;
    if (Object.values(mediaDownloads).some(job => ["queued", "downloading"].includes(job.status))) return;
    const next = newsMedia.find(item => !mediaDownloads[item.id]);
    if (!next) return;
    downloadSubmitting.current = true;
    void downloadMedia(next).finally(() => { downloadSubmitting.current = false; });
  }, [autoDownload, newsMedia, mediaDownloads]);
  async function extractAndDownloadMedia() {
    setExtractingMedia(true); setDownloadError(""); setAutoDownload(false);
    try {
      const response = await fetch("/api/news/extract", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({urls})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "素材提取失败");
      setNewsArticles(data.articles || []); setNewsMedia(data.media || []);
      setMediaDownloads({}); setSelectedMediaIds([]); setSceneSettings({}); setAutoDownload(true);
      if (!data.media?.length) setDownloadError("网页未发现可下载图片或视频，请检查来源是否使用独立播放器。");
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "素材提取失败"); }
    finally { setExtractingMedia(false); }
  }
  const downloading = Object.values(mediaDownloads).some(job => ["queued", "downloading"].includes(job.status));
  useEffect(() => {
    if (!downloading) return;
    let cancelled = false;
    const timer = setInterval(() => {
      libraryRequest("/downloads").then(data => {
        if (cancelled) return;
        setMediaDownloads(current => Object.fromEntries(Object.entries(current).map(([key,job]) => [key, data.jobs.find((entry: {id:string}) => entry.id === job.id) || job])));
      }).catch(error => { if (!cancelled) setDownloadError(error.message); });
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [downloading]);
  async function downloadMedia(item: NewsMedia) {
    setDownloadError("");
    try {
      const job = await libraryRequest("/downloads", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceUrl:item.url,type:item.type,caption:item.caption})});
      setMediaDownloads(current => ({...current,[item.id]:job}));
    } catch(error) {
      const message = error instanceof Error ? error.message : "下载失败";
      setDownloadError(message);
      setMediaDownloads(current => ({...current,[item.id]:{id:"",status:"failed",progress:0,error:message}}));
    }
  }
  async function uploadSupplementalMedia(file: File) {
    setUploadingMedia(true); setDownloadError("");
    try {
      const response=await fetch(`${MEDIA_SERVICE_URL}/library/uploads`,{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"补充素材上传失败");
      const articleId="manual-uploads";
      const mediaId=`upload-${data.id}`;
      setNewsArticles(current=>current.some(item=>item.id===articleId)?current:[...current,{id:articleId,index:current.length+1,url:"",title:"本地补充素材",source:"人工上传",mediaCount:1}]);
      setNewsMedia(current=>[...current,{id:mediaId,articleId,type:data.type,url:`${MEDIA_SERVICE_URL}/library/downloads/${data.id}/file`,caption:file.name,source:"人工上传",sourceUrl:"",origin:"upload"}]);
      setMediaDownloads(current=>({...current,[mediaId]:data}));
    } catch(error) { setDownloadError(error instanceof Error?error.message:"补充素材上传失败"); }
    finally { setUploadingMedia(false); }
  }
  const selectedAnchor = anchors[anchorId];
  const voiceId = selectedAnchor.voiceId;
  const validCount = urls.filter((url) => /^https?:\/\//i.test(url.trim())).length;
  const charCount = useMemo(() => (script.match(/[\u3400-\u9fff]/g) || []).length, [script]);
  const minutes = charCount ? (charCount / 250).toFixed(1) : "0.0";
  const imageCount = newsMedia.filter((item) => item.type === "image").length;
  const videoCount = newsMedia.filter((item) => item.type === "video").length;
  const selectedMedia = selectedMediaIds.map((id) => newsMedia.find((item) => item.id === id)).filter((item): item is NewsMedia => Boolean(item));
  const storyboardDuration = selectedMedia.reduce((total, item) => total + (sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6)), 0);
  const completedAvatarSliceIds = new Set(avatarSliceJobs.filter((job) => job.status === "completed" && job.videoUrl).map((job) => job.sliceId));
  const selectedSlices = audioSlices.filter((slice) => selectedSliceIds.includes(slice.id));
  const missingAvatarSlices = selectedSlices.filter((slice) => !completedAvatarSliceIds.has(slice.id));

  useEffect(() => {
    setVideoReady(selectedSliceIds.length > 0 && selectedSliceIds.every((id) => completedAvatarSliceIds.has(id)));
  }, [selectedSliceIds, avatarSliceJobs]);

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
    Promise.all([loadImage("/programme-loop-background-preview.jpg"), loadImage(selectedAnchor.greenScreenInput)]).then(([background, anchor]) => {
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
      const allSlicesComplete = selectedSliceIds.length > 0 && selectedSliceIds.every((sliceId) => completed.some((job) => job.sliceId === sliceId && job.videoUrl));
      if (allSlicesComplete) {
        setAvatarStatus("completed");
        const previewVideo = completed.find((job) => job.videoUrl)?.videoUrl || "";
        if (previewVideo) setVideoUrl(previewVideo);
        setVideoReady(true);
      } else if (failed.length && failed.length + completed.length === updates.length) setAvatarStatus("failed");
      else setAvatarStatus("running");
    };
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [avatarSliceJobs, selectedSliceIds]);

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
    setSceneSettings((current) => ({ ...current, [id]: { ...(current[id] || { duration: media?.type === "video" ? 10 : 6, cue: "" }), ...patch } }));
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
      setManuscript(data.content);
      setCantoneseScript("");
      setCantoneseSopVersion("");
      setConversionMissingFacts([]);
      setConversionConfirmed(false);
      setSopSnapshot(data.sopSnapshot || null);
      setMediaDownloads({}); setAutoDownload(true);
      setAudioUrl(""); setAudioSliceJobId(""); setAudioSlices([]); setSelectedSliceIds([]);
      setSubtitleSrt(""); setSubtitleStats(null); setSubtitleStatus("idle"); setSubtitleError("");
      setVoiceReady(false); setVideoReady(false); setVideoUrl(""); setAvatarSliceJobs([]);
      setCompositionUrl(""); setCompositionJobId(""); setCompositionStatus("idle");
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

  function beginWithManualScript() {
    const value = script.trim();
    if (value.length < 100) {
      setScriptError("请先粘贴完整新闻文稿（至少 100 字）。");
      return;
    }
    setScript(value);
    setManuscript(value);
    setScriptError("");
    setScriptModel("");
    setCantoneseScript("");
    setCantoneseSopVersion("");
    setConversionMissingFacts([]);
    setConversionConfirmed(false);
    setSopSnapshot(null);
    setAudioUrl(""); setAudioSliceJobId(""); setAudioSlices([]); setSelectedSliceIds([]);
    setVoiceReady(false); setVideoReady(false); setVideoUrl(""); setAvatarSliceJobs([]);
    setCompositionUrl(""); setCompositionJobId(""); setCompositionStatus("idle");
    // Manually supplied copy has no automatically extracted article-media map.
    // Keep already downloaded library assets available, but do not carry a
    // previous issue's source relationship into this new manuscript.
    setNewsArticles([]); setNewsMedia([]); setSelectedMediaIds([]); setSceneSettings({});
    setStep(2);
  }

  async function convertToCantonese() {
    setManuscript(script);
    setBusy(true);
    setVoiceError("");
    setAvatarError("");
    try {
      const conversionResponse = await fetch("/api/scripts/cantonese", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, anchorName: selectedAnchor.name }),
      });
      const responseText = await conversionResponse.text();
      if (conversionResponse.status === 401 || conversionResponse.status === 403) {
        throw new Error("线上登录已失效或无访问权限，请重新登录工作台；母稿仍保留，尚未开始配音。");
      }
      if (!responseText.trim()) {
        throw new Error(`粤语转写接口返回空响应（HTTP ${conversionResponse.status}），可能是服务中断或请求超时。母稿仍保留，尚未开始配音，请稍后重试。`);
      }
      let conversion;
      try { conversion = JSON.parse(responseText); }
      catch {
        throw new Error(`粤语转写接口未返回有效 JSON（HTTP ${conversionResponse.status}），请检查线上服务或网关。母稿仍保留，尚未开始配音。`);
      }
      if (!conversion || typeof conversion !== "object") throw new Error("粤语转写接口返回格式异常，母稿仍保留，尚未开始配音。");
      if (!conversionResponse.ok) throw new Error(conversion.error || "粵語口播轉寫失敗");
      if (typeof conversion.content !== "string" || !conversion.content.trim()) throw new Error("粤语转写未返回稿件正文，母稿仍保留，尚未开始配音。");
      const convertedScript = conversion.content as string;
      setCantoneseScript(convertedScript);
      setCantoneseSopVersion(conversion.conversionSop?.version || "");
      setConversionMissingFacts(Array.isArray(conversion.validation?.missingFacts) ? conversion.validation.missingFacts : []);
      setConversionConfirmed(Boolean(conversion.validation?.factsPreserved));
      setAudioUrl(""); setAudioSliceJobId(""); setAudioSlices([]); setSelectedSliceIds([]);
      setVoiceReady(false); setVideoReady(false); setVideoUrl(""); setAvatarSliceJobs([]);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "粤语口播转写失败");
    } finally {
      setBusy(false);
    }
  }

  async function alignSubtitles(audioJobId: string, durationMs: number) {
    setSubtitleStatus("aligning");
    setSubtitleError("");
    try {
      const response = await fetch(`${MEDIA_SERVICE_URL}/audio/subtitles`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_job_id: audioJobId, duration_ms: durationMs, script: cantoneseScript }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.srt !== "string" || !data.srt.trim()) throw new Error(data.error || "字幕对齐失败");
      setSubtitleSrt(data.srt);
      setSubtitleStats(data.stats as SubtitleStats);
      setSubtitleStatus("aligned");
      return data.srt as string;
    } catch (error) {
      setSubtitleSrt(""); setSubtitleStats(null); setSubtitleStatus("failed");
      setSubtitleError(error instanceof Error ? error.message : "字幕对齐失败");
      return "";
    }
  }

  async function generateVoice() {
    if (!conversionConfirmed || cantoneseScript.trim().length < 100) return;
    setBusy(true);
    setVoiceError("");
    setAvatarError("");
    try {
      const response = await fetch("/api/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cantoneseScript, voiceId, speed: DEFAULT_NEWS_SPEECH_SPEED }),
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
      setVideoReady(false); setVideoUrl(""); setAvatarJobId(""); setAvatarStatus("idle");
      setCompositionUrl(""); setCompositionJobId(""); setCompositionStatus("idle");
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return `${MEDIA_SERVICE_URL}/audio/${stored.id}/source.mp3`;
      });
      const generatedDuration = Number(response.headers.get("X-Audio-Duration-Ms") || 0);
      setVoiceDuration(generatedDuration);
      setAudioSlices([]);
      setAudioSliceJobId(stored.id);
      setSelectedSliceIds([]);
      setAvatarSliceJobs([]);
      setVoiceReady(true);
      setStep(3);
      await alignSubtitles(stored.id, generatedDuration);
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
      const segmentSeconds = 120;
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
      setSelectedSliceIds(slices.map((slice) => slice.id));
      setAvatarSliceJobs([]);
      setVideoReady(false);
      setVideoUrl("");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "音频切片失败");
    } finally {
      setSlicingBusy(false);
    }
  }

  function togglePackagingAsset(id: PackagingAssetId) {
    setPackagingAssetIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function generateAvatar() {
    if (!selectedSliceIds.length) {
      setAvatarError("请至少勾选一个需要数字人出镜的音频片段");
      return;
    }
    setBusy(true);
    setAvatarError("");
    try {
      const retained = avatarSliceJobs.filter((job) => job.status !== "failed" && selectedSliceIds.includes(job.sliceId));
      const chosen = selectedSlices.filter((slice) => !retained.some((job) => job.sliceId === slice.id));
      if (!chosen.length) {
        setStep(4);
        const complete = retained.length === selectedSliceIds.length && retained.every((job) => job.status === "completed" && job.videoUrl);
        setAvatarStatus(complete ? "completed" : "running");
        setVideoReady(complete);
        return;
      }
      // Enter the task screen before uploading so submission, provider polling
      // and the returned video all remain visible inside one workspace flow.
      setStep(4);
      setAvatarStatus("queued");
      setAvatarProgress(0);
      const anchorInput = outputLayout === "landscape" ? selectedAnchor.greenScreenSubmit : selectedAnchor.renderInput;
      const submitted: AvatarSliceJob[] = [...retained];
      for (const slice of chosen) {
        const [imageResponse, audioResponse] = await Promise.all([fetch(anchorInput), fetch(slice.url)]);
        if (!imageResponse.ok) throw new Error(`第 ${slice.index + 1} 段的主播图片读取失败`);
        if (!audioResponse.ok) throw new Error(`第 ${slice.index + 1} 段的音频读取失败`);
        const imageBlob = await imageResponse.blob();
        const imageBitmap = await createImageBitmap(imageBlob);
        const imageWidth = imageBitmap.width, imageHeight = imageBitmap.height;
        imageBitmap.close();
        if (outputLayout === "landscape" && imageWidth <= imageHeight) {
          throw new Error(`横屏任务检测到竖版主播素材（${imageWidth}×${imageHeight}），已停止提交，请刷新页面后重试`);
        }
        if (outputLayout === "portrait" && imageHeight <= imageWidth) {
          throw new Error(`竖屏任务检测到横版主播素材（${imageWidth}×${imageHeight}），已停止提交，请刷新页面后重试`);
        }
        const response = await fetch("/api/avatar/jobs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio_job_id: audioSliceJobId, slice_id: slice.id,
            anchor_id: selectedAnchor.id, layout: outputLayout, motion_prompt: avatarMotionPrompt,
            attempt: avatarSliceJobs.filter((job) => job.sliceId === slice.id).length }),
        });
        const responseText = await response.text();
        let data: { id?: string; status?: "queued" | "running"; progress?: number; error?: string; detail?: string } = {};
        try { data = responseText ? JSON.parse(responseText) : {}; }
        catch { throw new Error(response.status === 413 || /payload too large/i.test(responseText) ? `第 ${slice.index + 1} 段请求被服务拒绝（HTTP 413），请确认已刷新至新版工作台` : `数字人服务返回异常（HTTP ${response.status}）`); }
        if (!response.ok) throw new Error(data.error || data.detail || `第 ${slice.index + 1} 段提交失败`);
        if (!data.id) throw new Error(`第 ${slice.index + 1} 段没有返回任务编号`);
        submitted.push({ sliceId: slice.id, label: `${formatClock(slice.start)}–${formatClock(slice.end)}`, start: slice.start, end: slice.end, id: data.id, status: data.status || "queued", progress: Number(data.progress || 0) });
        setAvatarSliceJobs([...submitted].sort((a, b) => a.start - b.start));
        setAvatarProgress(Math.round(submitted.length / Math.max(1, selectedSliceIds.length) * 10));
      }
      setAvatarJobId("");
      setAvatarStatus("queued");
      setAvatarProgress(0);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "数字人任务提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function restoreCompletedAvatarJobs() {
    setBusy(true);
    setAvatarError("");
    try {
      if (!/^[a-f0-9]{32}$/.test(audioSliceJobId)) throw new Error("当前完整配音项目编号无效，无法安全恢复历史任务");
      const response = await fetch(`/api/avatar/jobs?anchor=${encodeURIComponent(selectedAnchor.name)}&project=${encodeURIComponent(audioSliceJobId)}`, { cache: "no-store" });
      const data = await response.json() as { jobs?: Array<{ id: string; title: string; status: "completed"; video_url: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || "读取 HeyGen 已完成任务失败");
      const restored: AvatarSliceJob[] = [];
      for (const job of data.jobs || []) {
        const match = job.title.match(/slice-(\d{3})/i);
        const slice = match ? audioSlices.find((item) => item.index === Number(match[1])) : undefined;
        if (!slice) continue;
        restored.push({ sliceId: slice.id, label: `${formatClock(slice.start)}–${formatClock(slice.end)}`, start: slice.start, end: slice.end,
          id: job.id, status: "completed", progress: 100, videoUrl: job.video_url });
      }
      if (!restored.length) throw new Error("没有找到与当前音频切片匹配的已完成 HeyGen 任务");
      const unique = [...new Map(restored.map((item) => [item.sliceId, item])).values()].sort((a, b) => a.start - b.start);
      setAvatarSliceJobs(unique);
      setVideoUrl(unique[0]?.videoUrl || "");
      const complete = selectedSliceIds.length > 0 && selectedSliceIds.every((sliceId) => unique.some((item) => item.sliceId === sliceId && item.videoUrl));
      setVideoReady(complete);
      setAvatarStatus(complete ? "completed" : "running");
      setAvatarProgress(complete ? 100 : Math.round(unique.length / Math.max(1, selectedSliceIds.length) * 100));
      setStep(4);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "恢复数字人任务失败");
    } finally {
      setBusy(false);
    }
  }


  async function startComposition() {
    const completedAvatarSegments = avatarSliceJobs.filter((job) => selectedSliceIds.includes(job.sliceId) && job.status === "completed" && job.videoUrl);
    if (!audioSliceJobId || !completedAvatarSegments.length) return;
    setCompositionError("");
    setCompositionUrl("");
    try {
      const missing = selectedSlices.filter((slice) => !completedAvatarSegments.some((job) => job.sliceId === slice.id));
      if (missing.length) throw new Error(`已勾选的数字人片段还缺少 ${missing.length} 段，请先生成完成。`);
      let start = 0;
      if (selectedMedia.some(item => mediaDownloads[item.id]?.status !== "completed")) {
        throw new Error("请先返回稿件页，将已选图片和视频全部下载入库；下载成功后再合片。");
      }
      const scenes = selectedMedia.map((item) => {
        const duration = sceneSettings[item.id]?.duration ?? (item.type === "video" ? 10 : 6);
        const downloaded = mediaDownloads[item.id];
        const scene = { url: downloaded?.status === "completed" ? `${MEDIA_SERVICE_URL}/library/downloads/${downloaded.id}/file` : item.url, type: item.type, start, duration, cue: sceneSettings[item.id]?.cue || "" };
        start += duration;
        return scene;
      });
      const response = await fetch(`${MEDIA_SERVICE_URL}/compositions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioJobId: audioSliceJobId, audioDuration: voiceDuration / 1000,
          avatarSegments: completedAvatarSegments.map((job) => ({ url: job.videoUrl, start: job.start, end: job.end })),
          projectName, scenes, layout: outputLayout,
          subtitlesSrt: subtitleSrt || createDraftSrt(cantoneseScript, voiceDuration / 1000),
          subtitleAlignment: subtitleSrt ? "audio-pauses" : "draft",
          greenScreen: outputLayout === "landscape", chromaSimilarity, chromaBlend,
          avatarX, avatarY, avatarHeight, sceneX, sceneY, sceneWidth,
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
        <div className="archiveBar"><span>{archive.status}</span><div><button disabled={!archive.ready} onClick={() => void archive.save()}>保存当前项目</button> <a href="/library" target="_blank" rel="noreferrer" onClick={() => void archive.save()}>历史项目 · 素材库 · SOP ↗</a></div></div>
        <nav className="steps" aria-label="制作步骤">
          {stepNames.map((name, index) => {
            const number = index + 1;
            const state = number < step ? "done" : number === step ? "active" : "";
            return (
              <button key={name} className={`step ${state}`} disabled={number > step || busy || slicingBusy} aria-current={number === step ? "step" : undefined} onClick={() => number <= step && setStep(number as Step)}>
                <span>{number < step ? "✓" : number}</span>
                <b>{name}</b>
              </button>
            );
          })}
        </nav>

        {step === 1 && (
          <section className="workspace">
            <div className="sectionHead">
              <div><span className="eyebrow">01 / CONTENT BRIEF</span><h2>开始本期新闻制作</h2><p>可以用新闻链接自动写稿，也可直接粘贴已有文稿。</p></div>
              <div className="counter"><b>{validCount}</b><span>/ 10 条可用</span></div>
            </div>
            <label className="fieldLabel" htmlFor="project-name">本期名称</label>
            <input id="project-name" className="titleInput" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            <div className="urlList">
              {urls.slice(0, Math.max(linkSlots, urls.reduce((last, url, i) => url.trim() ? i + 1 : last, 0))).map((url, index) => (
                <label className="urlRow" key={index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <input value={url} onChange={(e) => updateUrl(index, e.target.value)} placeholder="https://example.com/news/article" aria-label={`新闻链接 ${index + 1}`} />
                  <i className={/^https?:\/\//i.test(url.trim()) ? "valid" : ""}>{url ? (/^https?:\/\//i.test(url.trim()) ? "可用" : "格式错误") : "待填写"}</i>
                </label>
              ))}
            </div>
            <div className="linkTools"><span>链接模式：至少 1 条，最多 10 条。不填链接也可使用下方的“直接粘贴文稿”。</span><button className="secondary" disabled={Math.max(linkSlots, urls.reduce((last,url,i) => url.trim() ? i+1 : last,0)) >= 10} onClick={() => setLinkSlots(Math.min(10, Math.max(linkSlots,urls.reduce((last,url,i) => url.trim() ? i+1 : last,0))+1))}>＋ 添加新闻链接</button></div>
            <div className="linkTools"><button className="secondary" disabled={!validCount || busy || extractingMedia || downloading} onClick={() => void extractAndDownloadMedia()}>{extractingMedia ? "正在提取素材…" : "先提取并自动下载图片 / 视频"}</button><span>已发现 {newsMedia.length} 项 · 已保存 {Object.values(mediaDownloads).filter(job => job.status === "completed").length} 项 · 失败 {Object.values(mediaDownloads).filter(job => job.status === "failed").length} 项{downloading ? " · 正在下载" : ""}</span></div>
            {downloadError && <p role="alert">{downloadError}</p>}
            {newsMedia.length > 0 && <details><summary>查看下载素材</summary>{newsMedia.map(item => <p key={item.id}>{item.type === "video" ? "视频" : "图片"} · {item.caption} · {mediaDownloads[item.id]?.status === "completed" ? <a href={`/api/library/downloads/${mediaDownloads[item.id].id}/file`} target="_blank" rel="noreferrer">打开本地素材</a> : mediaDownloads[item.id]?.status === "failed" ? <><span>{mediaDownloads[item.id].error}</span> <button onClick={() => void downloadMedia(item)}>重试</button></> : "等待或下载中"}</p>)}</details>}
            <label className="fieldLabel sourceLabel" htmlFor="writing-requirements">本期写稿要求 <span>选填 · 优先于固定 SOP</span></label>
            <textarea id="writing-requirements" className="sourceEditor requirementsEditor" value={writingRequirements} maxLength={2000} onChange={(e) => setWritingRequirements(e.target.value)} placeholder="填写本期稿件的特殊要求，例如：重点突出第一条新闻；整体控制在 4 分钟；第二条只作简讯；语气保持客观克制；结尾不要额外总结。系统会先执行本期要求，再阅读固定 SOP，最后依据新闻原文写稿。" />
            <div className="requirementsMeta"><span>执行顺序：本期要求 → 当前 SOP（{activeSopLabel}）→ 新闻事实 → 母稿</span><b>{writingRequirements.length} / 2000</b></div>
            <div className="anchorSection scheduleAnchor">
              <div className="anchorSectionHead"><div><b>选择本期排班主播</b><span>写稿前锁定主播姓名、形象和粤语音色，开场将直接写入正确姓名。</span></div><em>写稿基础配置</em></div>
              <div className="anchorGrid" aria-label="本期排班主播选择">
                {Object.values(anchors).map((anchor) => (
                  <button key={anchor.id} disabled={busy} aria-pressed={anchorId === anchor.id} className={`anchorCard ${anchorId === anchor.id ? "selected" : ""}`} onClick={() => setAnchorId(anchor.id)}>
                    <img src={anchor.portrait} alt={`${anchor.name}，${anchor.role}`} />
                    <span className="anchorCardBody"><span className="anchorCheck">{anchorId === anchor.id ? "✓" : ""}</span><b>{anchor.name}</b><small>{anchor.role}</small><i>{anchor.voiceName}</i></span>
                  </button>
                ))}
              </div>
            </div>
            <section className="manualScriptEntry" aria-labelledby="manual-script-title">
              <div><span className="eyebrow">DIRECT SCRIPT</span><h3 id="manual-script-title">直接粘贴新闻文稿</h3><p>适合已经写好的繁体书面母稿。不需要填新闻链接，选好主播后可直接进入稿件确认和粤语转换。</p></div>
              <textarea className="sourceEditor manualScriptEditor" value={script} onChange={(event)=>{setScript(event.target.value);setScriptError("");}} placeholder="在这里粘贴完整新闻文稿……" aria-label="直接粘贴新闻文稿" />
              <div className="manualScriptActions"><span>{script.trim().length} 字符 · 本期主播 {selectedAnchor.name}</span><button className="primary" disabled={script.trim().length < 100 || busy} onClick={beginWithManualScript}>使用这份文稿继续 →</button></div>
            </section>
            {scriptError && <div className="errorNotice" role="alert">{scriptError}</div>}
            <div className="actionBar"><p>{!validCount ? "如需系统自动写稿，请添加至少 1 条新闻链接。" : `已添加 ${validCount} 条来源 · 本期主播 ${selectedAnchor.name}`}</p><button className="primary" disabled={!validCount || busy || connection !== "ready"} onClick={generateScript}>{busy ? "正在读取要求、SOP 与新闻…" : "根据链接生成本期母稿 →"}</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="workspace">
            <div className="sectionHead"><div><span className="eyebrow">STEP 02</span><h2>修改并确认书面母稿</h2><p>{scriptModel ? `由 ${scriptModel} 按 ${scriptSop} 生成母稿；核对事实后再转香港粤语。` : "请检查并修改书面母稿。"}</p></div><button className="secondary" disabled={busy} onClick={() => setStep(1)}>返回新闻</button></div>
            <details className="sopCard">
              <summary><span className="sopStatus">写稿规范已启用</span><b>{scriptSop}</b><small>查看核心规则</small></summary>
              <div className="sopRules">
                <span>先写今日增量，再决定排序与篇幅</span><span>消息不能升级为官方结论</span><span>阶段数据与最终数据分清</span><span>多条新闻只按真实关系串联</span><span>观点由行动、数据和结果支撑</span><span>交稿前执行20项自检</span><span>固定开场、赞助、主播和结尾齐全</span><span>先确认繁体母稿，再转香港粤语</span>
              </div>
            </details>
            <div className="metricRow"><div><b>{charCount}</b><span>汉字</span></div><div><b>{minutes}</b><span>预计分钟</span></div><div><b>{validCount}</b><span>条新闻来源</span></div><div><b className={charCount >= 900 && charCount <= 1100 ? "good" : "warn"}>{charCount >= 900 && charCount <= 1100 ? "合适" : "需调整"}</b><span>稿件长度</span></div></div>
            <textarea className="scriptEditor" value={script} onChange={(e) => { setScript(e.target.value); if (!voiceReady) setManuscript(e.target.value); }} aria-label="口播稿" />
            {voiceReady && <p className="libraryHint">已有配音属于上一次确认的稿件。若修改了当前正文，请重新生成配音再继续；历史版本保留原成果。</p>}
            <section className="supplementUpload"><div><span className="eyebrow">SUPPLEMENTAL MEDIA</span><h3>上传补充素材</h3><p>网页抓取不够时，可把本地图片或视频补进本期素材库，加入自动分镜；成片后也可下载本地剪辑包继续精修。</p></div><label className={uploadingMedia?"disabled":""}><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" disabled={uploadingMedia} onChange={(event)=>{const file=event.target.files?.[0];if(file)void uploadSupplementalMedia(file);event.currentTarget.value="";}}/><span>{uploadingMedia?"正在上传…":"选择图片或视频"}</span></label></section>
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
                      <summary><span>{String(article.index).padStart(2, "0")}</span><div><b>{article.title}</b><small>{article.source} · {articleMedia.length} 项素材</small></div>{article.url&&<a href={article.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>查看原文 ↗</a>}</summary>
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
                              <div className="mediaDownloadStatus">{mediaDownloads[item.id]?.status === "completed" ? <a href={`/api/library/downloads/${mediaDownloads[item.id].id}/file`} target="_blank" rel="noreferrer">已入库 · 打开素材</a> : <button disabled={["queued","downloading"].includes(mediaDownloads[item.id]?.status)} onClick={() => void downloadMedia(item)}>{["queued","downloading"].includes(mediaDownloads[item.id]?.status) ? `下载中 ${mediaDownloads[item.id].progress}%` : mediaDownloads[item.id]?.status === "failed" ? "重试下载" : "下载入库"}</button>}{mediaDownloads[item.id]?.error && <small>{mediaDownloads[item.id].error}</small>}</div>
                            </article>
                          );})}
                        </div>
                      ) : <div className="mediaEmpty">该新闻已读取正文，但页面未发现可直接提取的图片或视频。</div>}
                    </details>
                  );
                })}
                <section className="storyboard" aria-label="分镜排序">
                  {downloadError && <p role="alert">{downloadError}</p>}
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
                    <button className={packagingAssetIds.includes("intro") ? "selected" : ""} onClick={() => togglePackagingAsset("intro")}><video src="/programme-intro.mp4" muted playsInline preload="metadata" /><span><b>《點觀香港》节目片头</b><small>7 秒片头 · 保留原声</small></span><i>{packagingAssetIds.includes("intro") ? "✓" : ""}</i></button>
                    <button className={packagingAssetIds.includes("background") ? "selected" : ""} onClick={() => togglePackagingAsset("background")}><img src="/programme-loop-background-preview.jpg" alt="数字主播循环背景" /><span><b>数字主播循环背景</b><small>8 秒素材 · 自动循环至正文结束</small></span><i>{packagingAssetIds.includes("background") ? "✓" : ""}</i></button>
                    <button className={packagingAssetIds.includes("logo") ? "selected" : ""} onClick={() => togglePackagingAsset("logo")}><img src="/programme-logo.png" alt="點觀香港节目 Logo" /><span><b>节目 Logo</b><small>透明图 · 左上角常驻标识</small></span><i>{packagingAssetIds.includes("logo") ? "✓" : ""}</i></button>
                    <button className={packagingAssetIds.includes("nameplate") ? "selected" : ""} onClick={() => togglePackagingAsset("nameplate")}><img src={`/nameplates/${selectedAnchor.id}.png`} alt={`${selectedAnchor.name}主播人名条`} /><span><b>主播人名条</b><small>自动绑定本期排班主播</small></span><i>{packagingAssetIds.includes("nameplate") ? "✓" : ""}</i></button>
                    <button disabled><span className="assetMock introMock">片头<br/><small>INTRO</small></span><span><b>标准节目片头</b><small>等待导入正式片头视频</small></span><em>待入库</em></button>
                  </div>
                </section>
                <div className="mediaDisclaimer">素材仅作为原新闻页的候选预览；正式合片前仍需核对内容对应关系、清晰度及使用授权。</div>
              </section>
            )}
            {voiceError && <div className="errorNotice" role="alert">{voiceError}</div>}
            <div className="notice"><span>i</span><p>先执行《點觀香港》粤语配音转化 SOP V1.1，生成可人工修改的粤语配音稿；确认日期、数字、专名和断句后，才会调用 MiniMax 生成正式配音。</p></div>
            {cantoneseScript && <section className="cantoneseReview"><div><h3>粤语配音稿确认</h3><p>请直接修改下方文本。事实检查只作提示，不再丢弃模型已经生成的粤语稿。</p></div>{conversionMissingFacts.length > 0 ? <div className="errorNotice"><b>需要人工核对母稿中的内容：</b> {conversionMissingFacts.join("、")}。如果只是“21日／21號”等书写差异，可核对后继续；如确实遗漏，请在下方补回。</div> : <div className="reviewPassed">数字、日期、金额和英文缩写自动对照未发现遗漏。</div>}<textarea value={cantoneseScript} onChange={(event) => { setCantoneseScript(event.target.value); setConversionConfirmed(false); }} aria-label="可编辑粤语配音稿" /><label className="manualConfirm"><input type="checkbox" checked={conversionConfirmed} onChange={(event) => setConversionConfirmed(event.target.checked)} /><span>我已对照母稿核对日期、数字、专名及事实，可以生成正式配音</span></label></section>}
            <div className="actionBar"><p>排班主播：{selectedAnchor.name}，自动匹配“{selectedAnchor.voiceName}”。</p>{!cantoneseScript ? <button className="primary" disabled={script.trim().length < 100 || busy || connection !== "ready"} onClick={convertToCantonese}>{busy ? "正在生成粤语配音稿…" : "确认母稿并生成粤语配音稿"}</button> : <><button className="secondary" disabled={busy} onClick={convertToCantonese}>重新转换</button><button className="primary" disabled={busy || !conversionConfirmed || cantoneseScript.trim().length < 100} onClick={generateVoice}>{busy ? "正在生成完整配音…" : "确认粤语稿并生成完整配音"}</button></>}</div>
          </section>
        )}

        {step === 3 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 03</span><h2>试听并确认配音</h2><p>请按转换 SOP 试听数字、日期、人名、地名、英文与多音字；未确认的读音需人工核实，发现错音请记录原文、正确读法及试听结果。</p></div><span className="status success">配音已就绪</span></div>
            <div className="audioCard realAudio">
              {audioUrl ? <audio controls src={audioUrl} aria-label="完整粤语配音" /> : <p>尚未生成完整配音</p>}
            </div>
            {cantoneseScript && <details className="cantoneseTranscript" open><summary>粤语字幕与最终音频校验</summary><p>{cantoneseSopVersion ? `本次转化使用 SOP ${cantoneseSopVersion}。` : ""}字幕文字固定使用已确认的粤语配音稿；系统读取最终 MP3 的真实停顿，将字幕边界对齐到音频，不再用文字长度平均分配。</p><div className={`subtitleAudit ${subtitleStatus}`}><div><span>{subtitleStatus === "aligned" ? "✓" : subtitleStatus === "aligning" ? "…" : "!"}</span><div><b>{subtitleStatus === "aligned" ? "音频时码已对齐" : subtitleStatus === "aligning" ? "正在分析最终音频" : "字幕仍需对齐"}</b><small>{subtitleStats ? `${subtitleStats.cueCount} 条字幕 · 识别 ${subtitleStats.pauseCount || 0} 个停顿 · ${subtitleStats.snappedCueCount || 0} 个断句已吸附到真实停顿` : subtitleError || "合片前必须完成字幕校验"}</small></div></div><button className="secondary" disabled={subtitleStatus === "aligning" || !audioSliceJobId} onClick={() => void alignSubtitles(audioSliceJobId, voiceDuration)}>{subtitleStatus === "aligning" ? "正在对齐…" : "重新校验时码"}</button></div><textarea value={cantoneseScript} readOnly aria-label="粤语口播文本" /><div className="subtitleActions"><a className="secondary downloadLink" download={`${projectName || "點觀香港"}_粵語字幕_音频对齐.srt`} href={cantoneseSrtUrl}>下载音频对齐 SRT</a><small>每行最多 16 个汉字、最多两行；优先在句号、问号、感叹号及逗号处断句，并避免单字孤行。</small></div></details>}
            <div className="voiceIdentity"><img src={selectedAnchor.portrait} alt={selectedAnchor.name} /><div><span>本期主播</span><b>{selectedAnchor.name}</b><small>{selectedAnchor.role} · {selectedAnchor.voiceName}</small></div></div>
            <div className="summaryCard"><div><span>音色绑定</span><b>{selectedAnchor.voiceName}</b></div><div><span>语言</span><b>粤语</b></div><div><span>模型</span><b>2.8 → 2.6 → 02 自动备用</b></div><div><span>完整时长</span><b>{voiceDuration ? `${Math.floor(voiceDuration / 60000)}分${Math.round((voiceDuration % 60000) / 1000)}秒` : "—"}</b></div></div>
            <div className="notice"><span>i</span><p>这是整篇稿件的正式粤语配音，也是最终成片唯一的音频主轨。切片只用于驱动 HeyGen 生成连续的数字人画面，切片音频不会重复混入成片。</p></div>
            <section className="audioSlicer">
              <div className="audioSlicerHead"><div><span className="eyebrow">AVATAR SLICE TRACK</span><h3>数字人切片轨道</h3><p>工作台按每段 2 分钟切分完整配音，最后不足 2 分钟的部分单独成段；只有勾选的片段会提交 HeyGen，未勾选时段仍保留完整配音并使用背景或新闻素材。</p></div><button className="secondary" disabled={slicingBusy || !audioUrl || !audioSliceJobId} onClick={sliceAudio}>{slicingBusy ? "FFmpeg 正在切片…" : !audioSliceJobId ? "请重新生成配音" : audioSlices.length ? "重新切片" : "开始自动切片"}</button></div>
              {audioSlices.length ? <div className="audioSliceGrid">{audioSlices.map((slice) => {
                const completed = completedAvatarSliceIds.has(slice.id);
                const selected = selectedSliceIds.includes(slice.id);
                return <article key={slice.id} className={selected ? "selected" : ""}><label><input type="checkbox" checked={selected} onChange={() => setSelectedSliceIds(current => current.includes(slice.id) ? current.filter(id => id !== slice.id) : [...current, slice.id])} /><span><b>片段 {String(slice.index + 1).padStart(2, "0")}</b><small>{formatClock(slice.start)}–{formatClock(slice.end)} · {slice.duration.toFixed(1)} 秒 · {completed ? "数字人已完成" : selected ? "将提交 HeyGen" : "不生成数字人"}</small></span></label><audio controls preload="metadata" src={slice.url} /></article>;
              })}</div> : <div className="audioSliceEmpty">尚未切片。确认完整配音后，点击“开始自动切片”。</div>}
              {audioSlices.length > 0 && <div className="sliceSelectionBar"><span>已选择 <b>{selectedSliceIds.length}</b> / {audioSlices.length} 段 · 已完成 {selectedSliceIds.filter(id => completedAvatarSliceIds.has(id)).length} 段</span><span>完整配音始终保留在主音轨</span><button onClick={() => setSelectedSliceIds(audioSlices.map(slice => slice.id))}>全选</button><button onClick={() => setSelectedSliceIds([])}>清空</button></div>}
            </section>
            <section className="providerSection">
              <div className="providerHead"><b>数字人模型</b><span>使用当前主播图片与已确认粤语配音生成对口型视频。</span></div>
              <div className="providerGrid single"><div className="providerCard selected"><span className="providerCheck">✓</span><b>HeyGen Photo Avatar</b><small>官方 API · 单图＋粤语音频驱动</small><i>支持异步任务与长音频</i></div></div>
              <div className="layoutGrid" aria-label="成片画面模式">
                <button className={outputLayout === "landscape" ? "selected" : ""} onClick={() => setOutputLayout("landscape")}><b>横屏演播室</b><small>16:9 · 动态背景＋右侧主播＋左侧素材窗</small></button>
                <button className={outputLayout === "portrait" ? "selected" : ""} onClick={() => setOutputLayout("portrait")}><b>竖屏口播</b><small>9:16 · 数字人主轨＋全屏新闻素材</small></button>
              </div>
              <label className="motionPrompt"><span><b>主播动作提示词</b><small>由 HeyGen Avatar IV 解释；建议使用克制、自然的新闻播报动作。</small></span><textarea value={avatarMotionPrompt} maxLength={800} onChange={(event) => setAvatarMotionPrompt(event.target.value)} /><button type="button" onClick={() => setAvatarMotionPrompt(DEFAULT_AVATAR_MOTION_PROMPT)}>恢复新闻主播推荐值</button></label>
              {outputLayout === "landscape" && <section className="chromaCalibration"><div className="chromaPreview"><canvas ref={greenScreenPreviewRef} width="640" height="360" aria-label="绿幕抠像合成预览" /></div><div className="chromaControls"><div><b>绿幕校准</b><span>实时预览仅用于估算边缘；最终参数会传给 FFmpeg。系统会限制在安全范围内，保护头发、面部和肩部轮廓。</span></div><label><span>相似度 <b>{chromaSimilarity.toFixed(3)}</b></span><input type="range" min="0.06" max="0.12" step="0.005" value={chromaSimilarity} onChange={(event) => setChromaSimilarity(Number(event.target.value))} /><small>建议保持 0.08–0.10；过高会侵蚀人物边缘。</small></label><label><span>边缘柔化 <b>{chromaBlend.toFixed(3)}</b></span><input type="range" min="0.03" max="0.06" step="0.005" value={chromaBlend} onChange={(event) => setChromaBlend(Number(event.target.value))} /><small>建议使用 0.05，使发丝和肩部边缘自然过渡。</small></label><button onClick={() => { setChromaSimilarity(0.10); setChromaBlend(0.05); }}>恢复推荐值</button></div></section>}
            </section>
            {avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}
            <div className="actionBar"><button className="secondary" onClick={() => { setVoiceReady(false); setStep(2); }}>返回更换主播或稿件</button><button className="secondary" disabled={!audioSlices.length || busy} onClick={restoreCompletedAvatarJobs}>{busy ? "正在读取…" : "恢复 HeyGen 历史任务"}</button><button className="primary" disabled={!voiceReady || !selectedSliceIds.length || busy || slicingBusy || missingAvatarSlices.length === 0} onClick={generateAvatar}>{busy ? "正在提交，已进入任务页…" : !selectedSliceIds.length ? "请先勾选数字人片段" : missingAvatarSlices.length ? `提交 ${missingAvatarSlices.length} 段并自动拉回` : "所选数字人片段已完成"}</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 04</span><h2>提交并拉回数字人</h2><p>工作台直接提交 HeyGen，自动查询进度并把完成视频拉回当前项目；关闭页面后再次打开也会继续恢复任务。</p></div><span className={`status ${avatarStatus === "completed" ? "success" : avatarStatus === "failed" ? "error" : "pending"}`}>{avatarStatus === "completed" ? "视频已拉回" : avatarStatus === "failed" ? "部分或全部失败" : avatarStatus === "running" ? `HeyGen 渲染中 ${avatarProgress}%` : "正在提交 / 排队"}</span></div>
            {avatarSliceJobs.length > 0 && <section className="avatarSliceResults"><h3>数字人任务与回传</h3><div>{avatarSliceJobs.map((job, index) => <article key={job.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{job.label}</b><small>{job.status === "completed" ? "已从 HeyGen 拉回并保存本地" : job.status === "failed" ? (job.error || "生成失败") : `${job.status === "running" ? "HeyGen 渲染中" : "已提交，等待渲染"} ${job.progress}%`}</small></div>{job.videoUrl ? <a href={job.videoUrl} target="_blank" rel="noreferrer">播放本地视频</a> : <i>{job.progress}%</i>}</article>)}</div>{avatarSliceJobs.length > 1 && <p>多段数字人视频按原始时间位置连续排列；合片只使用完整配音主轨，不会叠加切片视频中的音频。</p>}</section>}
            <div className="videoLayout">
              <div className={`videoPlaceholder anchorPreview ${outputLayout}`}>{videoReady && videoUrl ? <video controls src={videoUrl} poster={outputLayout === "landscape" ? selectedAnchor.greenScreenSubmit : selectedAnchor.portrait} /> : <img src={outputLayout === "landscape" ? selectedAnchor.greenScreenSubmit : selectedAnchor.portrait} alt={`${selectedAnchor.name}${outputLayout === "landscape" ? "16:9 横版绿幕" : "9:16 竖版"}播报形象`} />}<div className="previewCaption"><b>{projectName}</b><span>{selectedAnchor.name} · {avatarSliceJobs.length > 1 ? "首段数字人预览" : videoReady ? "数字人口播视频" : outputLayout === "landscape" ? "16:9 横版绿幕画面" : "9:16 竖版播报画面"}</span></div></div>
              <aside className="resultPanel"><div className="resultAnchor"><img src={selectedAnchor.turnaround} alt={`${selectedAnchor.name}三视图`} /><div><span>数字人资产</span><b>{selectedAnchor.name}</b><small>三视图与播报图已就绪</small></div></div><h3>对口型任务</h3><dl><div><dt>生成模型</dt><dd>HeyGen Photo Avatar</dd></div><div><dt>任务状态</dt><dd>{avatarStatus === "completed" ? "已完成" : avatarStatus === "failed" ? "失败" : avatarStatus === "running" ? `渲染中 ${avatarProgress}%` : "排队中"}</dd></div><div><dt>主播音色</dt><dd>{selectedAnchor.voiceName}</dd></div><div><dt>驱动音频</dt><dd>{voiceReady ? "已确认" : "未确认"}</dd></div><div><dt>画面比例</dt><dd>{outputLayout === "landscape" ? "16:9 · 横屏" : "9:16 · 竖屏"}</dd></div></dl>{avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}{videoReady && videoUrl ? <a className="primary full downloadLink" href={videoUrl} download>下载首段口播视频</a> : <button className="primary full" disabled>{avatarStatus === "running" ? `HeyGen 渲染中 ${avatarProgress}%` : "等待 HeyGen 输出"}</button>}<button className="secondary full" onClick={() => setStep(3)}>返回配音确认</button></aside>
            </div>
            <section className="compositionPanel">
              <div className="compositionHead"><div><span className="eyebrow">AUTO EDIT</span><h3>自动合片任务</h3><p>完整粤语配音作为主轨；数字人出镜时新闻素材进入左侧小窗，数字人不出镜时新闻素材自动全屏。</p></div><span className={`status ${compositionStatus === "completed" ? "success" : compositionStatus === "failed" ? "error" : "pending"}`}>{compositionStatus === "idle" ? "尚未开始" : compositionStatus === "completed" ? "成片完成" : compositionStatus === "failed" ? "合片失败" : `${compositionStatus === "downloading" ? "下载素材" : compositionStatus === "rendering" ? "FFmpeg 合成" : "任务排队"} ${compositionProgress}%`}</span></div>
              <div className="compositionStats"><div><span>完整音频主轨</span><b>{audioSliceJobId ? "已就绪" : "等待切片"}</b></div><div><span>字幕时码</span><b className={subtitleStatus === "aligned" ? "good" : "warn"}>{subtitleStatus === "aligned" ? `${subtitleStats?.cueCount || 0} 条已校验` : "待对齐"}</b></div><div><span>数字人出镜</span><b>{avatarSliceJobs.filter((job) => job.status === "completed" && job.videoUrl).length} 个片段</b></div><div><span>新闻分镜</span><b>{selectedMedia.length} 个镜头</b></div><div><span>输出规格</span><b>{outputLayout === "landscape" ? "1920 × 1080" : "720 × 1280"} MP4</b></div></div>
              {outputLayout === "landscape" && <section className="composerControls"><div><h4>手动合片布局</h4><p>这里调整数字人出镜时的主播与素材小窗位置；没有数字人的时段，新闻素材自动铺满全屏。</p></div><div className="composerControlGrid"><label><span>主播横向位置 <b>{avatarX}</b></span><input type="range" min="600" max="1400" step="10" value={avatarX} onChange={(event) => setAvatarX(Number(event.target.value))} /></label><label><span>主播纵向位置 <b>{avatarY}</b></span><input type="range" min="-300" max="300" step="10" value={avatarY} onChange={(event) => setAvatarY(Number(event.target.value))} /></label><label><span>主播大小 <b>{avatarHeight}</b></span><input type="range" min="600" max="1400" step="20" value={avatarHeight} onChange={(event) => setAvatarHeight(Number(event.target.value))} /></label><label><span>素材窗横向位置 <b>{sceneX}</b></span><input type="range" min="0" max="1000" step="10" value={sceneX} onChange={(event) => setSceneX(Number(event.target.value))} /></label><label><span>素材窗纵向位置 <b>{sceneY}</b></span><input type="range" min="0" max="700" step="10" value={sceneY} onChange={(event) => setSceneY(Number(event.target.value))} /></label><label><span>素材窗大小 <b>{sceneWidth}</b></span><input type="range" min="420" max="1200" step="20" value={sceneWidth} onChange={(event) => setSceneWidth(Number(event.target.value))} /></label></div><button className="secondary" onClick={() => { setAvatarX(930); setAvatarY(50); setAvatarHeight(1040); setSceneX(80); setSceneY(250); setSceneWidth(820); }}>恢复推荐布局</button></section>}
              {compositionError && <div className="errorNotice" role="alert">{compositionError}</div>}
              <section className="localEditPackage"><div><span className="eyebrow">LOCAL EDIT PACKAGE</span><h4>本地剪辑包</h4><p>服务器直接生成可发布成片；需要精细修改时，可下载包含完整配音、数字人片段、新闻素材、音频对齐字幕、包装资产和时间线说明的压缩包，在剪映、Premiere 或 Final Cut 中继续处理。</p></div>{compositionStatus === "completed" && compositionJobId ? <a className="secondary downloadLink" href={`${MEDIA_SERVICE_URL}/compositions/${compositionJobId}/edit-package`}>下载本地剪辑包</a> : <button className="secondary" disabled>成片完成后可下载</button>}</section>
              <div className="actionBar"><p>{subtitleStatus !== "aligned" ? "字幕尚未与最终音频完成时码校验。" : missingAvatarSlices.length ? `已勾选的数字人片段还缺少 ${missingAvatarSlices.length} 段。` : !selectedMedia.length ? "未选新闻分镜：未出镜时段将使用循环背景和节目包装。" : "完整配音作为唯一主音轨；数字人出镜时使用素材小窗，未出镜时素材自动全屏。"}</p>{compositionUrl ? <a className="primary downloadLink" href={compositionUrl}>下载最终成片</a> : <button className="primary" disabled={subtitleStatus !== "aligned" || !selectedSliceIds.length || !videoReady || missingAvatarSlices.length > 0 || !audioSliceJobId || ["queued", "downloading", "rendering"].includes(compositionStatus)} onClick={startComposition}>{["queued", "downloading", "rendering"].includes(compositionStatus) ? `正在合片 ${compositionProgress}%` : compositionStatus === "failed" ? "重新提交合片" : "生成最终成片"}</button>}</div>
            </section>
          </section>
        )}
      </section>
      <footer>自动化新闻数字人系统 · V1 交互原型</footer>
    </main>
  );
}
