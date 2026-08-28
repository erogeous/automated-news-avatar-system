"use client";

import { useEffect, useMemo, useState } from "react";

type Step = 1 | 2 | 3 | 4;

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
    turnaround: "/anchors/hk-female-anchor-turnaround.png",
  },
} as const;
const stepNames = ["输入新闻", "确认口播稿", "确认配音", "生成数字人"];

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
  const [projectName, setProjectName] = useState("今日新闻口播");
  const [connection, setConnection] = useState<"checking" | "ready" | "error">("checking");
  const [connectionNote, setConnectionNote] = useState("正在检测模型…");
  const [anchorId, setAnchorId] = useState<keyof typeof anchors>("male");
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [scriptError, setScriptError] = useState("");
  const [scriptModel, setScriptModel] = useState("");
  const [scriptSop, setScriptSop] = useState("《點觀香港》V4.1");
  const [previewDuration, setPreviewDuration] = useState(0);
  const selectedAnchor = anchors[anchorId];
  const voiceId = selectedAnchor.voiceId;
  const validCount = urls.filter((url) => /^https?:\/\//i.test(url.trim())).length;
  const charCount = useMemo(() => (script.match(/[\u3400-\u9fff]/g) || []).length, [script]);
  const minutes = charCount ? (charCount / 250).toFixed(1) : "0.0";

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
    if (!avatarJobId || !["queued", "running"].includes(avatarStatus)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
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
          setAvatarError(data.error || "InfiniteTalk 渲染失败");
        }
      } catch (error) {
        if (!cancelled) setAvatarError(error instanceof Error ? error.message : "数字人任务查询失败");
      }
    }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [avatarJobId, avatarStatus, avatarProgress]);

  function updateUrl(index: number, value: string) {
    setUrls((current) => current.map((url, i) => (i === index ? value : url)));
  }

  async function generateScript() {
    if (!validCount && sourceText.trim().length < 80) return;
    setBusy(true);
    setScriptError("");
    try {
      const response = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, urls: urls.filter((url) => /^https?:\/\//i.test(url.trim())), anchorName: selectedAnchor.name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "口播稿生成失败");
      setScript(data.content);
      setScriptModel(data.model);
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
      const response = await fetch("/api/voice/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cantoneseScript, voiceId, speed: 1 }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "配音生成失败");
      }
      const blob = await response.blob();
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(blob);
      });
      setPreviewDuration(Number(response.headers.get("X-Audio-Duration-Ms") || 0));
      setVoiceReady(true);
      setStep(3);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "配音生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function generateAvatar() {
    if (!audioUrl) return;
    setBusy(true);
    setAvatarError("");
    try {
      const [audioResponse, imageResponse] = await Promise.all([fetch(audioUrl), fetch(selectedAnchor.renderInput)]);
      const [audio, image] = await Promise.all([audioResponse.blob(), imageResponse.blob()]);
      const form = new FormData();
      form.set("audio", new File([audio], "voice-preview.mp3", { type: audio.type || "audio/mpeg" }));
      form.set("image", new File([image], `${selectedAnchor.id}-anchor.jpg`, { type: image.type || "image/jpeg" }));
      form.set("anchor_id", selectedAnchor.id);
      const response = await fetch("/api/avatar/jobs", { method: "POST", body: form });
      const responseText = await response.text();
      let data: { id?: string; status?: "queued" | "running"; progress?: number; error?: string; detail?: string } = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(response.status === 413 || /payload too large/i.test(responseText)
          ? "文件过大，请返回上一步重新生成配音"
          : `数字人服务返回异常（HTTP ${response.status}）`);
      }
      if (!response.ok) throw new Error(data.error || data.detail || "数字人任务提交失败");
      if (!data.id) throw new Error("数字人服务没有返回任务编号");
      setAvatarJobId(data.id);
      setAvatarStatus(data.status || "queued");
      setAvatarProgress(Number(data.progress || 0));
      setStep(4);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "数字人任务提交失败");
    } finally {
      setBusy(false);
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
            <label className="fieldLabel sourceLabel" htmlFor="source-text">新闻正文或事实摘要 <span>选填</span></label>
            <textarea id="source-text" className="sourceEditor" value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="如有补充资料，可把新闻正文或已经核实的事实摘要粘贴到这里；只填写上面的新闻链接也可以生成。" />
            {scriptError && <div className="errorNotice" role="alert">{scriptError}</div>}
            <div className="actionBar"><p>填写至少 1 条有效链接即可；系统将先按 V4.1 生成繁体中文书面母稿。</p><button className="primary" disabled={(!validCount && sourceText.trim().length < 80) || busy || connection !== "ready"} onClick={generateScript}>{busy ? "正在阅读 V4.1 并整理新闻…" : "读取新闻并生成书面母稿"}</button></div>
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
            <div className="anchorSection">
              <div className="anchorSectionHead"><div><b>选择本期主播</b><span>主播形象与粤语音色固定绑定，选择后自动匹配。</span></div><em>2 名已授权虚拟主播</em></div>
              <div className="anchorGrid" aria-label="本期主播选择">
                {Object.values(anchors).map((anchor) => (
                  <button key={anchor.id} className={`anchorCard ${anchorId === anchor.id ? "selected" : ""}`} onClick={() => setAnchorId(anchor.id)}>
                    <img src={anchor.portrait} alt={`${anchor.name}，${anchor.role}`} />
                    <span className="anchorCardBody"><span className="anchorCheck">{anchorId === anchor.id ? "✓" : ""}</span><b>{anchor.name}</b><small>{anchor.role}</small><i>{anchor.voiceName}</i></span>
                  </button>
                ))}
              </div>
            </div>
            {voiceError && <div className="errorNotice" role="alert">{voiceError}</div>}
            <div className="notice"><span>i</span><p>确认后将锁定书面母稿，按本期主播姓名转成正式香港粤语，再调用固定音色生成配音。</p></div>
            <div className="actionBar"><p>已选择 {selectedAnchor.name}，自动匹配“{selectedAnchor.voiceName}”。</p><button className="primary" disabled={script.trim().length < 100 || busy || connection !== "ready"} onClick={generateVoice}>{busy ? "正在转写粤语并生成试听…" : `确认母稿、主播并生成配音`}</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 03</span><h2>试听并确认配音</h2><p>配音已完成，请确认语速、停顿和专有名词发音。</p></div><span className="status success">配音已就绪</span></div>
            <div className="audioCard realAudio">
              {audioUrl ? <audio controls src={audioUrl} aria-label="真实粤语配音试听" /> : <p>尚未生成试听音频</p>}
            </div>
            <div className="voiceIdentity"><img src={selectedAnchor.portrait} alt={selectedAnchor.name} /><div><span>本期主播</span><b>{selectedAnchor.name}</b><small>{selectedAnchor.role} · {selectedAnchor.voiceName}</small></div></div>
            <div className="summaryCard"><div><span>音色绑定</span><b>{selectedAnchor.voiceName}</b></div><div><span>语言</span><b>粤语</b></div><div><span>模型</span><b>speech-2.8-hd</b></div><div><span>试听时长</span><b>{previewDuration ? `${(previewDuration / 1000).toFixed(1)} 秒` : "—"}</b></div></div>
            <div className="notice"><span>i</span><p>这是由真实模型生成的短篇试听。确认音色和粤语效果后，再开放完整 4 分钟配音，避免测试阶段产生不必要用量。</p></div>
            {avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}
            <div className="actionBar"><button className="secondary" onClick={() => { setVoiceReady(false); setStep(2); }}>返回更换主播或稿件</button><button className="primary" disabled={!voiceReady || busy} onClick={generateAvatar}>{busy ? "正在准备任务…" : "配音确认，进入数字人对口型"}</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 04</span><h2>数字人对口型</h2><p>{selectedAnchor.name} 的竖版形象和已确认粤语音频已经配对。</p></div><span className={`status ${avatarStatus === "completed" ? "success" : avatarStatus === "failed" ? "error" : "pending"}`}>{avatarStatus === "completed" ? "视频已完成" : avatarStatus === "failed" ? "渲染失败" : avatarStatus === "running" ? `渲染中 ${avatarProgress}%` : "任务排队中"}</span></div>
            <div className="videoLayout">
              <div className="videoPlaceholder anchorPreview">{videoReady && videoUrl ? <video controls src={videoUrl} poster={selectedAnchor.portrait} /> : <img src={selectedAnchor.portrait} alt={`${selectedAnchor.name}竖版播报形象`} />}<div className="previewCaption"><b>{projectName}</b><span>{selectedAnchor.name} · {videoReady ? "数字人口播视频" : "9:16 播报画面"}</span></div></div>
              <aside className="resultPanel"><div className="resultAnchor"><img src={selectedAnchor.turnaround} alt={`${selectedAnchor.name}三视图`} /><div><span>数字人资产</span><b>{selectedAnchor.name}</b><small>三视图与竖版播报图已就绪</small></div></div><h3>对口型任务</h3><dl><div><dt>任务状态</dt><dd>{avatarStatus === "completed" ? "已完成" : avatarStatus === "failed" ? "失败" : avatarStatus === "running" ? `渲染中 ${avatarProgress}%` : "排队中"}</dd></div><div><dt>主播音色</dt><dd>{selectedAnchor.voiceName}</dd></div><div><dt>驱动音频</dt><dd>{voiceReady ? "已确认" : "未确认"}</dd></div><div><dt>画面比例</dt><dd>9:16 · 480P</dd></div></dl>{avatarError && <div className="errorNotice" role="alert">{avatarError}</div>}{videoReady && videoUrl ? <a className="primary full downloadLink" href={videoUrl} download>下载口播视频</a> : <button className="primary full" disabled>{avatarStatus === "running" ? `InfiniteTalk 渲染中 ${avatarProgress}%` : "等待 InfiniteTalk 输出"}</button>}<button className="secondary full" onClick={() => setStep(3)}>返回配音确认</button></aside>
            </div>
          </section>
        )}
      </section>
      <footer>自动化新闻数字人系统 · V1 交互原型</footer>
    </main>
  );
}
