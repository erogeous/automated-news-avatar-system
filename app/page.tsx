"use client";

import { useMemo, useState } from "react";

type Step = 1 | 2 | 3 | 4;

const initialUrls = Array.from({ length: 10 }, () => "");
const demoScript = `大家好，欢迎收看本期新闻观察。今天我们把几条值得关注的消息放在一起，看看它们背后有哪些共同的变化。

首先来看第一条消息。根据已提交的新闻来源，相关事件在近期出现了新进展。从已公开信息来看，这次变化不仅涉及事件本身，也可能对相关行业和普通用户产生进一步影响。目前各方公布的关键数据基本一致，但部分细节仍有待后续确认。

第二条消息与前一条存在一定关联。新的行业动向表明，市场正从单一产品竞争，逐渐转向服务、效率和实际使用体验的综合竞争。对用户而言，新选择在增多，但判断成本也在上升。这意味着，不能只看宣传中的单项指标，还需要结合长期成本、服务能力和自身需求做决定。

再看第三条消息。多个来源都提到了政策、技术和市场之间的相互影响。一项新技术或新规则从发布到真正落地，通常还要经过试点、调整和大规模应用几个阶段。因此，现在就对长期结果下结论还为时过早，更值得关注的是后续执行节奏以及真实用户反馈。

综合今天的几条消息，我们可以看到一个共同趋势：变化速度正在加快，但真正有价值的判断，仍然需要回到可验证的事实、实际效果和持续跟踪。以上就是本期新闻观察，感谢你的收看。`;

const stepNames = ["输入新闻", "确认口播稿", "确认配音", "生成数字人"];

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [urls, setUrls] = useState(initialUrls);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [projectName, setProjectName] = useState("今日新闻口播");
  const validCount = urls.filter((url) => /^https?:\/\//i.test(url.trim())).length;
  const charCount = useMemo(() => (script.match(/[\u3400-\u9fff]/g) || []).length, [script]);
  const minutes = charCount ? (charCount / 250).toFixed(1) : "0.0";

  function updateUrl(index: number, value: string) {
    setUrls((current) => current.map((url, i) => (i === index ? value : url)));
  }

  function generateScript() {
    if (!validCount) return;
    setBusy(true);
    window.setTimeout(() => {
      setScript(demoScript);
      setBusy(false);
      setStep(2);
    }, 700);
  }

  function generateVoice() {
    setBusy(true);
    window.setTimeout(() => {
      setVoiceReady(true);
      setBusy(false);
      setStep(3);
    }, 700);
  }

  function generateAvatar() {
    setBusy(true);
    window.setTimeout(() => {
      setVideoReady(true);
      setBusy(false);
      setStep(4);
    }, 700);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brandMark">播</div>
        <div>
          <h1>新闻数字人工作台</h1>
          <p>从新闻链接到数字人口播视频</p>
        </div>
        <span className="prototypeBadge">交互原型</span>
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
            <div className="actionBar"><p>建议使用 5–7 条来源，原型不会真实读取网页。</p><button className="primary" disabled={!validCount || busy} onClick={generateScript}>{busy ? "正在整理…" : "读取新闻并生成口播稿"}</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="workspace">
            <div className="sectionHead"><div><span className="eyebrow">STEP 02</span><h2>修改并确认口播稿</h2><p>这是界面演示稿。接入后将由模型根据选中来源生成。</p></div><button className="secondary" onClick={() => setStep(1)}>返回新闻</button></div>
            <div className="metricRow"><div><b>{charCount}</b><span>汉字</span></div><div><b>{minutes}</b><span>预计分钟</span></div><div><b>{validCount}</b><span>条新闻来源</span></div><div><b className={charCount >= 900 && charCount <= 1100 ? "good" : "warn"}>{charCount >= 900 && charCount <= 1100 ? "合适" : "需调整"}</b><span>稿件长度</span></div></div>
            <textarea className="scriptEditor" value={script} onChange={(e) => setScript(e.target.value)} aria-label="口播稿" />
            <div className="notice"><span>i</span><p>确认后将锁定当前稿件版本并开始配音。后续如修改文稿，需重新生成音频。</p></div>
            <div className="actionBar"><p>请检查人名、地名、数字、日期和发音。</p><button className="primary" disabled={script.trim().length < 100 || busy} onClick={generateVoice}>{busy ? "正在生成配音…" : "确认稿件，开始配音"}</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 03</span><h2>试听并确认配音</h2><p>配音已完成，请确认语速、停顿和专有名词发音。</p></div><span className="status success">配音已就绪</span></div>
            <div className="audioCard">
              <button className="play" aria-label="播放配音">▶</button>
              <div className="audioTrack"><div className="wave">{Array.from({ length: 46 }, (_, i) => <i key={i} style={{ height: `${14 + ((i * 17) % 30)}px` }} />)}</div><div className="time"><span>00:00</span><span>04:02</span></div></div>
            </div>
            <div className="summaryCard"><div><span>配音音色</span><b>授权主播音色 A</b></div><div><span>语速</span><b>1.0×</b></div><div><span>稿件版本</span><b>v1</b></div><div><span>时长</span><b>04:02</b></div></div>
            <div className="notice"><span>i</span><p>当前是交互原型，播放器未绑定真实音频。正式接入后，只有试听通过的配音才能进入数字人阶段。</p></div>
            <div className="actionBar"><button className="secondary" onClick={() => { setVoiceReady(false); setStep(2); }}>返回修改稿件</button><button className="primary" disabled={!voiceReady || busy} onClick={generateAvatar}>{busy ? "正在提交…" : "配音确认，生成数字人"}</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="workspace compact">
            <div className="sectionHead"><div><span className="eyebrow">STEP 04</span><h2>数字人口播视频</h2><p>音频与数字人已完成音画匹配。</p></div><span className="status success">视频已完成</span></div>
            <div className="videoLayout">
              <div className="videoPlaceholder"><div className="avatarFace">播</div><b>{projectName}</b><span>9:16 数字人视频预览区</span><button className="videoPlay" aria-label="播放视频">▶</button></div>
              <aside className="resultPanel"><h3>成片信息</h3><dl><div><dt>任务状态</dt><dd>已完成</dd></div><div><dt>稿件版本</dt><dd>v1</dd></div><div><dt>配音时长</dt><dd>04:02</dd></div><div><dt>画面比例</dt><dd>9:16</dd></div></dl><button className="primary full" disabled={!videoReady}>下载口播视频</button><button className="secondary full" onClick={() => setStep(3)}>重新选择数字人</button></aside>
            </div>
          </section>
        )}
      </section>
      <footer>自动化新闻数字人系统 · V1 交互原型</footer>
    </main>
  );
}
