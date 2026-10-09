"use client";
import { useEffect, useRef, useState } from "react";
import { useProjectArchive } from "../lib/use-project-archive";
import { createDraftSrt } from "../lib/subtitle-srt";
import type { CreatorProfile } from "../lib/creator-provider";
import "../creator.css";

type Media = { id: string; type: "image" | "video"; url: string; caption: string; source?: string };
type Article = { id: string; title: string; url: string; source: string; text: string; media: Media[] };
type Slice = { id: string; index: number; start: number; end: number; duration: number; url: string };
type Job = { id: string; sliceId: string; label: string; start: number; end: number; status: string; progress: number; videoUrl?: string; error?: string };
type Scene = Media & { start: number; duration: number; downloadId?: string; status: string; error?: string };
type HotItem = { id: string; title: string; category: string; publishedAt: string | null; stale?: boolean; links: {url:string;source:string}[] };
type Hotspots = { fetchedAt: number; items: HotItem[]; sources: {id:string;name:string;region:string;status:string;count:number;error?:string}[]; note:string };
type Draft = {
  projectType: "creator"; step: number; projectName: string; urls: string[]; script: string; writingRequirements: string;
  articles: Article[]; confirmedUrls: string[]; sourcesConfirmed: boolean; scriptConfirmed: boolean; template: string; targetDuration: number;
  audioSliceJobId: string; voiceDuration: number; audioSlices: Slice[]; selectedSliceIds: string[]; avatarSliceJobs: Job[];
  scenes: Scene[]; compositionJobId: string; compositionStatus: string; compositionUrl: string; videoUrl: string;
  profileSnapshot: CreatorProfile | null; scriptModel: string; sopSnapshot: unknown; subtitles: string; subtitlesConfirmed: boolean;
};
const initial: Draft = { projectType:"creator", step:1, projectName:"我的科技观察", urls:[],script:"",writingRequirements:"",articles:[],confirmedUrls:[],sourcesConfirmed:false,scriptConfirmed:false,template:"explain",targetDuration:90,audioSliceJobId:"",voiceDuration:0,audioSlices:[],selectedSliceIds:[],avatarSliceJobs:[],scenes:[],compositionJobId:"",compositionStatus:"idle",compositionUrl:"",videoUrl:"",profileSnapshot:null,scriptModel:"",sopSnapshot:null,subtitles:"",subtitlesConfirmed:false };
const emptyProfile: CreatorProfile = {name:"我的主播",voiceId:"",portrait:"",style:"直接进入重点，先说发生了什么，再解释对普通人的影响。表达自然、清楚、有依据，不夸大，不编造个人经历。",speed:1};
const mediaApi = "/api/media";
async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? {cache:"no-store"} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data = await response.json().catch(()=>({error:`服务返回异常（HTTP ${response.status}）`}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
const clock = (n: number) => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,"0")}`;
const audioReset = { audioSliceJobId:"",voiceDuration:0,audioSlices:[],selectedSliceIds:[],avatarSliceJobs:[],compositionJobId:"",compositionStatus:"idle",compositionUrl:"",videoUrl:"",subtitles:"",subtitlesConfirmed:false,profileSnapshot:null };
const compositionReset = {compositionJobId:"",compositionStatus:"idle",compositionUrl:""};

export default function CreatorStudio() {
  const [draft,setDraft] = useState<Draft>(initial);
  const [profile,setProfile] = useState<CreatorProfile>(emptyProfile);
  const [savedProfile,setSavedProfile] = useState<CreatorProfile>(emptyProfile);
  const [profileReady,setProfileReady] = useState(false);
  const [profileOpen,setProfileOpen] = useState(false);
  const [hotspots,setHotspots] = useState<Hotspots|null>(null);
  const [hotBusy,setHotBusy] = useState(false);
  const [hotError,setHotError] = useState("");
  const [filter,setFilter] = useState("tech");
  const [busy,setBusy] = useState("");
  const lock = useRef(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [sourceErrors,setSourceErrors] = useState<{url:string;error:string}[]>([]);
  const [connection,setConnection] = useState("共用现有 API 配置");
  const update = (patch: Partial<Draft>) => setDraft(current=>({...current,...patch}));
  const archive = useProjectArchive(draft, saved=>setDraft({...initial,...saved}), "creator:current-draft-v1");
  const profileDirty = JSON.stringify(profile)!==JSON.stringify(savedProfile);
  const running = draft.avatarSliceJobs.some(j=>["queued","running"].includes(j.status)) || ["queued","downloading","rendering"].includes(draft.compositionStatus);
  const locked = !!busy || running || !archive.ready;
  const selectedArticles = draft.articles.filter(a=>draft.confirmedUrls.includes(a.url));
  const media = selectedArticles.flatMap(a=>a.media);
  const completeJobs = draft.avatarSliceJobs.filter(j=>j.status==="completed"&&j.videoUrl&&draft.selectedSliceIds.includes(j.sliceId));
  const allReady = draft.selectedSliceIds.length>0&&draft.selectedSliceIds.every(id=>completeJobs.some(j=>j.sliceId===id));

  async function run(label: string, action:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(label);setError("");setNotice("");
    try {await action();} catch(e) {setError(e instanceof Error?e.message:"操作失败");}
    finally {lock.current=false;setBusy("");}
  }
  async function refreshHotspots() {
    setHotBusy(true);setHotError("");
    try {setHotspots(await jsonRequest(`${mediaApi}/news/hotspots`));}
    catch(e){setHotError(e instanceof Error?e.message:"热点读取失败");}
    finally {setHotBusy(false);}
  }
  useEffect(()=>{
    void refreshHotspots();
    jsonRequest(`${mediaApi}/creator/profile`).then(p=>{setProfile(p);setSavedProfile(p);setProfileReady(true);}).catch(e=>setError(e.message));
    jsonRequest("/api/models/status").then(()=>setConnection("现有模型接口已连接")).catch(()=>setConnection("模型连接待检查 · API 配置"));
  },[]);

  useEffect(()=>{
    const pending=draft.avatarSliceJobs.filter(j=>["queued","running"].includes(j.status));
    const hasDownloads=draft.scenes.some(s=>["queued","downloading"].includes(s.status));
    const composing=["queued","downloading","rendering"].includes(draft.compositionStatus);
    if(!pending.length&&!hasDownloads&&!composing)return;
    let cancelled=false;
    const timer=setTimeout(async()=>{
      try {
        const jobs=await Promise.all(pending.map(async job=>{
          try {const data=await jsonRequest(`/api/avatar/jobs/${encodeURIComponent(job.id)}`);return {...job,status:data.status,progress:data.progress||0,videoUrl:data.video_url||job.videoUrl,error:data.error||""};}
          catch(e){return {...job,error:e instanceof Error?e.message:"状态查询失败，稍后重试"};}
        }));
        const downloads=hasDownloads?await jsonRequest("/api/library/downloads"):null;
        const composition=composing?await jsonRequest(`${mediaApi}/compositions/${draft.compositionJobId}`):null;
        if(cancelled)return;
        setDraft(current=>({...current,
          avatarSliceJobs:current.avatarSliceJobs.map(j=>jobs.find(v=>v.id===j.id)||j),
          videoUrl:jobs.find(j=>j.videoUrl)?.videoUrl||current.videoUrl,
          scenes:current.scenes.map(s=>{const found=downloads?.jobs?.find((j:{id:string})=>j.id===s.downloadId);return found?{...s,status:found.status,error:found.error}:s;}),
          ...(composition&&current.compositionJobId===draft.compositionJobId?{compositionStatus:composition.status,compositionUrl:composition.download_url||""}:{}),
        }));
        if(composition?.error)setError(composition.error);
      }catch(e){if(!cancelled){setError(e instanceof Error?e.message:"状态查询失败");setDraft(current=>({...current}));}}
    },4000);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[draft]);

  function changeUrls(urls:string[]) {
    update({urls:urls.slice(0,10),sourcesConfirmed:false,articles:[],confirmedUrls:[],script:"",scriptModel:"",sopSnapshot:null,scenes:[],scriptConfirmed:false,...audioReset});
    setSourceErrors([]);
  }
  async function extract() {
    const data=await jsonRequest("/api/news/extract",{urls:draft.urls,partial:true});
    update({articles:data.articles,confirmedUrls:[],sourcesConfirmed:false,scriptConfirmed:false,...audioReset});
    setSourceErrors(data.errors||[]);
    if(!data.articles.length)throw new Error("没有读到可用正文，请换链接或直接粘贴已写好的稿件");
  }
  async function writeScript() {
    if(!draft.sourcesConfirmed||!selectedArticles.length)throw new Error("请先确认本期来源");
    const sourceText=selectedArticles.map((a,i)=>`【来源 ${i+1}｜${a.title}｜${a.url}】\n${a.text}`).join("\n\n");
    const data=await jsonRequest("/api/scripts/generate",{mode:"creator",sourceText,writingRequirements:draft.writingRequirements,template:draft.template,duration:draft.targetDuration});
    update({script:data.content,scriptConfirmed:false,scriptModel:data.model,sopSnapshot:data.sopSnapshot,...audioReset,step:2});
  }
  async function saveProfile() {
    const saved=await jsonRequest(`${mediaApi}/creator/profile`,profile);
    setProfile(saved);setSavedProfile(saved);setProfileReady(true);
    if(JSON.stringify(saved)!==JSON.stringify(savedProfile))update({...audioReset});
    setNotice("主播档案已保存。音色与形象就绪后即可制作。");
  }
  async function upload(file:File) {
    const response=await fetch(`${mediaApi}/library/uploads`,{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"上传失败");return data;
  }
  async function uploadPortrait(file:File) {
    if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error("请上传 JPG、PNG 或 WebP 照片");
    const bitmap=await createImageBitmap(file);const vertical=bitmap.height>bitmap.width;bitmap.close();
    if(!vertical)throw new Error("请使用竖版正面主播照片，建议 9:16");
    const asset=await upload(file);setProfile(p=>({...p,portrait:`${mediaApi}/library/downloads/${asset.id}/file`}));
    setNotice("照片已入库，请保存主播档案。");
  }
  async function generateVoice() {
    if(!draft.scriptConfirmed)throw new Error("请先确认稿件");
    if(!profileReady||profileDirty||!savedProfile.voiceId)throw new Error("请先保存已接入个人音色的主播档案");
    const response=await fetch("/api/voice/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"creator",text:draft.script,voiceId:savedProfile.voiceId})});
    if(!response.ok){const data=await response.json();throw new Error(data.error||"配音失败");}
    const blob=await response.blob();
    let duration=Number(response.headers.get("X-Audio-Duration-Ms"));
    if(!duration){const object=URL.createObjectURL(blob);try{duration=await new Promise<number>((resolve,reject)=>{const audio=new Audio(object);audio.onloadedmetadata=()=>resolve(audio.duration*1000);audio.onerror=()=>reject(new Error("无法读取配音时长"));});}finally{URL.revokeObjectURL(object);}}
    if(!Number.isFinite(duration)||duration<=0)throw new Error("配音未返回有效时长");
    const storedResponse=await fetch(`${mediaApi}/audio/store`,{method:"POST",headers:{"Content-Type":"audio/mpeg"},body:blob});
    const stored=await storedResponse.json();if(!storedResponse.ok)throw new Error(stored.error||"配音保存失败");
    update({...audioReset,audioSliceJobId:stored.id,voiceDuration:duration,profileSnapshot:savedProfile,subtitles:createDraftSrt(draft.script,duration/1000),step:3});
  }
  async function sliceAudio() {
    const data=await jsonRequest(`${mediaApi}/audio/slices`,{audio_job_id:draft.audioSliceJobId,segment_seconds:30,duration_ms:draft.voiceDuration});
    update({audioSliceJobId:data.id,audioSlices:data.slices,selectedSliceIds:data.slices.map((s:Slice)=>s.id),avatarSliceJobs:[],videoUrl:"",...compositionReset,step:4});
  }
  async function generateAvatar() {
    const anchor=draft.profileSnapshot;
    if(!anchor?.portrait)throw new Error("请先上传并保存你的竖版主播照片，再生成配音和数字人");
    if(!draft.selectedSliceIds.length)throw new Error("至少选择一段数字人画面");
    const imageResponse=await fetch(anchor.portrait);if(!imageResponse.ok)throw new Error("主播照片读取失败");
    const imageBlob=await imageResponse.blob();
    const retained=draft.avatarSliceJobs.filter(j=>j.status!=="failed"&&draft.selectedSliceIds.includes(j.sliceId));
    for(const slice of draft.audioSlices.filter(s=>draft.selectedSliceIds.includes(s.id)&&!retained.some(j=>j.sliceId===s.id))) {
      const audio=await fetch(slice.url);if(!audio.ok)throw new Error("音频切片读取失败");
      const form=new FormData();form.set("image_file",new File([imageBlob],"creator.jpg",{type:imageBlob.type}));form.set("audio_file",new File([await audio.blob()],"slice.mp3",{type:"audio/mpeg"}));
      form.set("layout","portrait");form.set("anchor_name",anchor.name);form.set("slice_index",String(slice.index).padStart(3,"0"));
      form.set("motion_prompt","A natural Mandarin-speaking personal presenter facing the camera, steady posture, subtle expression, restrained hand gestures, accurate lip sync, no camera movement.");
      const response=await fetch("/api/avatar/jobs",{method:"POST",body:form});const data=await response.json();if(!response.ok||!data.id)throw new Error(data.error||"数字人提交失败");
      const job:Job={id:data.id,sliceId:slice.id,label:`${clock(slice.start)}–${clock(slice.end)}`,start:slice.start,end:slice.end,status:data.status||"queued",progress:0};
      retained.push(job);update({avatarSliceJobs:[...retained],...compositionReset});
    }
  }
  async function addScene(item:Media) {
    if(draft.scenes.some(s=>s.id===item.id))return;
    const data=await jsonRequest("/api/library/downloads",{sourceUrl:item.url,type:item.type,caption:item.caption});
    update({scenes:[...draft.scenes,{...item,downloadId:data.id,status:data.status,start:5+draft.scenes.length*8,duration:6}],...compositionReset});
  }
  function editScene(id:string,patch:Partial<Scene>) {update({scenes:draft.scenes.map(s=>s.id===id?{...s,...patch}:s),...compositionReset});}
  async function compose() {
    if(!allReady)throw new Error("请等待所选数字人片段全部完成");
    if(draft.scenes.some(s=>s.status!=="completed"))throw new Error("请等待素材下载完成，或移除失败的素材");
    if(!draft.subtitlesConfirmed)throw new Error("请先核对字幕时间码并确认，或清空字幕后确认无字幕输出");
    const data=await jsonRequest(`${mediaApi}/compositions`,{mode:"creator",layout:"portrait",audioJobId:draft.audioSliceJobId,audioDuration:draft.voiceDuration/1000,projectName:draft.projectName,anchorName:draft.profileSnapshot?.name,packagingAssets:[],greenScreen:false,
      avatarSegments:completeJobs.map(j=>({url:j.videoUrl,start:j.start,end:j.end})),
      scenes:draft.scenes.map(s=>({url:`${mediaApi}/library/downloads/${s.downloadId}/file`,type:s.type,start:s.start,duration:s.duration})),
      subtitles:draft.subtitles,title:draft.projectName,
    });update({compositionJobId:data.id,compositionStatus:data.status,compositionUrl:"",step:5});
  }

  return <main className="creatorStudio">
    <header className="creatorHeader"><div><span className="creatorEyebrow">PERSONAL CREATOR STUDIO</span><h1>把热点，讲成你的观点。</h1><p>科技 · AI · 社会观察 / 普通话 / 9:16 竖屏</p></div><button className="creatorProfileButton" onClick={()=>setProfileOpen(v=>!v)}>{savedProfile.portrait?<img src={savedProfile.portrait} alt="我的主播"/>:<span>我</span>}<div><b>{savedProfile.name}</b><small>{savedProfile.voiceId&&savedProfile.portrait?"主播档案已配置":"音色与形象待接入"}</small></div></button></header>
    <div className="creatorMeta"><span>{archive.status}</span><a href="/settings">{connection} ↗</a><button disabled={!!busy||!archive.ready} onClick={()=>void archive.save()}>保存项目</button><a href="/?new=1">新建项目</a></div>
    {profileOpen&&<section className="creatorPanel"><h2>我的主播</h2><p>继续使用现有 MiniMax 与 HeyGen。这里保存个人档案；声音样本与形象准备好后再接入。填写音色 ID 不会自动执行声音克隆。</p><fieldset disabled={locked||!profileReady} className="creatorProfileForm"><label>主播名称<input value={profile.name} maxLength={30} onChange={e=>setProfile({...profile,name:e.target.value})}/></label><label>MiniMax 个人音色 ID<input placeholder="待提供音源并完成克隆后填写" value={profile.voiceId} onChange={e=>setProfile({...profile,voiceId:e.target.value})}/></label><label>语速<select value={profile.speed} onChange={e=>setProfile({...profile,speed:Number(e.target.value)})}>{[.8,.9,1,1.1,1.2].map(v=><option key={v} value={v}>{v} 倍</option>)}</select></label><label>竖版主播照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void run("上传照片",()=>uploadPortrait(f));e.target.value="";}}/></label><label className="wide">我的表达风格<textarea value={profile.style} maxLength={6000} onChange={e=>setProfile({...profile,style:e.target.value})}/></label>{profile.portrait&&<img className="creatorPortrait" src={profile.portrait} alt="待保存的个人形象"/>}<button className="primary" onClick={()=>void run("保存主播档案",saveProfile)}>保存主播档案</button></fieldset>{!profileReady&&<button onClick={()=>void run("读取主播档案",async()=>{const p=await jsonRequest(`${mediaApi}/creator/profile`);setProfile(p);setSavedProfile(p);setProfileReady(true);})}>重新读取档案</button>}</section>}
    <nav className="creatorSteps" aria-label="制作步骤">{["选题与信源","我的口播稿","普通话配音","数字人画面","竖屏合片"].map((label,i)=><button key={label} disabled={!!busy} className={draft.step===i+1?"active":""} aria-current={draft.step===i+1?"step":undefined} onClick={()=>update({step:i+1})}><span>{String(i+1).padStart(2,"0")}</span>{label}</button>)}</nav>
    {busy&&<div className="creatorNotice" role="status">{busy}… 请稍候。</div>}{error&&<div className="creatorError" role="alert">{error}</div>}{notice&&<div className="creatorNotice" role="status">{notice}</div>}
    {draft.step===1&&<div className="creatorColumns"><section className="creatorPanel"><div className="creatorSectionHead"><div><h2>今日选题池</h2><p>3 个国外信源 · 6 个国内信源</p></div><button disabled={hotBusy} onClick={()=>void refreshHotspots()}>{hotBusy?"正在采集…":"刷新选题"}</button></div><div className="creatorTabs">{[["tech","科技 / AI"],["society","社会热点"],["all","全部"]].map(([key,label])=><button className={filter===key?"selected":""} key={key} onClick={()=>setFilter(key)}>{label}</button>)}</div>{hotError&&<p className="creatorError">{hotError}</p>}{hotspots&&<><p className="creatorHint">{hotspots.note} 缓存 15 分钟 · {new Date(hotspots.fetchedAt).toLocaleTimeString()}</p><details className="sourceHealth"><summary>信源状态 · {hotspots.sources.filter(s=>s.status==="ok").length}/9 可读取</summary>{hotspots.sources.map(s=><p key={s.id}>{s.name} · {s.status==="ok"?`${s.count} 条候选`:s.status==="stale"?"旧缓存":"暂不可用"}{s.error?` · ${s.error}`:""}</p>)}</details></>}
      <div className="hotList">{hotspots?.items.filter(i=>filter==="all"||i.category===filter).map(item=><article key={item.id}><div className="hotMeta">{item.links[0]?.source} · {item.publishedAt?new Date(item.publishedAt).toLocaleDateString():"日期待核实"}{item.stale?" · 旧缓存":""}</div><h3>{item.title}</h3><div className="hotActions"><details><summary>{item.links.length} 条报道链接</summary>{item.links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.source} ↗</a>)}</details><button disabled={locked||draft.urls.length>=10||item.links.every(l=>draft.urls.includes(l.url))} onClick={()=>changeUrls([...new Set([...draft.urls,...item.links.map(l=>l.url)])])}>加入本期 +</button></div></article>)}</div>{!hotBusy&&!hotspots?.items.length&&<p className="creatorEmpty">暂无候选，可在右侧粘贴原文链接继续制作。</p>}</section>
      <section className="creatorPanel"><h2>本期讲什么</h2><fieldset disabled={locked}><label>项目标题<input maxLength={40} value={draft.projectName} onChange={e=>update({projectName:e.target.value,...compositionReset})}/></label><div className="creatorFormRow"><label>内容类型<select value={draft.template} onChange={e=>update({template:e.target.value})}><option value="explain">AI 解读</option><option value="news">科技快讯</option><option value="society">社会热点评论</option></select></label><label>目标时长<select value={draft.targetDuration} onChange={e=>update({targetDuration:Number(e.target.value)})}>{[60,90,120].map(v=><option key={v} value={v}>{v} 秒</option>)}</select></label></div><label>原文链接 · 每行一条，最多 10 条<textarea className="sourceLinks" value={draft.urls.join("\n")} placeholder="从左侧加入选题，或粘贴自己的链接" onChange={e=>changeUrls(e.target.value.split("\n"))}/></label><button disabled={!draft.urls.some(u=>u.trim())} onClick={()=>void run("读取信源正文",extract)}>读取正文并核对</button>
      {sourceErrors.map(e=><p key={e.url} className="creatorError">{e.url}<br/>{e.error}</p>)}{draft.articles.map(a=><div className="confirmedArticle" key={a.id}><label className="creatorCheck"><input type="checkbox" checked={draft.confirmedUrls.includes(a.url)} onChange={e=>update({confirmedUrls:e.target.checked?[...draft.confirmedUrls,a.url]:draft.confirmedUrls.filter(u=>u!==a.url),sourcesConfirmed:false,scriptConfirmed:false,...audioReset})}/>{a.title}</label><a href={a.url} target="_blank" rel="noreferrer">{a.source} · 原文 ↗</a><details><summary>查看提取正文 · {a.text.length} 字</summary><p>{a.text}</p></details></div>)}{draft.articles.length>0&&<label className="creatorCheck"><input type="checkbox" checked={draft.sourcesConfirmed} disabled={!selectedArticles.length} onChange={e=>update({sourcesConfirmed:e.target.checked})}/>已核对勾选的正文，确认用于本期写稿</label>}<label>本期角度<textarea placeholder="例如：重点讲这次更新对普通人的实际影响" value={draft.writingRequirements} maxLength={2000} onChange={e=>update({writingRequirements:e.target.value})}/></label><button className="primary" disabled={!draft.sourcesConfirmed||!selectedArticles.length||profileDirty||!profileReady} onClick={()=>void run("按你的风格写稿",writeScript)}>生成普通话口播稿 →</button><p className="creatorHint">已有稿件？直接进入下一步粘贴，跳过模型写稿。</p><button onClick={()=>update({step:2})}>直接粘贴稿件</button></fieldset></section></div>}
    {draft.step===2&&<section className="creatorPanel"><h2>我的口播稿</h2><p>直接进入重点，讲清一个事件。{draft.scriptModel?`本稿模型：${draft.scriptModel}`:"可以直接粘贴已写好的稿件。"}</p><fieldset disabled={locked}><textarea className="creatorScript" placeholder="在这里写下或粘贴普通话口播稿…" value={draft.script} onChange={e=>update({script:e.target.value,scriptConfirmed:false,...audioReset})}/><p className="creatorHint">{draft.script.length} 字 · 目标 {draft.targetDuration} 秒，实际时长以配音为准。修改稿件后需要重新配音。</p><label className="creatorCheck"><input type="checkbox" checked={draft.scriptConfirmed} disabled={draft.script.trim().length<100} onChange={e=>update({scriptConfirmed:e.target.checked})}/>我已核对事实、数字与表达，确认用于普通话配音</label><button className="primary" disabled={!draft.scriptConfirmed} onClick={()=>update({step:3})}>确认稿件，进入配音 →</button></fieldset></section>}
    {draft.step===3&&<section className="creatorPanel"><h2>用你的声音讲述</h2><p>MiniMax · 普通话 · {savedProfile.voiceId?"已配置个人音色":"个人音色待接入"} · {savedProfile.speed} 倍语速</p>{(!savedProfile.voiceId||!savedProfile.portrait||profileDirty)&&<div className="creatorNotice">你的音源和形象还未准备完成时，可以先完成选题和写稿。<button onClick={()=>setProfileOpen(true)}>打开我的主播</button></div>}<fieldset disabled={locked}><button className="primary" disabled={!draft.scriptConfirmed||!profileReady||profileDirty||!savedProfile.voiceId} onClick={()=>void run("生成普通话配音",generateVoice)}>{draft.audioSliceJobId?"重新生成配音":"生成普通话配音"}</button>{draft.audioSliceJobId&&<><audio controls src={`${mediaApi}/audio/${draft.audioSliceJobId}/source.mp3`}/><p>完整时长 {clock(draft.voiceDuration/1000)} · {draft.profileSnapshot?.name}</p><a href={`${mediaApi}/audio/${draft.audioSliceJobId}/source.mp3`} download>下载配音</a><button className="primary" onClick={()=>void run("切分数字人驱动音频",sliceAudio)}>试听确认，切分音频 →</button></>}</fieldset></section>}
    {draft.step===4&&<section className="creatorPanel"><h2>让你的数字人出镜</h2><p>沿用 HeyGen 图片＋音频生成。每段约 30 秒，可仅生成需要出镜的片段。未出镜时段需要素材覆盖。</p>{running&&<p className="creatorNotice">任务进行中，完成后可继续编辑。任务状态会自动更新。</p>}<fieldset disabled={locked}>{draft.profileSnapshot?.portrait&&<img className="creatorPortrait" src={draft.profileSnapshot.portrait} alt="本期主播形象"/>}{draft.audioSlices.map(slice=>{const job=draft.avatarSliceJobs.find(j=>j.sliceId===slice.id);return <div className="creatorSlice" key={slice.id}><label className="creatorCheck"><input type="checkbox" checked={draft.selectedSliceIds.includes(slice.id)} onChange={e=>update({selectedSliceIds:e.target.checked?[...draft.selectedSliceIds,slice.id]:draft.selectedSliceIds.filter(id=>id!==slice.id),...compositionReset})}/>{clock(slice.start)}—{clock(slice.end)} · {job?`${job.status} ${job.progress}%`:"未提交"}</label><audio controls src={slice.url}/>{job?.error&&<p className="creatorError">{job.error}</p>}{job?.videoUrl&&<video className="creatorVideo" controls preload="metadata" src={job.videoUrl}/>}</div>;})}<button className="primary" disabled={!draft.profileSnapshot?.portrait||!draft.selectedSliceIds.length||allReady} onClick={()=>void run("提交数字人片段",generateAvatar)}>生成所选数字人片段</button><button disabled={!allReady} onClick={()=>update({step:5})}>片段已就绪，进入合片 →</button></fieldset>{!draft.audioSlices.length&&<p className="creatorEmpty">请先生成配音并试听确认。</p>}</section>}
    {draft.step===5&&<section className="creatorPanel"><h2>竖屏合片</h2><p>1080 × 1920 · 数字人口播＋全屏补充画面＋标题与字幕。完整配音作为唯一音轨。</p><fieldset disabled={locked}><label>成片标题<input maxLength={40} value={draft.projectName} onChange={e=>update({projectName:e.target.value,...compositionReset})}/></label><details><summary>从本期来源添加画面 · {media.length} 个候选</summary><div className="creatorMediaGrid">{media.map(item=><article key={item.id}>{item.type==="image"?<img src={item.url} alt={item.caption} loading="lazy"/>:<span>视频素材</span>}<p>{item.caption||item.source}</p><button disabled={draft.scenes.some(s=>s.id===item.id)} onClick={()=>void run("下载所选素材",()=>addScene(item))}>下载并加入分镜</button></article>)}</div></details><label>上传本地图片或视频<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={e=>{const f=e.target.files?.[0];if(f)void run("上传补充素材",async()=>{const a=await upload(f);update({scenes:[...draft.scenes,{id:a.id,type:a.type,url:`${mediaApi}/library/downloads/${a.id}/file`,caption:f.name,downloadId:a.id,status:"completed",start:5+draft.scenes.length*8,duration:6}],...compositionReset});});e.target.value="";}}/></label>{draft.scenes.map(scene=><div className="creatorScene" key={scene.id}><b>{scene.caption}</b><span>{scene.status}</span><label>开始（秒）<input type="number" min={0} max={draft.voiceDuration/1000} value={scene.start} onChange={e=>editScene(scene.id,{start:Number(e.target.value)})}/></label><label>时长（秒）<input type="number" min={1} max={120} value={scene.duration} onChange={e=>editScene(scene.id,{duration:Number(e.target.value)})}/></label><button onClick={()=>update({scenes:draft.scenes.filter(s=>s.id!==scene.id),...compositionReset})}>移除</button>{scene.error&&<p className="creatorError">{scene.error} · 可移除后重新添加</p>}</div>)}<label>字幕 SRT · 可修改时间码<textarea className="creatorSubtitles" value={draft.subtitles} onChange={e=>update({subtitles:e.target.value,subtitlesConfirmed:false,...compositionReset})}/></label><p className="creatorHint">初始字幕按字数估算时间，未调用额外识别 API。请对照配音校时，也可粘贴已校准的 SRT；清空可输出无字幕版本。</p><a download="普通话字幕.srt" href={`data:application/x-subrip;charset=utf-8,${encodeURIComponent(draft.subtitles)}`}>下载字幕 SRT</a><label className="creatorCheck"><input type="checkbox" checked={draft.subtitlesConfirmed} onChange={e=>update({subtitlesConfirmed:e.target.checked})}/>已核对字幕内容与时间码，确认当前字幕设置</label><button className="primary" disabled={!allReady||!draft.subtitlesConfirmed||draft.scenes.some(s=>s.status!=="completed")} onClick={()=>void run("创建竖屏合片",compose)}>生成竖屏成片</button></fieldset><p role="status">合片状态：{draft.compositionStatus}</p>{draft.compositionUrl&&<><video className="creatorVideo" controls src={draft.compositionUrl}/><a className="primary" href={draft.compositionUrl} download>下载竖屏成片</a></>}{!allReady&&<p className="creatorEmpty">先完成配音与所选数字人片段，再生成成片。</p>}</section>}
  </main>;
}
