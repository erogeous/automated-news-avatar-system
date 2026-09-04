"use client";
import { useEffect, useRef, useState } from "react";

export async function libraryRequest(url: string, options?: RequestInit) {
  const response=await fetch("/api/library"+url,{...options,cache:"no-store"});
  const text=await response.text();
  let data;
  try{data=JSON.parse(text);}catch{throw new Error("素材库返回异常，请稍后重试");}
  if(!response.ok)throw new Error(data.error || "素材库操作失败");
  return data;
}
export function useProjectArchive<T extends { projectName: string; script: string; urls: string[]; audioSliceJobId: string }>(snapshot: T, restore: (snapshot:T)=>void) {
  const [ready,setReady]=useState(false),[status,setStatus]=useState("正在连接历史库…");
  const id=useRef(""),revision=useRef(0),latest=useRef(snapshot),restorer=useRef(restore),lastSaved=useRef(""),suspended=useRef(false);
  const queue=useRef<Promise<void>>(Promise.resolve());
  latest.current=snapshot;restorer.current=restore;
  const serialized=JSON.stringify(snapshot);
  useEffect(()=>{
    let cancelled=false;
    async function init(){
      const params=new URLSearchParams(location.search), project=params.get("project"),version=params.get("revision"),copy=params.get("copy")==="1";
      try {
        if(project && !/^[a-f0-9]{32}$/.test(project))throw new Error("历史项目编号无效");
        if(project) {
          if(version&&!/^\d+$/.test(version))throw new Error("稿件版本编号无效");
          const record=await libraryRequest("/projects/"+project+(version?"/versions/"+version:""));
          if(cancelled)return;
          id.current=copy?crypto.randomUUID().replaceAll("-",""):project;
          revision.current=copy?0:record.revision;
          const restored={...record.snapshot,...(copy?{projectName:record.snapshot.projectName+"（副本）"}:{})};
          latest.current=restored;restorer.current(restored);lastSaved.current=copy?"":JSON.stringify(restored);
          // Historical versions must be copied, never silently overwrite newer versions.
          if(version&&!copy){suspended.current=true;setStatus("只读历史版本，请通过历史库复制后继续制作");}
          else setStatus(copy?"已载入副本，准备保存":"已恢复历史项目");
        } else {id.current=crypto.randomUUID().replaceAll("-","");setStatus("内容将自动保存到历史库");}
        setReady(true);
      } catch(error){if(!cancelled){suspended.current=true;setStatus(error instanceof Error?error.message:"恢复失败");}}
    }
    void init();return()=>{cancelled=true;};
  },[]);
  async function save() {
    if(!ready||suspended.current) return false;
    let success=true;
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      const value=latest.current,text=JSON.stringify(value);
      if(!value.script&&!value.urls.some(Boolean)&&!value.audioSliceJobId)return;
      if(text===lastSaved.current)return;
      setStatus("正在保存…");
      try{
        const result=await libraryRequest("/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id.current,expectedRevision:revision.current,snapshot:value})});
        revision.current=result.revision;lastSaved.current=text;
        const url=new URL(location.href);url.searchParams.set("project",id.current);url.searchParams.delete("copy");url.searchParams.delete("revision");
        history.replaceState(null,"",url);
        setStatus("已保存 · 版本 "+result.revision);
      }catch(error){
        success=false;
        const message=error instanceof Error?error.message:"保存失败";
        if(message.includes("其他页面"))suspended.current=true;
        setStatus("保存失败："+message);
      }
    });
    await queue.current;return success;
  }
  const saver=useRef(save);saver.current=save;
  useEffect(()=>{
    if(!ready)return;
    const timer=setTimeout(()=>void saver.current(),1500);
    return()=>clearTimeout(timer);
  },[serialized,ready]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{
      if(latest.current.script && JSON.stringify(latest.current)!==lastSaved.current){event.preventDefault();event.returnValue="";}
    };
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[]);
  return {ready,status,save};
}
