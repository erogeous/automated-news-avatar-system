"use client";
import { useEffect, useState } from "react";
import { libraryRequest } from "../lib/use-project-archive";
import { srtDataUrl } from "../lib/subtitle-srt";
import "./style.css";

type Project={projectType?:string;anchorName?:string;id:string;name:string;revision:number;updatedAt:number;anchorId:string;hasScript:boolean;hasAudio:boolean;hasVideo:boolean;hasComposition:boolean};
type Sop={id:string;name:string;version:string;text:string;createdAt:number};
type Download={id:string;caption:string;type:string;status:string;progress:number;sourceUrl:string;error?:string};
type RecordData={id:string;revision:number;snapshot:{projectType?:string;subtitles?:string;script?:string;manuscript?:string;cantoneseScript?:string;voiceDuration?:number;scriptSop?:string;audioSliceJobId?:string;avatarSliceJobs?:{id:string;videoUrl?:string;label:string}[];compositionUrl?:string;compositionJobId?:string}};
export default function Library(){
  const [tab,setTab]=useState("projects"),[projects,setProjects]=useState<Project[]>([]),[sops,setSops]=useState<Sop[]>([]),[active,setActive]=useState<Sop|null>(null);
  const [preview,setPreview]=useState<Sop|null>(null),[downloads,setDownloads]=useState<Download[]>([]),[query,setQuery]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [detail,setDetail]=useState<RecordData|null>(null),[maxRevision,setMaxRevision]=useState(1);
  async function readWithRetry(url:string){
    try{return await libraryRequest(url);}catch(first){
      await new Promise(resolve=>setTimeout(resolve,500));
      try{return await libraryRequest(url);}catch{throw first;}
    }
  }
  async function refresh(){
    const results=await Promise.allSettled([readWithRetry("/projects"),readWithRetry("/sops"),readWithRetry("/downloads")]);
    const [p,s,d]=results;
    if(p.status==="fulfilled")setProjects(Array.isArray(p.value.projects)?p.value.projects:[]);
    if(s.status==="fulfilled"){setSops(Array.isArray(s.value.versions)?s.value.versions:[]);setActive(s.value.active||null);}
    if(d.status==="fulfilled")setDownloads(Array.isArray(d.value.jobs)?d.value.jobs:[]);
    const failures=results.map((result,index)=>result.status==="rejected"?`${["历史项目","SOP 规则","已下载素材"][index]}：${result.reason instanceof Error?result.reason.message:"读取失败"}`:"").filter(Boolean);
    setError(failures.join("\n"));
  }
  async function recoverBrowserDraft(silent=false){
    try{
      const draft=JSON.parse(localStorage.getItem("news-avatar:current-draft-v1")||"null");
      if(!draft?.id||!/^[a-f0-9]{32}$/.test(draft.id)||!draft.snapshot){
        if(!silent){setError("");setNotice("当前浏览器没有可恢复的工作台草稿。草稿只保存在当时制作所用的浏览器和网址中。");}return false;
      }
      if(!draft.snapshot.script&&!draft.snapshot.audioSliceJobId&&!draft.snapshot.urls?.some((url:string)=>Boolean(url))){
        if(!silent){setError("");setNotice("找到了浏览器草稿，但其中没有稿件、新闻链接或配音记录，无需归档。");}return false;
      }
      try{
        await libraryRequest("/projects/"+draft.id);
        if(!silent){setError("");setNotice("这份浏览器草稿已经在服务器历史项目中。");setTab("projects");await refresh();}
        return false;
      }catch{}
      await libraryRequest("/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:draft.id,expectedRevision:0,snapshot:draft.snapshot})});
      if(!silent){setError("");setNotice("已将当前浏览器中的制作进度恢复到服务器历史库。");setTab("projects");}
      await refresh();return true;
    }catch(e){if(!silent)setError(e instanceof Error?e.message:"浏览器草稿恢复失败");return false;}
  }
  useEffect(()=>{const initial=new URLSearchParams(location.search).get("tab");if(initial&&["projects","downloads","sops"].includes(initial))setTab(initial);void refresh().then(()=>recoverBrowserDraft(true));},[]);
  useEffect(()=>{if(!downloads.some(d=>["queued","downloading"].includes(d.status)))return;const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[downloads]);
  async function upload(file:File){
    setBusy(true);setError("");setNotice("");
    try{
      if(file.size>5_000_000)throw new Error("SOP 文件不得超过5MB");
      const record=await libraryRequest("/sops",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-File-Name":encodeURIComponent(file.name)},body:file});
      setPreview(record);await refresh();setNotice("文件已解析保存，请核对全文后点击启用。当前规则尚未改变。");
    }catch(e){setError(e instanceof Error?e.message:"上传失败");}finally{setBusy(false);}
  }
  async function activate(){
    if(!preview)return;setBusy(true);
    try{await libraryRequest("/sops/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:preview.id})});await refresh();setNotice("已启用 "+preview.version+"，下次写稿生效，已有稿件不变。");}
    catch(e){setError(e instanceof Error?e.message:"启用失败");}finally{setBusy(false);}
  }
  async function show(id:string,revision?:number){
    try{const record=await libraryRequest("/projects/"+id+(revision?"/versions/"+revision:""));setDetail(record);if(!revision)setMaxRevision(record.revision);}
    catch(e){setError(e instanceof Error?e.message:"读取项目失败");}
  }
  async function retry(item:Download){
    try{await libraryRequest("/downloads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceUrl:item.sourceUrl,type:item.type,caption:item.caption})});await refresh();setNotice("已提交保存任务，可在「已下载素材」中查看结果。");}
    catch(e){setError(e instanceof Error?e.message:"重试失败");}
  }
  return <main className="libraryPage">
    <header className="libraryHeader"><div><span>NEWS AVATAR STUDIO</span><h1>内容与规则库</h1><p>每一期的稿件、音频与视频，都保留制作记录。</p></div><a className="primary" href="/?new=1">新建一期</a></header>
    <nav className="libraryTabs" aria-label="素材库分类">{[["projects","历史项目"],["downloads","已下载素材"],["sops","旧版 SOP 规则"]].map(([key,label])=><button key={key} aria-pressed={tab===key} className={tab===key?"primary":"secondary"} onClick={()=>{setTab(key);setDetail(null);const url=new URL(location.href);url.searchParams.set("tab",key);history.replaceState(null,"",url);window.dispatchEvent(new PopStateEvent("popstate"));}}>{label}</button>)}<button className="secondary" onClick={()=>void refresh()}>刷新列表</button><button className="secondary" onClick={()=>void recoverBrowserDraft()}>恢复浏览器草稿</button></nav>
    <p className="libraryHint">项目会自动保存到服务器历史库，并同时保留一份当前浏览器草稿。关闭网页后可继续制作；服务器历史项目可跨设备访问。</p>
    {error&&<div className="errorNotice" role="alert">{error}</div>}{notice&&<div className="libraryHint" role="status">{notice}</div>}
    {tab==="projects"&&<section>
      <label>搜索项目<input aria-label="搜索项目" placeholder="输入名称或日期" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="libraryGrid">{projects.filter(p=>(p.name+" "+new Date(p.updatedAt).toLocaleDateString()).includes(query)).map(p=><article key={p.id} className="libraryCard">
        <span>{new Date(p.updatedAt).toLocaleString()} · {p.projectType==="creator"?(p.anchorName||"我的主播"):(p.anchorId==="female"?"林嘉晴":"梁正言")}</span><h2>{p.name}</h2>
        <p>{[p.hasScript&&"文稿",p.hasAudio&&"音频",p.hasVideo&&"数字人",p.hasComposition&&"合成视频"].filter(Boolean).join(" · ")||"制作中"} · 版本 {p.revision}</p>
        <div className="libraryActions"><button className="secondary" onClick={()=>void show(p.id)}>查看内容与版本</button><a href={"/"+"?project="+p.id} className="primary">继续制作</a><a href={"/"+"?project="+p.id+"&copy=1"}>复制为新一期</a></div>
      </article>)}</div>
      {!projects.length&&<p className="libraryEmpty">暂时没有归档项目。回到工作台制作时会自动保存；旧文件不会被伪装成完整历史项目。</p>}
      {detail&&<section className="libraryDetail"><h2>项目内容</h2><label>历史版本<select value={detail.revision} onChange={e=>void show(detail.id,Number(e.target.value))}>{Array.from({length:maxRevision},(_,i)=>maxRevision-i).map(v=><option key={v} value={v}>版本 {v}</option>)}</select></label>
        <p>写稿规则：{detail.snapshot.scriptSop||"未记录"}</p>
        <h3>书面母稿</h3><pre>{detail.snapshot.manuscript||detail.snapshot.script||"未生成"}</pre>
        {detail.snapshot.manuscript&&<><h3>当前口播稿</h3><pre>{detail.snapshot.script}</pre></>}
        <a className="secondary" download="口播稿.txt" href={"data:text/plain;charset=utf-8,"+encodeURIComponent(detail.snapshot.script||"")}>下载稿件</a>
        {detail.snapshot.subtitles&&<a className="secondary" download="普通话字幕.srt" href={"data:application/x-subrip;charset=utf-8,"+encodeURIComponent(detail.snapshot.subtitles)}>下载普通话字幕</a>}
        {detail.snapshot.cantoneseScript&&<a className="secondary" download="粵語字幕_初稿.srt" href={srtDataUrl(detail.snapshot.cantoneseScript,(detail.snapshot.voiceDuration||0)/1000)}>下载粤语 SRT 字幕初稿</a>}
        {detail.snapshot.audioSliceJobId&&<><h3>完整配音</h3><audio controls src={"/api/media/audio/"+detail.snapshot.audioSliceJobId+"/source.mp3"}/><a href={"/api/media/audio/"+detail.snapshot.audioSliceJobId+"/source.mp3"} download>下载音频</a></>}
        {detail.snapshot.avatarSliceJobs?.filter(j=>j.videoUrl).map(j=><div key={j.id}><h3>数字人片段 {j.label}</h3><video controls preload="metadata" src={j.videoUrl}/><a href={j.videoUrl} download>下载片段</a>{j.videoUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(j.videoUrl) && <><p>此片段仍是模型返回的在线地址，可能过期。建议另存本地素材库。</p><button className="secondary" onClick={()=>void retry({id:j.id,sourceUrl:j.videoUrl!,caption:"数字人 "+j.label,type:"video",status:"queued",progress:0})}>保存视频到素材库</button></>}</div>)}
        {detail.snapshot.compositionUrl&&<><h3>合成视频</h3><video controls preload="metadata" src={detail.snapshot.compositionUrl}/><a href={detail.snapshot.compositionUrl} download>下载成片</a></>}
        <p><a className="primary" href={"/"+"?project="+detail.id+"&revision="+detail.revision+"&copy=1"}>以此版本创建新项目</a></p>
      </section>}
    </section>}
    {tab==="sops"&&<section>
      <div className="libraryCard"><h2>当前启用：{active?.version||"读取中"}</h2><p>{active?.name}</p><label>上传新规则（DOCX / TXT / Markdown，最多5MB）<input type="file" accept=".docx,.txt,.md" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/></label><p>上传后不会自动启用。先核对解析全文，再确认切换；切换旧版即可回滚。</p></div>
      <div className="libraryGrid">{sops.map(s=><button className="libraryCard" key={s.id} onClick={()=>{setPreview(s);setNotice("");}}><h3>{s.version} {s.id===active?.id?"· 使用中":""}</h3><p>{s.name}</p><small>{s.createdAt?new Date(s.createdAt).toLocaleString():"内置规则"}</small></button>)}</div>
      {preview&&<section className="libraryDetail"><h2>解析预览：{preview.version}</h2><p>{preview.text.length} 字符 · 请特别检查表格内容、日期和例文是否完整。</p><pre>{preview.text}</pre><button className="primary" disabled={busy||active?.id===preview.id} onClick={()=>void activate()}>{active?.id===preview.id?"当前已启用":"确认全文，启用此版本"}</button></section>}
    </section>}
    {tab==="downloads"&&<section><p>图片与新闻视频从工作台素材卡片发起下载。仅在线预览不代表已保存；加密和直播视频不支持下载。</p><div className="libraryGrid">{downloads.map(d=><article className="libraryCard" key={d.id}><h3>{d.caption}</h3><p>{d.status==="completed"?"已保存":d.status==="failed"?"下载失败":d.status==="queued"?"排队中":"下载中 "+d.progress+"%"}</p>
      {d.status==="completed"&&(d.type==="video"?<video controls preload="metadata" src={"/api/library/downloads/"+d.id+"/file"}/>:<img alt={d.caption} src={"/api/library/downloads/"+d.id+"/file"}/>)}
      {d.status==="completed"&&<a href={"/api/library/downloads/"+d.id+"/file"} download>下载文件</a>}
      {d.error&&<p className="errorNotice">{d.error}</p>}{d.status==="failed"&&<button className="secondary" onClick={()=>void retry(d)}>重试下载</button>}
      <p><a href={d.sourceUrl} target="_blank" rel="noreferrer">原始来源</a></p>
    </article>)}</div>{!downloads.length&&<p className="libraryEmpty">尚未下载素材。</p>}</section>}
  </main>;
}
